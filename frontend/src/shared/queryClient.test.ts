import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { del, set } from 'idb-keyval';
import { indexedDBPersister, shouldPersistQuery } from './queryClient';

vi.mock('idb-keyval', () => ({ get: vi.fn(), set: vi.fn(), del: vi.fn() }));

const snapshot = (timestamp: number) => ({
  timestamp, buster: '', clientState: { queries: [], mutations: [] },
});

describe('IndexedDB cache persistence', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); });
  afterEach(() => vi.useRealTimers());

  it('coalesces a wake-up burst into the latest snapshot', async () => {
    const writes = Array.from({ length: 100 }, (_, i) => indexedDBPersister.persistClient(snapshot(i)));
    expect(set).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    await Promise.all(writes);
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith('react-query-cache-v2', snapshot(99));
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
    const removal = indexedDBPersister.removeClient();
    await vi.advanceTimersByTimeAsync(2_000);
    await Promise.all([write, removal]);
    expect(set).not.toHaveBeenCalled();
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
