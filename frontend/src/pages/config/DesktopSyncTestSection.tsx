import { useMemo, useState } from 'react';
import { CheckCircle2, LoaderCircle, RefreshCw, Server, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EwsMailProvider } from '../../features/mail/providers/EwsMailProvider';
import { GmailMailProvider } from '../../features/mail/providers/GmailMailProvider';
import { ImapMailProvider } from '../../features/mail/providers/ImapMailProvider';
import { JmapMailProvider } from '../../features/mail/providers/JmapMailProvider';
import type { MailProvider } from '../../features/mail/providers/MailProvider';
import { isTauriRuntime } from '../../shared/platform/tauriRuntime';
import { useExchangeAuth } from '../../shared/store/ExchangeAuthStore';
import { useGoogleAuth } from '../../shared/store/GoogleAuthStore';
import { useImapAuth } from '../../shared/store/ImapAuthStore';
import { useJmapAuth } from '../../shared/store/JmapAuthStore';

type TestState = { state: 'running' | 'success' | 'error'; detail?: string };

export function DesktopSyncTestSection() {
  const { t } = useTranslation();
  const { accounts: googleAccounts, getValidToken: getGoogleToken } = useGoogleAuth();
  const { accounts: exchangeAccounts, getValidToken: getExchangeToken } = useExchangeAuth();
  const { accounts: imapAccounts } = useImapAuth();
  const { accounts: jmapAccounts } = useJmapAuth();
  const [states, setStates] = useState<Record<string, TestState>>({});

  const accounts = useMemo(() => [
    ...googleAccounts.filter(account => (account.enabledCapabilities ?? ['calendar', 'email']).includes('email')).map(account => ({
      id: account.id, email: account.email, provider: new GmailMailProvider(account.id, getGoogleToken, account.email) as MailProvider,
    })),
    ...exchangeAccounts.filter(account => (account.enabledCapabilities ?? ['calendar', 'email']).includes('email')).map(account => ({
      id: account.id, email: account.email, provider: new EwsMailProvider(account.id, getExchangeToken, account.email) as MailProvider,
    })),
    ...imapAccounts.map(account => ({ id: account.id, email: account.email, provider: new ImapMailProvider(account) as MailProvider })),
    ...jmapAccounts.map(account => ({ id: account.id, email: account.email, provider: new JmapMailProvider(account) as MailProvider })),
  ], [exchangeAccounts, getExchangeToken, getGoogleToken, googleAccounts, imapAccounts, jmapAccounts]);

  if (!isTauriRuntime() || accounts.length === 0) return null;

  const test = async (id: string, provider: MailProvider) => {
    setStates(current => ({ ...current, [id]: { state: 'running' } }));
    try {
      await provider.listThreads('inbox', 1, 0);
      setStates(current => ({ ...current, [id]: { state: 'success' } }));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setStates(current => ({ ...current, [id]: { state: 'error', detail } }));
    }
  };

  return <section className="native-settings-card" aria-labelledby="desktop-sync-test-title">
    <div className="native-settings-card__header">
      <span className="native-settings-card__icon" aria-hidden="true"><Server size={20} /></span>
      <div>
        <h3 id="desktop-sync-test-title">{t('settings.desktopSyncTest.title')}</h3>
        <p>{t('settings.desktopSyncTest.description')}</p>
      </div>
    </div>
    <div className="native-settings-accounts">
      {accounts.map(account => {
        const result = states[account.id];
        return <div key={account.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <strong style={{ flex: 1 }}>{account.email}</strong>
          {result?.state === 'success' && <span style={{ color: 'var(--color-success, #34a853)', display: 'flex', gap: 4 }}><CheckCircle2 size={15} />{t('config.connectionSuccess')}</span>}
          {result?.state === 'error' && <span title={result.detail} style={{ color: 'var(--color-error, #d93025)', display: 'flex', gap: 4, maxWidth: 360 }}><XCircle size={15} />{result.detail}</span>}
          <button type="button" className="btn-secondary" disabled={result?.state === 'running'} onClick={() => void test(account.id, account.provider)}>
            {result?.state === 'running' ? <LoaderCircle className="native-settings-spinner" size={14} /> : <RefreshCw size={14} />}
            {t('settings.desktopSyncTest.testNow')}
          </button>
        </div>;
      })}
    </div>
  </section>;
}
