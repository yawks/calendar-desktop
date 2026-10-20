// @vitest-environment jsdom
import { StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { dehydrate, QueryClient, useIsRestoring } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { get, set, del } from 'idb-keyval';
import { QueryPersistenceProvider } from './QueryPersistenceProvider';
import { queryClient } from './queryClient';

vi.mock('idb-keyval', () => ({ get: vi.fn(), set: vi.fn(), del: vi.fn() }));

function RestoreStatus() {
  return <span>{useIsRestoring() ? 'restoring' : 'ready'}</span>;
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); vi.resetAllMocks();
  queryClient.clear();
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  await vi.runOnlyPendingTimersAsync();
  vi.useRealTimers();
});

it('restores existing data once under StrictMode before subscribing', async () => {
  const source = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  source.setQueryData(['calendar'], 'cached');
  const saved = { buster: 'mail-calendar-mime-v7', timestamp: Date.now(), clientState: dehydrate(source) };
  let finishRestore!: (value: typeof saved) => void;
  vi.mocked(get).mockImplementationOnce(() => new Promise(resolve => { finishRestore = resolve; }));
  await act(async () => root.render(<StrictMode><QueryPersistenceProvider><RestoreStatus /></QueryPersistenceProvider></StrictMode>));
  expect(host.textContent).toBe('restoring');
  expect(get).toHaveBeenCalledTimes(1);
  await act(async () => { finishRestore(saved); });
  expect(host.textContent).toBe('ready');
  expect(queryClient.getQueryData(['calendar'])).toBe('cached');
  expect(set).not.toHaveBeenCalled();
  queryClient.setQueryData(['calendar'], 'updated');
  await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
  expect(set).toHaveBeenCalledTimes(1);
  source.clear();
});

it('discards message caches created before calendar MIME extraction', async () => {
  vi.mocked(get).mockResolvedValueOnce({ buster: 'mail-provider-loading-v6', timestamp: Date.now(), clientState: { queries: [], mutations: [] } });
  await act(async () => root.render(<QueryPersistenceProvider><RestoreStatus /></QueryPersistenceProvider>));
  expect(del).toHaveBeenCalledWith('react-query-cache-v2');
  expect(host.textContent).toBe('ready');
});

it('resumes normal operation after a storage read failure', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(get).mockRejectedValueOnce(new Error('storage unavailable'));
  await act(async () => root.render(<QueryPersistenceProvider><RestoreStatus /></QueryPersistenceProvider>));
  expect(host.textContent).toBe('ready');
  expect(del).toHaveBeenCalledWith('react-query-cache-v2');
  queryClient.setQueryData(['calendar'], 'new');
  await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
  expect(set).toHaveBeenCalledTimes(1);
  warning.mockRestore(); error.mockRestore();
});

it('persists successful lightweight queries without pending promises or mail bodies', async () => {
  await act(async () => root.render(<QueryPersistenceProvider><RestoreStatus /></QueryPersistenceProvider>));
  queryClient.setQueryData(['mail', 'account', 'threads', 'inbox'], ['headers']);
  queryClient.setQueryData(['mail', 'account', 'thread', 'conversation'], 'full body');
  queryClient.getQueryCache().build(queryClient, { queryKey: ['pending'] });
  queryClient.getQueryCache().build(queryClient, { queryKey: ['failed'] }).setState({ status: 'error', error: new Error('offline') });
  await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
  expect(set).toHaveBeenCalledTimes(1);
  const saved = vi.mocked(set).mock.calls[0][1];
  expect(saved.clientState.queries.map((query: { queryKey: unknown[] }) => query.queryKey)).toEqual([
    ['mail', 'account', 'threads', 'inbox'],
  ]);
});
