import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, CheckCircle2, LoaderCircle, RefreshCw, Save, Server, ShieldCheck } from 'lucide-react';
import { platform } from '.';
import type { NativeSyncAccount, NativeSyncStatus, NotificationPrivacy } from '.';
import { useImapAuth } from '../store/ImapAuthStore';
import { useGoogleAuth } from '../store/GoogleAuthStore';
import { useExchangeAuth } from '../store/ExchangeAuthStore';
import { useJmapAuth } from '../store/JmapAuthStore';

const KEY = 'courrier-native-settings-v1';
type Settings = { syncIntervalMinutes: number; privacy: NotificationPrivacy; enabled: string[] };
const load = (): Settings => {
  try {
    const saved = { syncIntervalMinutes: 15, privacy: 'generic', enabled: [], ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } as Settings;
    return { ...saved, syncIntervalMinutes: Math.max(15, saved.syncIntervalMinutes) };
  }
  catch { return { syncIntervalMinutes: 15, privacy: 'generic', enabled: [] }; }
};

export function NativeSettingsSection() {
  const { t } = useTranslation();
  const { accounts: googleAccounts } = useGoogleAuth();
  const { accounts: exchangeAccounts } = useExchangeAuth();
  const { accounts: imapAccounts } = useImapAuth();
  const { accounts: jmapAccounts } = useJmapAuth();
  const [settings, setSettings] = useState(load);
  const [syncStatuses, setSyncStatuses] = useState<Record<string, NativeSyncStatus>>({});
  const [togglingAccounts, setTogglingAccounts] = useState<Set<string>>(new Set());
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
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
  if (!platform.isNativeAndroid) return null;
  const toggle = async (accountId: string, enabled: boolean) => {
    const account = accounts.find(item => item.accountId === accountId);
    if (!account) return;
    if (togglingAccounts.has(accountId)) return;
    const previous = settings;
    const next = enabled
      ? { ...settings, enabled: [...new Set([...settings.enabled, accountId])] }
      : { ...settings, enabled: settings.enabled.filter(id => id !== accountId) };
    saveLocally(next);
    setTogglingAccounts(current => new Set(current).add(accountId));
    try {
      if (enabled) {
        if (!await platform.requestNotificationPermission()) throw new Error('notification_permission_denied');
        await platform.configureSync({ ...account, syncIntervalMinutes: settings.syncIntervalMinutes });
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
        return account ? platform.configureSync({ ...account, syncIntervalMinutes: settings.syncIntervalMinutes }) : Promise.resolve();
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
      {accounts.map(account => <div key={account.accountId}>
        <label>
          <input type="checkbox" checked={settings.enabled.includes(account.accountId)} disabled={togglingAccounts.has(account.accountId)} onChange={event => void toggle(account.accountId, event.target.checked)} />
          <span><strong>{account.email}</strong><small>{account.provider.toUpperCase()}</small></span>
        </label>
        {settings.enabled.includes(account.accountId) && <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 8px 26px', fontSize: 12, color: 'var(--text-muted)' }}>
          <span>{statusLabel(syncStatuses[account.accountId])}</span>
          <button type="button" className="btn-secondary" style={{ padding: '3px 7px' }} onClick={() => void testSync(account.accountId)} disabled={syncStatuses[account.accountId]?.state === 'running'}>
            <RefreshCw size={12} /> {t('settings.androidSync.testNow')}
          </button>
        </div>}
      </div>)}
    </fieldset>}
    <p className="native-settings-security"><ShieldCheck size={16} />{t('settings.androidSync.securityHint')}</p>
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
