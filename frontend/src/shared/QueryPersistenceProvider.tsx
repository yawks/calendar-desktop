import { useEffect, useRef, useState, type ReactNode } from 'react';
import { defaultShouldDehydrateQuery, IsRestoringProvider, QueryClientProvider } from '@tanstack/react-query';
import { persistQueryClientRestore } from '@tanstack/react-query-persist-client';
import { indexedDBPersister, queryClient, shouldPersistQuery, subscribeToQueryPersistence } from './queryClient';

const options = {
  queryClient,
  persister: indexedDBPersister,
  buster: 'mail-provider-loading-v6',
  dehydrateOptions: {
    shouldDehydrateQuery: (query: Parameters<typeof defaultShouldDehydrateQuery>[0]) =>
      defaultShouldDehydrateQuery(query) && shouldPersistQuery(query.queryKey),
  },
};

export function QueryPersistenceProvider({ children }: { children: ReactNode }) {
  const [restoring, setRestoring] = useState(true);
  const restoration = useRef<Promise<void>>();
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    // Reuse restoration when React StrictMode replays the effect.
    restoration.current ??= persistQueryClientRestore(options).catch(() => {
      console.warn('[QueryCache] cache restoration failed');
    });
    void restoration.current.then(() => {
      if (!active) return;
      unsubscribe = subscribeToQueryPersistence(options);
      setRestoring(false);
    });
    return () => { active = false; unsubscribe?.(); };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <IsRestoringProvider value={restoring}>{children}</IsRestoringProvider>
    </QueryClientProvider>
  );
}
