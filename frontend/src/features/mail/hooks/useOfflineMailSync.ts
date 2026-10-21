import { useCallback, useEffect, useRef, useState } from 'react';
import { useOfflineMailSettings } from '../../../shared/store/OfflineMailStore';
import type { MailProvider } from '../providers/MailProvider';
import type { MailMessage } from '../types';
import { clearOfflineMailCache, getOfflineInboxThreads, storeOfflineInbox } from '../utils/offlineMailCache';
import { useQueryClient } from '@tanstack/react-query';
import { MAIL_KEYS } from './useMailQueries';
import type { QueryClient } from '@tanstack/react-query';
import type { OfflineMailSettings } from '../../../shared/store/OfflineMailStore';

const REFRESH_INTERVAL = 15 * 60 * 1000;
// The offline index must never compete with the foreground mailbox for full
// bodies or attachment/inline-image downloads. Headers are enough to preserve
// the conversation structure; message content remains lazy in MessageBlock.
const CONCURRENCY = 2;

export async function synchronizeOfflineInboxAccount(
  id: string,
  provider: MailProvider,
  settings: OfflineMailSettings,
  queryClient: QueryClient,
): Promise<void> {
  const cutoff = Date.now() - settings.maxAgeDays * 86_400_000;
  const fetched = await provider.listThreads('inbox', settings.maxThreads, 0);
  const threads = fetched
    .filter(thread => new Date(thread.last_delivery_time).getTime() >= cutoff)
    .slice(0, settings.maxThreads);
  const previousThreads = await getOfflineInboxThreads(id) ?? [];
  const previousVersions = new Map(previousThreads.map(thread => [
    thread.conversation_id,
    `${thread.last_delivery_time}:${thread.message_count}:${thread.unread_count}`,
  ]));
  const changedThreads = threads.filter(thread => previousVersions.get(thread.conversation_id) !==
    `${thread.last_delivery_time}:${thread.message_count}:${thread.unread_count}`);
  const conversations = new Map<string, MailMessage[]>();
  let cursor = 0;
  const worker = async () => {
    while (cursor < changedThreads.length) {
      const thread = changedThreads[cursor++];
      try {
        const messages = await provider.getThread(thread.conversation_id);
        conversations.set(thread.conversation_id, messages.map(message => ({
          ...message,
          body_html: '',
          body_text: undefined,
          ics_mime: undefined,
          attachments: [],
          body_loaded: false,
        })));
      } catch { /* keep syncing the remaining conversations */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, changedThreads.length) }, worker));
  await storeOfflineInbox(id, threads, conversations);
  await queryClient.invalidateQueries({ queryKey: MAIL_KEYS.threads(id, 'inbox') });
}

export function useOfflineMailSync(accounts: { id: string; provider: MailProvider | null }[]) {
  const { settings } = useOfflineMailSettings();
  const queryClient = useQueryClient();
  const running = useRef(false);
  const [isSynchronizing, setIsSynchronizing] = useState(false);

  const synchronize = useCallback(async () => {
    if (!settings.enabled || !navigator.onLine || running.current) return;
    running.current = true;
    setIsSynchronizing(true);
    try {
      await Promise.all(accounts.map(async ({ id, provider }) => {
        if (!provider) return;
        try {
          await synchronizeOfflineInboxAccount(id, provider, settings, queryClient);
        } catch { /* one unavailable account must not block the others */ }
      }));
    } finally {
      running.current = false;
      setIsSynchronizing(false);
    }
  }, [accounts, queryClient, settings.enabled, settings.maxAgeDays, settings.maxThreads]);

  useEffect(() => {
    if (!settings.enabled) {
      void clearOfflineMailCache();
      return;
    }
    // Let the cached Inbox render first. The refresh is metadata-only and then
    // hydrates headers solely for conversations that actually changed.
    const startupTimer = globalThis.setTimeout(() => void synchronize(), 1_500);
    const interval = globalThis.setInterval(() => void synchronize(), REFRESH_INTERVAL);
    globalThis.addEventListener('online', synchronize);
    return () => {
      globalThis.clearTimeout(startupTimer);
      globalThis.clearInterval(interval);
      globalThis.removeEventListener('online', synchronize);
    };
  }, [settings.enabled, synchronize]);

  return { synchronize, isSynchronizing };
}
