import { useCallback, useEffect, useRef } from 'react';
import { useOfflineMailSettings } from '../../../shared/store/OfflineMailStore';
import type { MailProvider } from '../providers/MailProvider';
import type { MailMessage } from '../types';
import { clearOfflineMailCache, storeOfflineInbox } from '../utils/offlineMailCache';
import { useQueryClient } from '@tanstack/react-query';
import { MAIL_KEYS } from './useMailQueries';
import type { QueryClient } from '@tanstack/react-query';
import type { OfflineMailSettings } from '../../../shared/store/OfflineMailStore';

const REFRESH_INTERVAL = 15 * 60 * 1000;
const CONCURRENCY = 4;

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
  const conversations = new Map<string, MailMessage[]>();
  let cursor = 0;
  const worker = async () => {
    while (cursor < threads.length) {
      const thread = threads[cursor++];
      try {
        const messages = await provider.getThread(thread.conversation_id);
        const completeMessages = await Promise.all(messages.map(async message => {
          if (message.body_loaded !== false || !provider.getMessageContent) return message;
          try {
            const content = await provider.getMessageContent(message.item_id, thread.conversation_id);
            return { ...message, ...content, body_loaded: true };
          } catch {
            return message;
          }
        }));
        conversations.set(thread.conversation_id, completeMessages);
        if (!thread.snippet && provider.getThreadSnippet) {
          try {
            thread.snippet = await provider.getThreadSnippet(thread.conversation_id);
          } catch { /* the conversation remains available even if its preview fails */ }
        }
      } catch { /* keep syncing the remaining conversations */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, threads.length) }, worker));
  await storeOfflineInbox(id, threads, conversations);
  await queryClient.invalidateQueries({ queryKey: MAIL_KEYS.threads(id, 'inbox') });
}

export function useOfflineMailSync(accounts: { id: string; provider: MailProvider | null }[]) {
  const { settings } = useOfflineMailSettings();
  const queryClient = useQueryClient();
  const running = useRef(false);

  const synchronize = useCallback(async () => {
    if (!settings.enabled || !navigator.onLine || running.current) return;
    running.current = true;
    try {
      await Promise.all(accounts.map(async ({ id, provider }) => {
        if (!provider) return;
        try {
          await synchronizeOfflineInboxAccount(id, provider, settings, queryClient);
        } catch { /* one unavailable account must not block the others */ }
      }));
    } finally {
      running.current = false;
    }
  }, [accounts, queryClient, settings.enabled, settings.maxAgeDays, settings.maxThreads]);

  useEffect(() => {
    if (!settings.enabled) {
      void clearOfflineMailCache();
      return;
    }
    void synchronize();
    const interval = globalThis.setInterval(() => void synchronize(), REFRESH_INTERVAL);
    globalThis.addEventListener('online', synchronize);
    return () => {
      globalThis.clearInterval(interval);
      globalThis.removeEventListener('online', synchronize);
    };
  }, [settings.enabled, synchronize]);

  return synchronize;
}
