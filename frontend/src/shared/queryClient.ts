import { QueryClient } from '@tanstack/react-query';
import { get, set, del } from 'idb-keyval';
import { Persister } from '@tanstack/react-query-persist-client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000, // 30 seconds default
      gcTime: 1000 * 60 * 60 * 24, // 24 hours
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
    await set('react-query-cache', client);
  },
  restoreClient: async () => {
    return await get('react-query-cache');
  },
  removeClient: async () => {
    await del('react-query-cache');
  },
};
