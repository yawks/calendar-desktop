import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BatteryCharging, Bell, CheckCircle2, LoaderCircle, RefreshCw, Save, Server, ShieldCheck } from 'lucide-react';
import { platform } from '.';
import type { NativeSyncAccount, NativeSyncMode, NativeSyncStatus, NotificationPrivacy } from '.';
import { useImapAuth } from '../store/ImapAuthStore';
import { useGoogleAuth } from '../store/GoogleAuthStore';
import { useExchangeAuth } from '../store/ExchangeAuthStore';
import { useJmapAuth } from '../store/JmapAuthStore';

const KEY = 'courrier-native-settings-v1';
type Settings = { syncIntervalMinutes: number; privacy: NotificationPrivacy; enabled: string[]; modes: Record<string, NativeSyncMode>; credentialRevisions: Record<string, number> };
const load = (): Settings => {
  try {
    const saved = { syncIntervalMinutes: 15, privacy: 'generic', enabled: [], modes: {}, credentialRevisions: {}, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } as Settings;
    return { ...saved, modes: { ...Object.fromEntries(saved.enabled.map(id => [id, 'periodic'])), ...saved.modes }, syncIntervalMinutes: Math.max(15, saved.syncIntervalMinutes) };
  }
  catch { return { syncIntervalMinutes: 15, privacy: 'generic', enabled: [], modes: {}, credentialRevisions: {} }; }
};

