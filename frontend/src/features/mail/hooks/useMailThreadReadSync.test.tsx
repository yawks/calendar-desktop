// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it } from 'vitest';
import { useMailConversationReadSync, useMailThreadReadSync } from './useMailThreadReadSync';
import { MAIL_KEYS } from './useMailQueries';
import type { MailMessage, MailThread } from '../types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('keeps a read invitation read in cached and accumulated rows after leaving its detail', async () => {
  const client = new QueryClient();
  const root = createRoot(document.createElement('div'));
  const rows = [{ conversation_id: 'invitation', unread_count: 1, accountId: 'account' }] as MailThread[];
  const messages = [{ item_id: 'meeting', is_read: true }] as MailMessage[];
  const key = [...MAIL_KEYS.threads('account', 'inbox'), 50, 0];
  const otherKey = [...MAIL_KEYS.threads('other-account', 'inbox'), 50, 0];
  const searchKey = MAIL_KEYS.search('account', 'invitation');
  client.setQueryData(key, rows);
  client.setQueryData(otherKey, rows);
  client.setQueryData(searchKey, rows);
  let displayed!: MailThread[];
  function Harness({ selected, loading = false }: { selected: boolean; loading?: boolean }) {
    const [threads, setThreads] = useState(rows);
    displayed = threads;
    useMailThreadReadSync(setThreads, 'account', 'inbox', true);
    useMailConversationReadSync('account', 'inbox', selected ? 'invitation' : undefined, messages, loading, rows);
    return null;
  }
  const render = (selected: boolean, loading = false) => act(async () => {
    root.render(<QueryClientProvider client={client}><Harness selected={selected} loading={loading} /></QueryClientProvider>);
  });
  try {
    await render(true, true);
    expect(client.getQueryData(key)).toEqual(rows);
    await render(true);
    expect(displayed[0].unread_count).toBe(0);
    expect(client.getQueryData(key)).toEqual([{ ...rows[0], unread_count: 0 }]);
    expect(client.getQueryData(searchKey)).toEqual([{ ...rows[0], unread_count: 0 }]);
    expect(client.getQueryData(otherKey)).toEqual(rows);
    await render(false);
    expect(displayed[0].unread_count).toBe(0);
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});
