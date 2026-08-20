import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { platform } from '../../../shared/platform';
import { useMailNotificationsSettings } from '../../../shared/store/MailNotificationStore';
import { MailProvider } from '../providers/MailProvider';
import { MailThread } from '../types';
import { consumeUserInitiatedUnread } from '../utils/userInitiatedUnread';
import { useAllAccountThreads } from './useMailQueries';

type NotificationAccount = { id: string; email: string; name?: string };
type NotificationOptionsWithRenotify = NotificationOptions & { renotify?: boolean; actions?: Array<{ action: string; title: string }> };

export function useIncomingMailNotifications(accounts: NotificationAccount[], providers: Map<string, MailProvider>) {
  const { t } = useTranslation();
  const { settings, permission } = useMailNotificationsSettings();
  const queryAccounts = useMemo(() => accounts.map(account => ({ id: account.id, label: account.name || account.email, provider: providers.get(account.id) ?? null })), [accounts, providers]);
  const accountById = useMemo(() => new Map(accounts.map(account => [account.id, account])), [accounts]);
  const enabled = !platform.isNativeAndroid && settings.enabled && permission === 'granted';
  const inbox = useAllAccountThreads('inbox', queryAccounts, 50, 0, enabled);
  const snapshots = useRef(new Map<string, number>());
  const initialized = useRef(false);

  useEffect(() => {
    if (!enabled || inbox.isLoading) { initialized.current = false; snapshots.current.clear(); return; }
    const next = new Map<string, number>();
    const additions = new Map<string, MailThread[]>();
    for (const thread of inbox.data) {
      const accountId = thread.accountId;
      if (!accountId) continue;
      const key = `${accountId}:${thread.conversation_id}`;
      const previous = snapshots.current.get(key) ?? 0;
      next.set(key, thread.unread_count);
      if (initialized.current && thread.unread_count > previous && !consumeUserInitiatedUnread(accountId, thread.conversation_id)) {
        additions.set(accountId, [...(additions.get(accountId) ?? []), thread]);
      }
    }
    snapshots.current = next;
    if (!initialized.current) { initialized.current = true; return; }
    if (additions.size === 0) return;
    void (async () => {
      const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.ready.catch(() => null) : null;
      for (const [accountId, threads] of additions) {
        const account = accountById.get(accountId);
        if (!account) continue;
        for (const thread of threads) {
          const sender = thread.from_name || thread.from_email || account.email;
          const options: NotificationOptionsWithRenotify = {
            body: t('settings.mailNotifications.single', { sender, subject: thread.topic }), icon: '/icon.png', badge: '/icon.png',
            tag: `courrier-inbox-${accountId}-${thread.conversation_id}-${thread.unread_count}`, renotify: true,
            data: { url: '/?account=' + encodeURIComponent(accountId) + '&conversation=' + encodeURIComponent(thread.conversation_id) },
            actions: [
              { action: 'reply', title: t('settings.mailNotifications.replyAction') },
              { action: 'delete', title: t('settings.mailNotifications.deleteAction') },
              { action: 'archive', title: t('settings.mailNotifications.archiveAction') },
            ],
          };
          if (registration) await registration.showNotification(t('settings.mailNotifications.notificationTitle', { account: account.email }), options);
          else new Notification(t('settings.mailNotifications.notificationTitle', { account: account.email }), options);
        }
      }
    })();
  }, [accountById, enabled, inbox.data, inbox.isLoading, t]);
}
