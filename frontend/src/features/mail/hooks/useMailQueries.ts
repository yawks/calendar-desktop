import { useQuery, useQueries } from '@tanstack/react-query';
import { MailProvider } from '../providers/MailProvider';
import { Folder, MailSearchQuery } from '../types';
import { buildUnreadCounts } from '../utils';
import { useMemo, useCallback } from 'react';

export const MAIL_KEYS = {
  all: ['mail'] as const,
  folders: (accountId: string) => [...MAIL_KEYS.all, accountId, 'folders'] as const,
  threads: (accountId: string, folder: Folder) => [...MAIL_KEYS.all, accountId, 'threads', folder] as const,
  thread: (accountId: string, conversationId: string) => [...MAIL_KEYS.all, accountId, 'thread', conversationId] as const,
  unread: (accountId: string) => [...MAIL_KEYS.all, accountId, 'unread'] as const,
  search: (accountId: string, query: string) => [...MAIL_KEYS.all, accountId, 'search', query] as const,
};

export function useMailFolders(accountId: string, provider: MailProvider | null) {
  return useQuery({
    queryKey: MAIL_KEYS.folders(accountId),
    queryFn: async () => {
      if (!provider) throw new Error('No provider');
      return await provider.listFolders();
    },
    enabled: !!provider,
    staleTime: 5 * 60 * 1000,
  });
}

export function useAllAccountFolders(accounts: { id: string; provider: MailProvider | null; color?: string }[]) {
  const results = useQueries({
    queries: accounts.map((acc) => ({
      queryKey: MAIL_KEYS.folders(acc.id),
      queryFn: async () => {
        if (!acc.provider) throw new Error('No provider');
        return await acc.provider.listFolders();
      },
      enabled: !!acc.provider,
      staleTime: 5 * 60 * 1000,
    })),
  });

  const dataTimestamps = results.map(r => r.dataUpdatedAt).join(',');
  const errorTimestamps = results.map(r => r.errorUpdatedAt).join(',');
  const loadingState = results.some(r => r.isLoading);

  const allAccountFolders = useMemo(() => {
    const map = new Map<string, any[]>();
    results.forEach((res, idx) => {
      if (res.data) map.set(accounts[idx].id, res.data);
    });
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataTimestamps, accounts]);

  const mergedCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    results.forEach((res) => {
      if (res.data) {
        const c = buildUnreadCounts(res.data);
        for (const [k, v] of Object.entries(c)) {
          counts[k] = (counts[k] ?? 0) + (v as number);
        }
      }
    });
    return counts;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataTimestamps]);

  const errors = useMemo(() =>
    results.map(r => r.error).filter((e): e is Error => !!e),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [errorTimestamps]);

  const allModeDynamicFolders = useMemo(() => {
    return accounts.flatMap((acc, idx) => {
      const folders = results[idx].data ?? [];
      return folders
        .filter(f => !['inbox', 'sentitems', 'deleteditems', 'drafts', 'snoozed'].includes(f.folder_id))
        .map(f => ({ ...f, accountId: acc.id, accountColor: acc.color }));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataTimestamps, accounts]);

  return useMemo(() => ({
    allAccountFolders,
    mergedCounts,
    errors,
    allModeDynamicFolders,
    isLoading: loadingState,
  }), [allAccountFolders, mergedCounts, errors, allModeDynamicFolders, loadingState]);
}

export function useMailThreads(accountId: string, folder: Folder, provider: MailProvider | null, limit = 50, offset = 0) {
  return useQuery({
    queryKey: [...MAIL_KEYS.threads(accountId, folder), limit, offset],
    queryFn: async () => {
      if (!provider) throw new Error('No provider');
      return await provider.listThreads(folder, limit, offset);
    },
    enabled: !!provider,
    refetchInterval: 60 * 1000,
  });
}

export function useAllAccountThreads(folder: Folder, accounts: { id: string; provider: MailProvider | null; label: string; color?: string }[], limit = 50, offset = 0) {
  const results = useQueries({
    queries: accounts.map((acc) => ({
      queryKey: [...MAIL_KEYS.threads(acc.id, folder), limit, offset],
      queryFn: async () => {
        if (!acc.provider) throw new Error('No provider');
        const threads = await acc.provider.listThreads(folder, limit, offset);
        return threads.map(t => ({
          ...t,
          accountId: acc.id,
          accountLabel: acc.label,
          accountColor: acc.color
        }));
      },
      enabled: !!acc.provider,
      refetchInterval: 60 * 1000,
    })),
  });

  const dataTimestamps = results.map(r => r.dataUpdatedAt).join(',');
  const errorTimestamps = results.map(r => r.errorUpdatedAt).join(',');
  const loadingState = results.some(r => r.isLoading);
  const fetchingState = results.some(r => r.isFetching);

  const data = useMemo(() => {
    return results
      .flatMap((r) => (r.data ? r.data : []))
      .sort((a, b) => new Date(b.last_delivery_time).getTime() - new Date(a.last_delivery_time).getTime());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataTimestamps]);

  const errors = useMemo(() =>
    results.map(r => r.error).filter((e): e is Error => !!e),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [errorTimestamps]);

  const refetch = useCallback(() => {
    results.forEach(r => r.refetch());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.length]);

  return useMemo(() => ({
    data,
    isLoading: loadingState,
    isFetching: fetchingState,
    errors,
    refetch,
  }), [data, loadingState, fetchingState, errors, refetch]);
}

export function useMailConversation(accountId: string, conversationId: string | null, provider: MailProvider | null) {
  return useQuery({
    queryKey: MAIL_KEYS.thread(accountId, conversationId ?? 'null'),
    queryFn: async () => {
      if (!provider || !conversationId) throw new Error('Invalid params');
      return await provider.getThread(conversationId, false, false);
    },
    enabled: !!provider && !!conversationId,
  });
}

export function useMailSearch(accountId: string, query: MailSearchQuery, provider: MailProvider | null) {
  const queryStr = JSON.stringify(query);
  const hasQuery = !!query && Object.values(query).some(Boolean);

  return useQuery({
    queryKey: MAIL_KEYS.search(accountId, queryStr),
    queryFn: async () => {
      if (!provider) throw new Error('No provider');
      return await provider.searchThreads(query);
    },
    enabled: !!provider && hasQuery,
  });
}

export function useAllAccountSearch(query: MailSearchQuery, accounts: { id: string; provider: MailProvider | null; label: string; color?: string }[]) {
  const queryStr = JSON.stringify(query);
  const hasQuery = !!query && Object.values(query).some(Boolean);

  const results = useQueries({
    queries: accounts.map((acc) => ({
      queryKey: MAIL_KEYS.search(acc.id, queryStr),
      queryFn: async () => {
        if (!acc.provider) throw new Error('No provider');
        const threads = await acc.provider.searchThreads(query);
        return threads.map(t => ({
          ...t,
          accountId: acc.id,
          accountLabel: acc.label,
          accountColor: acc.color
        }));
      },
      enabled: !!acc.provider && hasQuery,
    })),
  });

  const dataTimestamps = results.map(r => r.dataUpdatedAt).join(',');
  const loadingState = results.some(r => r.isLoading);

  const data = useMemo(() => {
    if (!hasQuery) return [];
    return results
      .flatMap((r) => (r.data ? r.data : []))
      .sort((a, b) => new Date(b.last_delivery_time).getTime() - new Date(a.last_delivery_time).getTime());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataTimestamps, hasQuery]);

  return {
    data,
    isLoading: loadingState,
  };
}