export function NativeSettingsSection() {
  const { t } = useTranslation();
  const { accounts: googleAccounts, addAccount: saveGoogleAccount } = useGoogleAuth();
  const { accounts: exchangeAccounts, addAccount: saveExchangeAccount } = useExchangeAuth();
  const { accounts: imapAccounts } = useImapAuth();
  const { accounts: jmapAccounts } = useJmapAuth();
  const [settings, setSettings] = useState(load);
  const [syncStatuses, setSyncStatuses] = useState<Record<string, NativeSyncStatus>>({});
  const [togglingAccounts, setTogglingAccounts] = useState<Set<string>>(new Set());
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [backgroundWarning, setBackgroundWarning] = useState<string | null>(null);
  const saveLocally = (next: Settings) => { setSettings(next); localStorage.setItem(KEY, JSON.stringify(next)); };
  const update = (next: Settings) => { saveLocally(next); setSaveState('idle'); };
  const accounts: NativeSyncAccount[] = [
    ...googleAccounts.filter(account => (account.enabledCapabilities ?? ['calendar', 'email']).includes('email')).map(account => ({
      accountId: account.id, provider: 'gmail' as const, email: account.email, displayName: account.name,
      credentials: { accessToken: account.accessToken, refreshToken: account.refreshToken, expiresAt: account.expiresAt, email: account.email, clientId: account.googleClientId, clientSecret: account.googleClientSecret },
    })),
    ...exchangeAccounts.filter(account => (account.enabledCapabilities ?? ['calendar', 'email']).includes('email')).map(account => ({
      accountId: account.id, provider: 'exchange' as const, email: account.email, displayName: account.displayName,
      credentials: { accessToken: account.accessToken, refreshToken: account.refreshToken, expiresAt: account.expiresAt, email: account.email },
    })),
    ...imapAccounts.map(account => ({
      accountId: account.id, provider: 'imap' as const, email: account.email, displayName: account.displayName,
      credentials: { email: account.email, imap_server: account.imapServer, imap_port: account.imapPort, imap_use_ssl: account.imapUseSsl, imap_use_starttls: account.imapUseStarttls, imap_username: account.imapUsername, imap_password: account.imapPassword, smtp_server: '', smtp_port: 0, smtp_use_ssl: false, smtp_use_starttls: false, smtp_username: '', smtp_password: '' },
    })),
    ...jmapAccounts.map(account => ({
      accountId: account.id, provider: 'jmap' as const, email: account.email, displayName: account.displayName,
      credentials: { email: account.email, session_url: account.sessionUrl, token: account.token, auth_type: account.authType, fastmail_token: account.fastmailToken, fastmail_cookie: account.fastmailCookie },
    })),
  ];
  const refreshStatuses = async () => {
    const entries = await Promise.all(settings.enabled.map(async accountId => [accountId, await platform.getSyncStatus(accountId)] as const));
    setSyncStatuses(Object.fromEntries(entries));
  };
  useEffect(() => {
    if (!platform.isNativeAndroid) return;
    void platform.credentialUpdates?.().then(updates => { if (updates.length) saveLocally({ ...settings, credentialRevisions: { ...settings.credentialRevisions, ...Object.fromEntries(updates.map(update => [update.accountId, update.credentialRevision])) } }); updates.forEach(update => {
      const credentials = update.credentials as { accessToken?: string; refreshToken?: string; expiresAt?: number };
      const google = googleAccounts.find(account => account.id === update.accountId);
      if (google && credentials.accessToken) saveGoogleAccount({ ...google, accessToken: credentials.accessToken, refreshToken: credentials.refreshToken ?? google.refreshToken, expiresAt: credentials.expiresAt ?? google.expiresAt });
      const exchange = exchangeAccounts.find(account => account.id === update.accountId);
      if (exchange && credentials.accessToken) saveExchangeAccount({ ...exchange, accessToken: credentials.accessToken, refreshToken: credentials.refreshToken ?? exchange.refreshToken, expiresAt: credentials.expiresAt ?? exchange.expiresAt });
    }); });
    void platform.backgroundRestrictions?.().then(value => setBackgroundWarning(value.batteryOptimized || value.manufacturer.toLowerCase() === 'samsung' ? value.manufacturer : null));
    void refreshStatuses();
    const timer = window.setInterval(() => void refreshStatuses(), 5000);
    return () => window.clearInterval(timer);
  }, [settings.enabled.join(',')]);
  useEffect(() => {
    if (!platform.isNativeAndroid) return;
    const present = new Set(accounts.map(account => account.accountId));
    const removed = settings.enabled.filter(accountId => !present.has(accountId));
    if (removed.length === 0) return;
    void Promise.all(removed.map(accountId => platform.disableSync(accountId))).then(() => {
      saveLocally({ ...settings, enabled: settings.enabled.filter(accountId => present.has(accountId)) });
    });
  }, [settings.enabled.join(','), accounts.map(account => account.accountId).join(',')]);
  useEffect(() => {
    if (!platform.isNativeAndroid) return;
    const unsupported = accounts.filter(account =>
      !['jmap', 'imap', 'exchange'].includes(account.provider) && settings.modes[account.accountId] === 'continuous'
    );
    if (unsupported.length === 0) return;
    const modes = { ...settings.modes };
    unsupported.forEach(account => { modes[account.accountId] = 'periodic'; });
    saveLocally({ ...settings, modes });
    void Promise.all(unsupported.map(account => platform.configureSync({
      ...account,
      syncIntervalMinutes: settings.syncIntervalMinutes,
      syncMode: 'periodic',
      credentialRevision: settings.credentialRevisions[account.accountId] ?? 0,
    })));
  }, [accounts.map(account => `${account.accountId}:${account.provider}`).join(','), JSON.stringify(settings.modes)]);
  if (!platform.isNativeAndroid) return null;
  const setMode = async (accountId: string, mode: NativeSyncMode) => {
    const account = accounts.find(item => item.accountId === accountId);
    if (!account) return;
    if (mode === 'continuous' && !['jmap', 'imap', 'exchange'].includes(account.provider)) return;
    if (togglingAccounts.has(accountId)) return;
    const previous = settings;
    const enabled = mode !== 'disabled';
    const next = { ...settings, modes: { ...settings.modes, [accountId]: mode }, enabled: enabled ? [...new Set([...settings.enabled, accountId])] : settings.enabled.filter(id => id !== accountId) };
    saveLocally(next);
    setTogglingAccounts(current => new Set(current).add(accountId));
    try {
      if (enabled) {
        if (!await platform.requestNotificationPermission()) throw new Error('notification_permission_denied');
        await platform.configureSync({ ...account, syncIntervalMinutes: settings.syncIntervalMinutes, syncMode: mode, credentialRevision: settings.credentialRevisions[accountId] ?? 0 });
      } else {
        await platform.disableSync(accountId);
      }
    } catch (error) {
      console.error('[Android sync] account toggle failed', error);
      saveLocally(previous);
      setSaveState('error');
    } finally {
      setTogglingAccounts(current => { const result = new Set(current); result.delete(accountId); return result; });
    }
  };
  const persistNativeSettings = async () => {
    setSaveState('saving');
    try {
      await platform.setNotificationPrivacy(settings.privacy);
      await Promise.all(settings.enabled.map(accountId => {
        const account = accounts.find(item => item.accountId === accountId);
        return account ? platform.configureSync({ ...account, syncIntervalMinutes: settings.syncIntervalMinutes, syncMode: settings.modes[accountId] ?? 'periodic', credentialRevision: settings.credentialRevisions[accountId] ?? 0 }) : Promise.resolve();
      }));
      localStorage.setItem(KEY, JSON.stringify(settings));
      setSaveState('saved');
    } catch (error) {
      console.error('[Android sync] settings save failed', error);
      setSaveState('error');
    }
  };
  const testSync = async (accountId: string) => {
    setSyncStatuses(current => ({ ...current, [accountId]: { ...current[accountId], state: 'running', lastAttemptAt: Date.now() } }));
    await platform.runSyncNow(accountId);
  };
  const statusLabel = (status?: NativeSyncStatus) => {
    if (!status?.state) return t('settings.androidSync.neverRun');
    if (status.state === 'running') return t('settings.androidSync.running');
    if (status.state === 'retrying') return t('settings.androidSync.retrying', { code: status.lastErrorCode });
    if (status.state === 'error') return t('settings.androidSync.failed', { code: status.lastErrorCode });
    if (['connecting', 'listening', 'syncing', 'waiting-retry', 'periodic-fallback', 'provider-unsupported'].includes(status.state)) return status.state;
    return t('settings.androidSync.lastSuccess', { date: new Date(status.lastSuccessAt ?? 0).toLocaleString() });
  };
  return <section className="native-settings-card" aria-labelledby="android-sync-title">
    <div className="native-settings-card__header">
      <span className="native-settings-card__icon" aria-hidden="true"><Server size={20} /></span>
      <div>
        <h3 id="android-sync-title">{t('settings.androidSync.title')}</h3>
        <p>{t('settings.androidSync.description')}</p>
      </div>
    </div>
    <div className="native-settings-grid">
      <label className="native-settings-field">
        <span>{t('settings.androidSync.syncInterval')}</span>
        <select value={settings.syncIntervalMinutes} onChange={event => update({ ...settings, syncIntervalMinutes: Number(event.target.value) })}>
          <option value={15}>{t('settings.androidSync.every15m')}</option>
          <option value={30}>{t('settings.androidSync.every30m')}</option>
          <option value={60}>{t('settings.androidSync.every1h')}</option>
        </select>
      </label>
      <label className="native-settings-field">
        <span><Bell size={14} />{t('settings.androidSync.privacy')}</span>
        <select value={settings.privacy} onChange={event => {
          const privacy = event.target.value as NotificationPrivacy;
          update({ ...settings, privacy });
          void platform.setNotificationPrivacy(privacy);
        }}>
          <option value="generic">{t('settings.androidSync.generic')}</option>
          <option value="sender">{t('settings.androidSync.sender')}</option>
          <option value="sender-subject">{t('settings.androidSync.senderSubject')}</option>
        </select>
      </label>
    </div>
    {accounts.length > 0 && <fieldset className="native-settings-accounts">
      <legend>{t('settings.androidSync.accounts')}</legend>
      {accounts.map(account => <div className="native-settings-account" key={account.accountId}>
        <label>
          <span><strong>{account.email}</strong><small>{account.provider.toUpperCase()}</small></span>
          <select value={settings.modes[account.accountId] ?? 'disabled'} disabled={togglingAccounts.has(account.accountId)} onChange={event => void setMode(account.accountId, event.target.value as NativeSyncMode)}>
            <option value="disabled">{t('settings.androidSync.modeDisabled')}</option><option value="continuous" disabled={!['jmap', 'imap', 'exchange'].includes(account.provider)}>{t('settings.androidSync.modeContinuous')}</option><option value="periodic">{t('settings.androidSync.modePeriodic')}</option><option value="manual">{t('settings.androidSync.modeManual')}</option>
          </select>
        </label>
        {settings.enabled.includes(account.accountId) && <div className="native-settings-diagnostic">
          <div className="native-settings-diagnostic__meta">
            <span>{statusLabel(syncStatuses[account.accountId])}</span>
            {syncStatuses[account.accountId]?.nextApproximateAt && <span>{new Date(syncStatuses[account.accountId].nextApproximateAt!).toLocaleString()}</span>}
            {syncStatuses[account.accountId]?.lastEventAt && <span>{new Date(syncStatuses[account.accountId].lastEventAt!).toLocaleString()}</span>}
          </div>
          <button type="button" className="native-settings-test-button" onClick={() => void testSync(account.accountId)} disabled={syncStatuses[account.accountId]?.state === 'running'}>
            <RefreshCw size={15} aria-hidden="true" /> <span>{t('settings.androidSync.testNow')}</span>
          </button>
        </div>}
      </div>)}
    </fieldset>}
    <p className="native-settings-security"><ShieldCheck size={16} />{t('settings.androidSync.securityHint')}</p>
    {backgroundWarning && <div className="native-settings-notice">
      <p role="status">{t('settings.androidSync.batteryWarning', { manufacturer: backgroundWarning })}</p>
      <button type="button" className="btn-ghost native-settings-notice__action" onClick={() => void platform.openBatterySettings?.()}>
        <BatteryCharging size={16} aria-hidden="true" />
        <span>{t('settings.androidSync.batterySettings')}</span>
      </button>
    </div>}
    <div className="native-settings-actions">
      <button className="btn-primary" type="button" disabled={saveState === 'saving'} onClick={() => void persistNativeSettings()}>
        {saveState === 'saving' ? <LoaderCircle className="native-settings-spinner" size={16} /> : <Save size={16} />}
        {t(saveState === 'saving' ? 'settings.androidSync.saving' : 'settings.androidSync.save')}
      </button>
      {saveState === 'saved' && <span className="native-settings-status native-settings-status--success" role="status"><CheckCircle2 size={16} />{t('settings.androidSync.saved')}</span>}
      {saveState === 'error' && <span className="native-settings-status native-settings-status--error" role="alert">{t('settings.androidSync.saveError')}</span>}
    </div>
  </section>;
}
