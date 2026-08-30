import { QueryClient } from '@tanstack/react-query';
import { get, set, del } from 'idb-keyval';
import { Persister } from '@tanstack/react-query-persist-client';

const PERSISTED_QUERY_CACHE_KEY = 'react-query-cache-v2';

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
export const indexedDBPersister: Persister = {
  persistClient: async (client) => {
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
  },
  restoreClient: async () => {
    return await get(PERSISTED_QUERY_CACHE_KEY);
  },
  removeClient: async () => {
    await del(PERSISTED_QUERY_CACHE_KEY);
  },
};
