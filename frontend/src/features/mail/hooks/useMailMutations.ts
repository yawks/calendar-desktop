import { useMutation, useQueryClient, QueryKey } from '@tanstack/react-query';
import { MailProvider } from '../providers/MailProvider';
import { MAIL_KEYS } from './useMailQueries';
import { MailThread, MailMessage } from '../types';
import { useMemo } from 'react';

export interface MutationParams {
  accountId: string;
  provider: MailProvider;
}

export function useMailMutations() {
  const queryClient = useQueryClient();

  const markRead = useMutation({
    mutationFn: async ({ provider, conversationId, read }: MutationParams & { conversationId: string; read: boolean }) => {
      const msgs = await provider.getThread(conversationId, false);
      const items = msgs.map(m => ({ item_id: m.item_id, change_key: m.change_key, conversation_id: conversationId }));
      if (read) {
        await provider.markRead(items);
      } else {
        await provider.markUnread(items);
      }
    },
    onMutate: async ({ accountId, conversationId, read }) => {
      await queryClient.cancelQueries({ queryKey: MAIL_KEYS.all });
      const previousQueries = queryClient.getQueriesData({ queryKey: MAIL_KEYS.all });

      // 1. Update threads list(s)
      queryClient.setQueriesData<MailThread[]>({ queryKey: ['mail', accountId, 'threads'] }, (old) => {
        if (!Array.isArray(old)) return old;
        return old.map(t => t.conversation_id === conversationId ? { ...t, unread_count: read ? 0 : t.message_count } : t);
      });

      // 2. Update all-accounts thread list if it exists
      queryClient.setQueriesData<MailThread[]>({ queryKey: ['mail', 'all', 'threads'] }, (old) => {
        if (!Array.isArray(old)) return old;
        return old.map(t => t.conversation_id === conversationId ? { ...t, unread_count: read ? 0 : t.message_count } : t);
      });

      // 3. Update specific conversation messages
      queryClient.setQueryData<MailMessage[]>(MAIL_KEYS.thread(accountId, conversationId), (old) => {
        if (!Array.isArray(old)) return old;
        return old.map(m => ({ ...m, is_read: read }));
      });

      return { previousQueries };
    },
    onError: (_err, _variables, context: any) => {
      if (context?.previousQueries) {
        context.previousQueries.forEach(([queryKey, oldData]: [QueryKey, any]) => {
          queryClient.setQueryData(queryKey, oldData);
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: MAIL_KEYS.all });
    },
  });

  const moveToTrash = useMutation({
    mutationFn: async ({ provider, conversationId }: MutationParams & { conversationId: string }) => {
      const msgs = await provider.getThread(conversationId, false);
      for (const msg of msgs) {
        await provider.moveToTrash(msg.item_id);
      }
    },
    onMutate: async ({ accountId, conversationId }) => {
      await queryClient.cancelQueries({ queryKey: MAIL_KEYS.all });
      const previousQueries = queryClient.getQueriesData({ queryKey: MAIL_KEYS.all });

      queryClient.setQueriesData<MailThread[]>({ queryKey: ['mail', accountId, 'threads'] }, (old) => {
        if (!Array.isArray(old)) return old;
        return old.filter(t => t.conversation_id !== conversationId);
      });
      queryClient.setQueriesData<MailThread[]>({ queryKey: ['mail', 'all', 'threads'] }, (old) => {
        if (!Array.isArray(old)) return old;
        return old.filter(t => t.conversation_id !== conversationId);
      });

      return { previousQueries };
    },
    onError: (_err, _variables, context: any) => {
      if (context?.previousQueries) {
        context.previousQueries.forEach(([queryKey, oldData]: [QueryKey, any]) => {
          queryClient.setQueryData(queryKey, oldData);
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: MAIL_KEYS.all });
    },
  });

  const deletePermanently = useMutation({
    mutationFn: async ({ provider, conversationId }: MutationParams & { conversationId: string }) => {
      const msgs = await provider.getThread(conversationId, true);
      for (const msg of msgs) {
        await provider.permanentlyDelete(msg.item_id);
      }
    },
    onMutate: async ({ accountId, conversationId }) => {
      await queryClient.cancelQueries({ queryKey: MAIL_KEYS.all });
      const previousQueries = queryClient.getQueriesData({ queryKey: MAIL_KEYS.all });

      queryClient.setQueriesData<MailThread[]>({ queryKey: ['mail', accountId, 'threads'] }, (old) => {
        if (!Array.isArray(old)) return old;
        return old.filter(t => t.conversation_id !== conversationId);
      });
      queryClient.setQueriesData<MailThread[]>({ queryKey: ['mail', 'all', 'threads'] }, (old) => {
        if (!Array.isArray(old)) return old;
        return old.filter(t => t.conversation_id !== conversationId);
      });

      return { previousQueries };
    },
    onError: (_err, _variables, context: any) => {
      if (context?.previousQueries) {
        context.previousQueries.forEach(([queryKey, oldData]: [QueryKey, any]) => {
          queryClient.setQueryData(queryKey, oldData);
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: MAIL_KEYS.all });
    },
  });

  const moveThread = useMutation({
    mutationFn: async ({ provider, conversationId, targetFolderId }: MutationParams & { conversationId: string; targetFolderId: string }) => {
      const msgs = await provider.getThread(conversationId, false);
      for (const msg of msgs) {
        await provider.moveToFolder(msg.item_id, targetFolderId);
      }
    },
    onMutate: async ({ accountId, conversationId }) => {
      await queryClient.cancelQueries({ queryKey: MAIL_KEYS.all });
      const previousQueries = queryClient.getQueriesData({ queryKey: MAIL_KEYS.all });

      queryClient.setQueriesData<MailThread[]>({ queryKey: ['mail', accountId, 'threads'] }, (old) => {
        if (!Array.isArray(old)) return old;
        return old.filter(t => t.conversation_id !== conversationId);
      });
      queryClient.setQueriesData<MailThread[]>({ queryKey: ['mail', 'all', 'threads'] }, (old) => {
        if (!Array.isArray(old)) return old;
        return old.filter(t => t.conversation_id !== conversationId);
      });

      return { previousQueries };
    },
    onError: (_err, _variables, context: any) => {
      if (context?.previousQueries) {
        context.previousQueries.forEach(([queryKey, oldData]: [QueryKey, any]) => {
          queryClient.setQueryData(queryKey, oldData);
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: MAIL_KEYS.all });
    },
  });

  const snoozeThread = useMutation({
    mutationFn: async ({ provider, conversationId, until: _until }: MutationParams & { conversationId: string; until: string }) => {
      const msgs = await provider.getThread(conversationId, false);
      if (msgs.length > 0) {
        const lastMsg = msgs[msgs.length - 1];
        await provider.snooze(lastMsg.item_id);
      }
    },
    onMutate: async ({ accountId, conversationId }) => {
      await queryClient.cancelQueries({ queryKey: MAIL_KEYS.all });
      const previousQueries = queryClient.getQueriesData({ queryKey: MAIL_KEYS.all });

      queryClient.setQueriesData<MailThread[]>({ queryKey: ['mail', accountId, 'threads'] }, (old) => {
        if (!Array.isArray(old)) return old;
        return old.filter(t => t.conversation_id !== conversationId);
      });
      queryClient.setQueriesData<MailThread[]>({ queryKey: ['mail', 'all', 'threads'] }, (old) => {
        if (!Array.isArray(old)) return old;
        return old.filter(t => t.conversation_id !== conversationId);
      });

      return { previousQueries };
    },
    onError: (_err, _variables, context: any) => {
      if (context?.previousQueries) {
        context.previousQueries.forEach(([queryKey, oldData]: [QueryKey, any]) => {
          queryClient.setQueryData(queryKey, oldData);
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: MAIL_KEYS.all });
    },
  });

  return useMemo(() => ({
    markRead,
    moveToTrash,
    deletePermanently,
    moveThread,
    snoozeThread,
  }), [markRead, moveToTrash, deletePermanently, moveThread, snoozeThread]);
}
