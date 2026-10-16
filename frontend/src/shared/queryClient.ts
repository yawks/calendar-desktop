import { QueryClient } from '@tanstack/react-query';
import { get, set, del } from 'idb-keyval';
import { persistQueryClientSave, type PersistedClient, type Persister, type PersistedQueryClientSaveOptions } from '@tanstack/react-query-persist-client';

const PERSISTED_QUERY_CACHE_KEY = 'react-query-cache-v2';
const CACHE_WRITE_INTERVAL = 2_000;
let pendingClient: PersistedClient | undefined;
let persistenceTask: Promise<void> | undefined;

/**
 * Message detail queries can contain complete HTML bodies and base64 attachment
 * data. Persisting them makes IndexedDB hydration expensive enough to freeze an
 * Android WebView for several seconds during startup. Thread lists and the
 * other lightweight application queries remain eligible for persistence.
 */
export function shouldPersistQuery(queryKey: readonly unknown[]): boolean {
  return !(queryKey[0] === 'mail' && queryKey[2] === 'thread');
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000, // 30 seconds default
      gcTime: 1000 * 60 * 10, // 10 minutes (avoid memory bloat)
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

/**
 * IndexedDB persister using idb-keyval
 */
async function writeClient(client: PersistedClient): Promise<void> {
  try {
    await set(PERSISTED_QUERY_CACHE_KEY, client);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'DataCloneError') {
      console.warn('[QueryCache] skipped a non-serializable cache snapshot');
      await del(PERSISTED_QUERY_CACHE_KEY);
      return;
    }
    throw error;
  }
}

// Keep only the newest snapshot and serialize writes, including after wake-up.
async function persistPendingClients(): Promise<void> {
  try {
    while (pendingClient) {
      const client = pendingClient;
      pendingClient = undefined;
      if (client) await writeClient(client);
    }
  } finally {
    pendingClient = undefined;
    persistenceTask = undefined;
  }
}

export const indexedDBPersister: Persister = {
  persistClient: (client) => {
    pendingClient = client;
    persistenceTask ??= persistPendingClients();
    return persistenceTask;
  },
  restoreClient: async () => {
    return await get(PERSISTED_QUERY_CACHE_KEY);
  },
  removeClient: async () => {
    pendingClient = undefined;
    // A queued or in-flight snapshot must not recreate a removed cache.
    try {
      await persistenceTask;
    } finally {
      await del(PERSISTED_QUERY_CACHE_KEY);
    }
  },
};

// Batch before dehydration: throttling only persistClient still copies the
// entire cache for every expired query in a burst.
export function subscribeToQueryPersistence(options: PersistedQueryClientSaveOptions): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saving = false;
  let dirty = false;
  let stopped = false;

  const schedule = () => {
    dirty = true;
    if (stopped || saving || timer !== undefined) return;
    timer = setTimeout(async () => {
      timer = undefined;
      dirty = false;
      saving = true;
      try {
        await persistQueryClientSave(options);
      } catch {
        console.warn('[QueryCache] cache persistence failed');
      } finally {
        saving = false;
        if (!stopped && dirty) schedule();
      }
    }, CACHE_WRITE_INTERVAL);
  };
  const onEvent = (event: { type: string }) => {
    if (event.type === 'added' || event.type === 'removed' || event.type === 'updated') schedule();
  };
  const unsubscribeQueries = options.queryClient.getQueryCache().subscribe(onEvent);
  const unsubscribeMutations = options.queryClient.getMutationCache().subscribe(onEvent);
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    unsubscribeQueries();
    unsubscribeMutations();
  };
}
