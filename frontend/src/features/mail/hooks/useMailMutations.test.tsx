// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { useMailMutations } from './useMailMutations';
import { useMailThreadReadSync } from './useMailThreadReadSync';
import { MAIL_KEYS } from './useMailQueries';
import type { MailProvider } from '../providers/MailProvider';
import type { MailMessage, MailThread } from '../types';

vi.mock('../../../shared/store/OfflineMailStore', () => ({
  useOfflineMailSettings: () => ({ settings: { enabled: false } }),
}));
vi.mock('./useOfflineMailSync', () => ({ synchronizeOfflineInboxAccount: vi.fn() }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('restores each folder and page after a read failure, then can mark another email read', async () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const root = createRoot(document.createElement('div'));
  let mutations!: ReturnType<typeof useMailMutations>;
  let displayedThreads!: MailThread[];
  function Harness() {
    mutations = useMailMutations();
    const [threads, setThreads] = useState([...page, ...otherPage]);
    displayedThreads = threads;
    useMailThreadReadSync(setThreads, 'account', 'inbox', false);
    return null;
  }
  const first = { item_id: 'first', change_key: 'key', is_read: false } as MailMessage;
  const second = { item_id: 'second', change_key: 'key', is_read: false } as MailMessage;
  const pageKey = [...MAIL_KEYS.threads('account', 'inbox'), 50, 0];
  const otherPageKey = [...MAIL_KEYS.threads('account', 'inbox'), 50, 50];
  const messageKey = [...MAIL_KEYS.thread('account', 'first'), 'inbox', false, false];
  const archiveKey = [...MAIL_KEYS.thread('account', 'first'), 'archive', false, false];
  const secondMessageKey = [...MAIL_KEYS.thread('account', 'second'), 'inbox', false, false];
  const page = [{ conversation_id: 'first', unread_count: 1, message_count: 1 }] as MailThread[];
  const otherPage = [{ conversation_id: 'second', unread_count: 1, message_count: 1 }] as MailThread[];
  const archiveMessages = [{ ...first, body_html: 'archive body' }];
  const searchKey = MAIL_KEYS.search('account', 'query');
  client.setQueryData(searchKey, [...page, ...otherPage]);
  client.setQueryData(pageKey, page);
  client.setQueryData(otherPageKey, otherPage);
  client.setQueryData(messageKey, [first]);
  client.setQueryData(archiveKey, archiveMessages);
  client.setQueryData(secondMessageKey, [second]);
  const provider = { markRead: vi.fn()
    .mockRejectedValueOnce(new Error('ErrorItemNotFound: Item not found.'))
    .mockResolvedValueOnce(undefined) } as unknown as MailProvider;
  await act(async () => root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>));
  const markRead = async (conversationId: string, message: MailMessage) => {
    await act(async () => {
      await new Promise<void>(resolve => mutations.markRead({
        accountId: 'account', provider, conversationId, read: true, specificMessages: [message],
      }, { onSettled: () => resolve() }));
    });
  };
  try {
    await markRead('first', first);
    expect(client.getQueryData(pageKey)).toEqual(page);
    expect(client.getQueryData(otherPageKey)).toEqual(otherPage);
    expect(client.getQueryData(messageKey)).toEqual([first]);
    expect(client.getQueryData(archiveKey)).toEqual(archiveMessages);
    expect(client.getQueryData(searchKey)).toEqual([...page, ...otherPage]);
    expect(displayedThreads).toEqual([...page, ...otherPage]);
    await markRead('second', second);
    expect(client.getQueryData(searchKey)).toEqual([page[0], { ...otherPage[0], unread_count: 0 }]);
    expect(displayedThreads).toEqual([page[0], { ...otherPage[0], unread_count: 0 }]);
    expect(client.getQueryData(secondMessageKey)).toEqual([{ ...second, is_read: true }]);
    expect(client.getQueryData(otherPageKey)).toEqual([{ ...otherPage[0], unread_count: 0 }]);
    expect(client.getQueryData(messageKey)).toEqual([first]);
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});

for (const operation of ['moveThread', 'moveToTrash', 'deletePermanently', 'bulkMove', 'bulkDelete', 'snoozeThread'] as const) {
  for (const fails of [false, true]) {
    it(`${operation}: ${fails ? 'keeps cached messages on failure' : 'discards obsolete headers and bodies after success'}`, async () => {
      const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
      const root = createRoot(document.createElement('div'));
      let mutations!: ReturnType<typeof useMailMutations>;
      function Harness() {
        mutations = useMailMutations();
        return null;
      }
      const headersKey = [...MAIL_KEYS.thread('account', 'conversation'), 'inbox', false, false];
      const bodyKey = ['mail', 'account', 'message-content', 'conversation', 'old-item'];
      const otherKey = [...MAIL_KEYS.thread('other-account', 'conversation'), 'inbox'];
      const headers = [{ item_id: 'old-item' }];
      client.setQueryData(headersKey, headers);
      client.setQueryData(bodyKey, { body_html: 'cached' });
      client.setQueryData(otherKey, headers);
      const pageKey = [...MAIL_KEYS.threads('account', 'inbox'), 50, 0];
      const otherPageKey = [...MAIL_KEYS.threads('other-account', 'inbox'), 50, 0];
      const rows = [{ conversation_id: 'conversation' }, { conversation_id: 'neighbour' }];
      client.setQueryData(pageKey, rows);
      client.setQueryData(otherPageKey, rows);
      const perform = vi.fn(async () => {
        if (fails) throw new Error('Exchange unavailable');
        // Simulate a refresh restoring the row after optimistic removal.
        client.setQueryData(pageKey, rows);
      });
      const provider = {
        getThread: async () => headers,
        snooze: perform,
        bulkMoveToFolder: perform,
        moveToTrash: perform,
        permanentlyDelete: perform,
        bulkMoveToTrash: perform,
      } as unknown as MailProvider;
      await act(async () => root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>));
      try {
        await act(async () => {
          await new Promise<void>(resolve => {
            const callbacks = { onSettled: () => resolve() };
            const params = { accountId: 'account', provider, conversationId: 'conversation', conversationIds: ['conversation'], targetFolderId: 'archive', permanent: false, until: '2099-01-01T10:00:00Z' };
            mutations[operation](params, callbacks);
          });
        });
        expect(perform).toHaveBeenCalledOnce();
        expect(client.getQueryData(headersKey)).toEqual(fails ? headers : undefined);
        expect(client.getQueryData(bodyKey)).toEqual(fails ? { body_html: 'cached' } : undefined);
        expect(client.getQueryData(otherKey)).toEqual(headers);
        if (!fails) expect(client.getQueryData(pageKey)).toEqual([rows[1]]);
        expect(client.getQueryData(otherPageKey)).toEqual(rows);
      } finally {
        await act(async () => root.unmount());
        client.clear();
      }
    });
  }
}
