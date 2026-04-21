import { useMutation, useQueryClient, QueryKey } from '@tanstack/react-query';
import { MailProvider } from '../providers/MailProvider';
import { MAIL_KEYS } from './useMailQueries';
import { MailThread, MailMessage } from '../types';

export function useMailMutations(accountId: string, provider: MailProvider | null) {
  const queryClient = useQueryClient();

  const markRead = useMutation({
    mutationFn: async ({ conversationId, read }: { conversationId: string; read: boolean }) => {
      if (!provider) throw new Error('No provider');
      const msgs = await provider.getThread(conversationId, false);
      const items = msgs.map(m => ({ item_id: m.item_id, change_key: m.change_key, conversation_id: conversationId }));
      if (read) {
        await provider.markRead(items);
      } else {
        await provider.markUnread(items);
      }
    },
    onMutate: async ({ conversationId, read }: { conversationId: string; read: boolean }) => {
      await queryClient.cancelQueries({ queryKey: MAIL_KEYS.all });

      const previousQueries = queryClient.getQueriesData<MailThread[]>({ queryKey: MAIL_KEYS.all });

      // Target only thread lists, not folders
      queryClient.setQueriesData<MailThread[]>({ queryKey: ['mail', accountId, 'threads'] }, (old: MailThread[] | undefined) => {
        if (!old) return old;
        return old.map((t: MailThread) => {
          if (t.conversation_id === conversationId) {
            return { ...t, unread_count: read ? 0 : t.message_count };
          }
          return t;
        });
      });

      // Also update messages if open
      queryClient.setQueriesData<MailMessage[]>({ queryKey: [...MAIL_KEYS.all, accountId, 'thread', conversationId] }, (old: MailMessage[] | undefined) => {
        if (!old) return old;
        return old.map((m: MailMessage) => ({ ...m, is_read: read }));
      });

      return { previousQueries };
    },
    onError: (_err: any, _newVal: any, context: any) => {
      if (context?.previousQueries) {
        context.previousQueries.forEach(([queryKey, oldData]: [QueryKey, MailThread[] | undefined]) => {
          queryClient.setQueryData(queryKey, oldData);
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: MAIL_KEYS.all });
    },
  });

  const moveToTrash = useMutation({
    mutationFn: async (conversationId: string) => {
      if (!provider) throw new Error('No provider');
      const msgs = await provider.getThread(conversationId, false);
      for (const msg of msgs) {
        await provider.moveToTrash(msg.item_id);
      }
    },
    onMutate: async (conversationId: string) => {
      await queryClient.cancelQueries({ queryKey: MAIL_KEYS.all });
      const previousQueries = queryClient.getQueriesData<MailThread[]>({ queryKey: MAIL_KEYS.all });

      queryClient.setQueriesData<MailThread[]>({ queryKey: ['mail', accountId, 'threads'] }, (old: MailThread[] | undefined) => {
        if (!old) return old;
        return old.filter((t: MailThread) => t.conversation_id !== conversationId);
      });

      return { previousQueries };
    },
    onError: (_err: any, _newVal: any, context: any) => {
      if (context?.previousQueries) {
        context.previousQueries.forEach(([queryKey, oldData]: [QueryKey, MailThread[] | undefined]) => {
          queryClient.setQueryData(queryKey, oldData);
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: MAIL_KEYS.all });
    },
  });

  const deletePermanently = useMutation({
    mutationFn: async (conversationId: string) => {
      if (!provider) throw new Error('No provider');
      const msgs = await provider.getThread(conversationId, true);
      for (const msg of msgs) {
        await provider.permanentlyDelete(msg.item_id);
      }
    },
    onMutate: async (conversationId: string) => {
      await queryClient.cancelQueries({ queryKey: MAIL_KEYS.all });
      const previousQueries = queryClient.getQueriesData<MailThread[]>({ queryKey: MAIL_KEYS.all });

      queryClient.setQueriesData<MailThread[]>({ queryKey: ['mail', accountId, 'threads'] }, (old: MailThread[] | undefined) => {
        if (!old) return old;
        return old.filter((t: MailThread) => t.conversation_id !== conversationId);
      });

      return { previousQueries };
    },
    onError: (_err: any, _newVal: any, context: any) => {
      if (context?.previousQueries) {
        context.previousQueries.forEach(([queryKey, oldData]: [QueryKey, MailThread[] | undefined]) => {
          queryClient.setQueryData(queryKey, oldData);
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: MAIL_KEYS.all });
    },
  });

  const moveThread = useMutation({
    mutationFn: async ({ conversationId, targetFolderId }: { conversationId: string; targetFolderId: string }) => {
      if (!provider) throw new Error('No provider');
      const msgs = await provider.getThread(conversationId, false);
      for (const msg of msgs) {
        await provider.moveToFolder(msg.item_id, targetFolderId);
      }
    },
    onMutate: async ({ conversationId }: { conversationId: string }) => {
      await queryClient.cancelQueries({ queryKey: MAIL_KEYS.all });
      const previousQueries = queryClient.getQueriesData<MailThread[]>({ queryKey: MAIL_KEYS.all });

      queryClient.setQueriesData<MailThread[]>({ queryKey: ['mail', accountId, 'threads'] }, (old: MailThread[] | undefined) => {
        if (!old) return old;
        return old.filter((t: MailThread) => t.conversation_id !== conversationId);
      });

      return { previousQueries };
    },
    onError: (_err: any, _newVal: any, context: any) => {
      if (context?.previousQueries) {
        context.previousQueries.forEach(([queryKey, oldData]: [QueryKey, MailThread[] | undefined]) => {
          queryClient.setQueryData(queryKey, oldData);
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: MAIL_KEYS.all });
    },
  });

  const snoozeThread = useMutation({
    mutationFn: async ({ conversationId, until: _until }: { conversationId: string; until: string }) => {
      if (!provider) throw new Error('No provider');
      const msgs = await provider.getThread(conversationId, false);
      if (msgs.length > 0) {
        const lastMsg = msgs[msgs.length - 1];
        await provider.snooze(lastMsg.item_id);
      }
    },
    onMutate: async ({ conversationId }: { conversationId: string }) => {
      await queryClient.cancelQueries({ queryKey: MAIL_KEYS.all });
      const previousQueries = queryClient.getQueriesData<MailThread[]>({ queryKey: MAIL_KEYS.all });

      queryClient.setQueriesData<MailThread[]>({ queryKey: ['mail', accountId, 'threads'] }, (old: MailThread[] | undefined) => {
        if (!old) return old;
        return old.filter((t: MailThread) => t.conversation_id !== conversationId);
      });

      return { previousQueries };
    },
    onError: (_err: any, _newVal: any, context: any) => {
      if (context?.previousQueries) {
        context.previousQueries.forEach(([queryKey, oldData]: [QueryKey, MailThread[] | undefined]) => {
          queryClient.setQueryData(queryKey, oldData);
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: MAIL_KEYS.all });
    },
  });

  return {
    markRead,
    moveToTrash,
    deletePermanently,
    moveThread,
    snoozeThread,
  };
}
