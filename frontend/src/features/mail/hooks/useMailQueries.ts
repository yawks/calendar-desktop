import { useQuery, useQueries } from '@tanstack/react-query';
import { MailProvider } from '../providers/MailProvider';
import { Folder, MailSearchQuery } from '../types';
import { buildUnreadCounts } from '../utils';
import { useMemo } from 'react';

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
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useAllAccountFolders(accounts: { id: string; provider: MailProvider | null }[]) {
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

  return useMemo(() => {
    const allAccountFolders = new Map<string, any[]>();
    const mergedCounts: Record<string, number> = {};
    const errors: Error[] = [];

    results.forEach((res, idx) => {
      const accountId = accounts[idx].id;
      if (res.data) {
        allAccountFolders.set(accountId, res.data);
        const counts = buildUnreadCounts(res.data);
        for (const [key, val] of Object.entries(counts)) {
          mergedCounts[key] = (mergedCounts[key] ?? 0) + (val as number);
        }
      }
      if (res.error) {
        errors.push(res.error as Error);
      }
    });

    return {
      allAccountFolders,
      mergedCounts,
      errors,
      isLoading: results.some((r) => r.isLoading),
    };
  }, [results, accounts]);
}

export function useMailThreads(accountId: string, folder: Folder, provider: MailProvider | null) {
  return useQuery({
    queryKey: MAIL_KEYS.threads(accountId, folder),
    queryFn: async () => {
      if (!provider) throw new Error('No provider');
      // For now, sticking to 50 threads like original code
      return await provider.listThreads(folder, 50, 0);
    },
    enabled: !!provider,
    refetchInterval: 60 * 1000, // 60s silent refresh equivalent
  });
}

export function useAllAccountThreads(folder: Folder, accounts: { id: string; provider: MailProvider | null; label: string; color?: string }[]) {
  const results = useQueries({
    queries: accounts.map((acc) => ({
      queryKey: MAIL_KEYS.threads(acc.id, folder),
      queryFn: async () => {
        if (!acc.provider) throw new Error('No provider');
        const threads = await acc.provider.listThreads(folder, 50, 0);
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

  return useMemo(() => {
    const merged = results
      .flatMap((r) => (r.data ? r.data : []))
      .sort((a, b) => new Date(b.last_delivery_time).getTime() - new Date(a.last_delivery_time).getTime());

    return {
      data: merged,
      isLoading: results.some((r) => r.isLoading),
      isFetching: results.some((r) => r.isFetching),
      errors: results.map(r => r.error).filter(Boolean),
      refetch: () => results.forEach(r => r.refetch()),
    };
  }, [results]);
}

export function useMailConversation(accountId: string, conversationId: string | null, provider: MailProvider | null) {
  return useQuery({
    queryKey: MAIL_KEYS.thread(accountId, conversationId!),
    queryFn: async () => {
      if (!provider || !conversationId) throw new Error('Invalid params');
      return await provider.getThread(conversationId, false, false);
    },
    enabled: !!provider && !!conversationId,
  });
}

export function useMailSearch(accountId: string, query: MailSearchQuery, provider: MailProvider | null) {
  const queryStr = JSON.stringify(query);
  return useQuery({
    queryKey: MAIL_KEYS.search(accountId, queryStr),
    queryFn: async () => {
      if (!provider) throw new Error('No provider');
      return await provider.searchThreads(query);
    },
    enabled: !!provider && !!query && Object.values(query).some(Boolean),
  });
}
