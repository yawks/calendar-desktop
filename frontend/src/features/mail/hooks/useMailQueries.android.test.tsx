// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { MAIL_KEYS, useMailThreads, useAllAccountThreads } from './useMailQueries';
import type { MailProvider } from '../providers/MailProvider';

vi.mock('../../../shared/platform', () => ({ platform: { isNativeAndroid: true } }));

it.each([false, true])('refreshes a fresh cached Android inbox on mount (unified: %s)', async unified => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } });
  const key = [...MAIL_KEYS.threads('account', 'inbox'), 50, 0];
  client.setQueryData(key, [{ conversation_id: 'deleted-from-notification' }]);
  const listThreads = vi.fn().mockResolvedValue([]);
  const provider = { listThreads } as unknown as MailProvider;
  function SingleInbox() { useMailThreads('account', 'inbox', provider); return null; }
  function UnifiedInbox() { useAllAccountThreads('inbox', [{ id: 'account', provider, label: 'Account' }]); return null; }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<QueryClientProvider client={client}>{unified ? <UnifiedInbox /> : <SingleInbox />}</QueryClientProvider>));
    expect(listThreads).toHaveBeenCalledWith('inbox', 50, 0);
    expect(client.getQueryData(key)).toEqual([]);
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});
