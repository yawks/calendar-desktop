import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { platform } from '.';
import type { NativeSyncAccount, NotificationPrivacy } from '.';
import { useImapAuth } from '../store/ImapAuthStore';
import { useGoogleAuth } from '../store/GoogleAuthStore';
import { useExchangeAuth } from '../store/ExchangeAuthStore';
import { useJmapAuth } from '../store/JmapAuthStore';

const KEY = 'courrier-native-settings-v1';
type Settings = { serverUrl: string; privacy: NotificationPrivacy; enabled: string[] };
const load = (): Settings => {
  try { return { serverUrl: '', privacy: 'generic', enabled: [], ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; }
  catch { return { serverUrl: '', privacy: 'generic', enabled: [] }; }
};

export function NativeSettingsSection() {
  const { t } = useTranslation();
  const { accounts: googleAccounts } = useGoogleAuth();
  const { accounts: exchangeAccounts } = useExchangeAuth();
  const { accounts: imapAccounts } = useImapAuth();
  const { accounts: jmapAccounts } = useJmapAuth();
  const [settings, setSettings] = useState(load);
  const save = (next: Settings) => { setSettings(next); localStorage.setItem(KEY, JSON.stringify(next)); };
  const accounts: Array<Omit<NativeSyncAccount, 'serverUrl'>> = [
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
  useEffect(() => {
    if (!platform.isNativeAndroid) return;
    const present = new Set(accounts.map(account => account.accountId));
    const removed = settings.enabled.filter(accountId => !present.has(accountId));
    if (removed.length === 0) return;
    void Promise.all(removed.map(accountId => platform.disableSync(accountId))).then(() => {
      save({ ...settings, enabled: settings.enabled.filter(accountId => present.has(accountId)) });
    });
  }, [settings.enabled.join(','), accounts.map(account => account.accountId).join(',')]);
  if (!platform.isNativeAndroid) return null;
  const toggle = async (accountId: string, enabled: boolean) => {
    const account = accounts.find(item => item.accountId === accountId);
    if (!account) return;
    if (enabled) {
      if (!await platform.requestNotificationPermission()) return;
      await platform.configureSync({ ...account, serverUrl: settings.serverUrl });
      save({ ...settings, enabled: [...new Set([...settings.enabled, accountId])] });
    } else {
      await platform.disableSync(accountId);
      save({ ...settings, enabled: settings.enabled.filter(id => id !== accountId) });
    }
  };
  return <section className="settings-section">
    <h3>{t('settings.androidSync.title')}</h3>
    <label>{t('settings.androidSync.serverUrl')}<input type="url" required placeholder="https://courrier.example" value={settings.serverUrl} onChange={event => save({ ...settings, serverUrl: event.target.value })} /></label>
    <label>{t('settings.androidSync.privacy')}<select value={settings.privacy} onChange={event => { const privacy = event.target.value as NotificationPrivacy; save({ ...settings, privacy }); void platform.setNotificationPrivacy(privacy); }}>
      <option value="generic">{t('settings.androidSync.generic')}</option><option value="sender">{t('settings.androidSync.sender')}</option><option value="sender-subject">{t('settings.androidSync.senderSubject')}</option>
    </select></label>
    <p>{t('settings.androidSync.securityHint')}</p>
    {accounts.map(account => <label key={account.accountId}><input type="checkbox" checked={settings.enabled.includes(account.accountId)} disabled={!settings.serverUrl.startsWith('https://')} onChange={event => void toggle(account.accountId, event.target.checked)} />{account.email} · {account.provider}</label>)}
  </section>;
}
