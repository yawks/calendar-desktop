import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { del, set } from 'idb-keyval';
import { QueryClient } from '@tanstack/react-query';
import { indexedDBPersister, shouldPersistQuery, subscribeToQueryPersistence } from './queryClient';

vi.mock('idb-keyval', () => ({ get: vi.fn(), set: vi.fn(), del: vi.fn() }));

const snapshot = (timestamp: number) => ({
  timestamp, buster: '', clientState: { queries: [], mutations: [] },
});

describe('IndexedDB cache persistence', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); });
  afterEach(() => vi.useRealTimers());

  it('keeps only the latest snapshot queued behind an in-flight write', async () => {
    const writes = Array.from({ length: 100 }, (_, i) => indexedDBPersister.persistClient(snapshot(i)));
    expect(set).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    await Promise.all(writes);
    expect(set).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenLastCalledWith('react-query-cache-v2', snapshot(99));
  });

  it('serializes slow writes and discards intermediate snapshots', async () => {
    let finishWrite!: () => void;
    vi.mocked(set).mockImplementationOnce(() => new Promise<void>(resolve => { finishWrite = resolve; }));
    const first = indexedDBPersister.persistClient(snapshot(1));
    await vi.advanceTimersByTimeAsync(2_000);
    const second = indexedDBPersister.persistClient(snapshot(2));
    const latest = indexedDBPersister.persistClient(snapshot(3));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(set).toHaveBeenCalledTimes(1);
    finishWrite();
    await vi.advanceTimersByTimeAsync(2_000);
    await Promise.all([first, second, latest]);
    expect(set).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenLastCalledWith('react-query-cache-v2', snapshot(3));
  });

  it('cancels queued persistence when removing the cache', async () => {
    const write = indexedDBPersister.persistClient(snapshot(1));
    const queued = indexedDBPersister.persistClient(snapshot(2));
    const removal = indexedDBPersister.removeClient();
    await vi.advanceTimersByTimeAsync(2_000);
    await Promise.all([write, queued, removal]);
    expect(set).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith('react-query-cache-v2');
  });

  it('can persist again after a failed write', async () => {
    vi.mocked(set).mockRejectedValueOnce(new Error('disk unavailable'));
    const failure = expect(indexedDBPersister.persistClient(snapshot(1))).rejects.toThrow('disk unavailable');
    await vi.advanceTimersByTimeAsync(2_000);
    await failure;
    const retry = indexedDBPersister.persistClient(snapshot(2));
    await vi.advanceTimersByTimeAsync(2_000);
    await retry;
    expect(set).toHaveBeenLastCalledWith('react-query-cache-v2', snapshot(2));
  });

  it('waits for an in-flight write before deleting the cache', async () => {
    let finishWrite!: () => void;
    vi.mocked(set).mockImplementationOnce(() => new Promise<void>(resolve => { finishWrite = resolve; }));
    const write = indexedDBPersister.persistClient(snapshot(1));
    await vi.advanceTimersByTimeAsync(2_000);
    const queued = indexedDBPersister.persistClient(snapshot(2));
    const removal = indexedDBPersister.removeClient();
    expect(del).not.toHaveBeenCalled();
    finishWrite();
    await Promise.all([write, queued, removal]);
    expect(set).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledTimes(1);
  });
});

describe('shouldPersistQuery', () => {
  it('does not persist full mail conversations', () => {
    expect(shouldPersistQuery(['mail', 'account', 'thread', 'conversation-id'])).toBe(false);
  });

  it('keeps lightweight mail lists and unrelated queries persistent', () => {
    expect(shouldPersistQuery(['mail', 'account', 'threads', 'inbox', 50, 0])).toBe(true);
    expect(shouldPersistQuery(['calendar', 'events'])).toBe(true);
  });
});

describe('batching before cache dehydration', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    const persistClient = vi.fn(async () => {});
    const shouldDehydrateQuery = vi.fn(() => true);
    const stop = subscribeToQueryPersistence({
      queryClient: client,
      persister: { persistClient, restoreClient: async () => undefined, removeClient: async () => {} },
      dehydrateOptions: { shouldDehydrateQuery },
    });
    return { client, persistClient, shouldDehydrateQuery, stop };
  }

  it('dehydrates only once after hundreds of updates and expirations', async () => {
    const { client, persistClient, shouldDehydrateQuery, stop } = setup();
    for (let i = 0; i < 100; i++) client.setQueryData(['temporary', i], i);
    client.removeQueries({ queryKey: ['temporary'] });
    client.setQueryData(['remaining'], 'latest');
    expect(shouldDehydrateQuery).not.toHaveBeenCalled();
    expect(persistClient).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(shouldDehydrateQuery).toHaveBeenCalledTimes(1);
    expect(persistClient).toHaveBeenCalledTimes(1);
    expect(persistClient.mock.calls[0]).toEqual([expect.objectContaining({
      clientState: expect.objectContaining({ queries: [expect.objectContaining({ queryKey: ['remaining'] })] }),
    })]);
    stop(); client.clear();
  });

  it('defers dehydration until a slow write finishes, then saves the latest data', async () => {
    const { client, persistClient, shouldDehydrateQuery, stop } = setup();
    let finish!: () => void;
    persistClient.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    client.setQueryData(['data'], 1);
    await vi.advanceTimersByTimeAsync(2_000);
    for (let i = 2; i <= 100; i++) client.setQueryData(['data'], i);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(shouldDehydrateQuery).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(shouldDehydrateQuery).toHaveBeenCalledTimes(2);
    expect(persistClient).toHaveBeenLastCalledWith(expect.objectContaining({
      clientState: expect.objectContaining({ queries: [expect.objectContaining({ state: expect.objectContaining({ data: 100 }) })] }),
    }));
    stop(); client.clear();
  });

  it('cancels scheduled work on unmount and ignores observer notifications', async () => {
    const { client, persistClient, shouldDehydrateQuery, stop } = setup();
    client.getQueryCache().notify({ type: 'observerResultsUpdated', query: {} as never });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(persistClient).not.toHaveBeenCalled();
    client.setQueryData(['data'], 1);
    stop();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(shouldDehydrateQuery).not.toHaveBeenCalled();
    client.clear();
  });

  it('handles storage errors and allows later changes to be saved', async () => {
    const { client, persistClient, stop } = setup();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    persistClient.mockRejectedValueOnce(new Error('storage unavailable'));
    client.setQueryData(['data'], 1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(warning).toHaveBeenCalledWith('[QueryCache] cache persistence failed');
    client.setQueryData(['data'], 2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(persistClient).toHaveBeenCalledTimes(2);
    stop(); client.clear(); warning.mockRestore();
  });
});
