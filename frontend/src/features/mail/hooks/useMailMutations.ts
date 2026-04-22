import { useMutation, useQueryClient } from '@tanstack/react-query';
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

  const markReadMutation = useMutation({
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
      const threadsKey = ['mail', accountId, 'threads'];
      const allThreadsKey = ['mail', 'all', 'threads'];
      const messagesKey = MAIL_KEYS.thread(accountId, conversationId);

      await queryClient.cancelQueries({ queryKey: threadsKey });
      await queryClient.cancelQueries({ queryKey: allThreadsKey });
      await queryClient.cancelQueries({ queryKey: messagesKey });

      const previousThreads = queryClient.getQueryData(threadsKey);
      const previousAllThreads = queryClient.getQueryData(allThreadsKey);
      const previousMessages = queryClient.getQueryData(messagesKey);

      const updateThreads = (old: any) => {
        if (!Array.isArray(old)) return old;
        if (old.length > 0 && !('conversation_id' in old[0])) return old;

        let changed = false;
        const next = old.map((t: MailThread) => {
          if (t.conversation_id === conversationId) {
            const targetUnread = read ? 0 : t.message_count;
            if (t.unread_count !== targetUnread) {
              changed = true;
              return { ...t, unread_count: targetUnread };
            }
          }
          return t;
        });
        return changed ? next : old;
      };

      queryClient.setQueriesData<MailThread[]>({ queryKey: threadsKey }, updateThreads);
      queryClient.setQueriesData<MailThread[]>({ queryKey: allThreadsKey }, updateThreads);

      queryClient.setQueryData<MailMessage[]>(messagesKey, (old) => {
        if (!Array.isArray(old)) return old;
        const needsUpdate = old.some(m => m.is_read !== read);
        if (!needsUpdate) return old;
        return old.map(m => m.is_read === read ? m : { ...m, is_read: read });
      });

      return { previousThreads, previousAllThreads, previousMessages };
    },
    onError: (_err, variables, context: any) => {
      const { accountId, conversationId } = variables;
      if (context) {
        queryClient.setQueryData(['mail', accountId, 'threads'], context.previousThreads);
        queryClient.setQueryData(['mail', 'all', 'threads'], context.previousAllThreads);
        queryClient.setQueryData(MAIL_KEYS.thread(accountId, conversationId), context.previousMessages);
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: ['mail', variables.accountId, 'threads'] });
      queryClient.invalidateQueries({ queryKey: ['mail', 'all', 'threads'] });
    },
  });

  const moveToTrashMutation = useMutation({
    mutationFn: async ({ provider, conversationId }: MutationParams & { conversationId: string }) => {
      const msgs = await provider.getThread(conversationId, false);
      for (const msg of msgs) {
        await provider.moveToTrash(msg.item_id);
      }
    },
    onMutate: async ({ accountId, conversationId }) => {
      const threadsKey = ['mail', accountId, 'threads'];
      const allThreadsKey = ['mail', 'all', 'threads'];

      await queryClient.cancelQueries({ queryKey: threadsKey });
      await queryClient.cancelQueries({ queryKey: allThreadsKey });

      const previousThreads = queryClient.getQueryData(threadsKey);
      const previousAllThreads = queryClient.getQueryData(allThreadsKey);

      const filterThreads = (old: any) => {
        if (!Array.isArray(old)) return old;
        if (old.length > 0 && !('conversation_id' in old[0])) return old;
        if (!old.some((t: MailThread) => t.conversation_id === conversationId)) return old;
        return old.filter((t: MailThread) => t.conversation_id !== conversationId);
      };

      queryClient.setQueriesData<MailThread[]>({ queryKey: threadsKey }, filterThreads);
      queryClient.setQueriesData<MailThread[]>({ queryKey: allThreadsKey }, filterThreads);

      return { previousThreads, previousAllThreads };
    },
    onError: (_err, variables, context: any) => {
      const { accountId } = variables;
      if (context) {
        queryClient.setQueryData(['mail', accountId, 'threads'], context.previousThreads);
        queryClient.setQueryData(['mail', 'all', 'threads'], context.previousAllThreads);
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: ['mail', variables.accountId, 'threads'] });
      queryClient.invalidateQueries({ queryKey: ['mail', 'all', 'threads'] });
      queryClient.invalidateQueries({ queryKey: ['mail', variables.accountId, 'folders'] });
    },
  });

  const deletePermanentlyMutation = useMutation({
    mutationFn: async ({ provider, conversationId }: MutationParams & { conversationId: string }) => {
      const msgs = await provider.getThread(conversationId, true);
      for (const msg of msgs) {
        await provider.permanentlyDelete(msg.item_id);
      }
    },
    onMutate: async ({ accountId, conversationId }) => {
      const threadsKey = ['mail', accountId, 'threads'];
      const allThreadsKey = ['mail', 'all', 'threads'];

      await queryClient.cancelQueries({ queryKey: threadsKey });
      await queryClient.cancelQueries({ queryKey: allThreadsKey });

      const previousThreads = queryClient.getQueryData(threadsKey);
      const previousAllThreads = queryClient.getQueryData(allThreadsKey);

      const filterThreads = (old: any) => {
        if (!Array.isArray(old)) return old;
        if (old.length > 0 && !('conversation_id' in old[0])) return old;
        if (!old.some((t: MailThread) => t.conversation_id === conversationId)) return old;
        return old.filter((t: MailThread) => t.conversation_id !== conversationId);
      };

      queryClient.setQueriesData<MailThread[]>({ queryKey: threadsKey }, filterThreads);
      queryClient.setQueriesData<MailThread[]>({ queryKey: allThreadsKey }, filterThreads);

      return { previousThreads, previousAllThreads };
    },
    onError: (_err, variables, context: any) => {
      const { accountId } = variables;
      if (context) {
        queryClient.setQueryData(['mail', accountId, 'threads'], context.previousThreads);
        queryClient.setQueryData(['mail', 'all', 'threads'], context.previousAllThreads);
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: ['mail', variables.accountId, 'threads'] });
      queryClient.invalidateQueries({ queryKey: ['mail', 'all', 'threads'] });
      queryClient.invalidateQueries({ queryKey: ['mail', variables.accountId, 'folders'] });
    },
  });

  const moveThreadMutation = useMutation({
    mutationFn: async ({ provider, conversationId, targetFolderId }: MutationParams & { conversationId: string; targetFolderId: string }) => {
      const msgs = await provider.getThread(conversationId, false);
      for (const msg of msgs) {
        await provider.moveToFolder(msg.item_id, targetFolderId);
      }
    },
    onMutate: async ({ accountId, conversationId }) => {
      const threadsKey = ['mail', accountId, 'threads'];
      const allThreadsKey = ['mail', 'all', 'threads'];

      await queryClient.cancelQueries({ queryKey: threadsKey });
      await queryClient.cancelQueries({ queryKey: allThreadsKey });

      const previousThreads = queryClient.getQueryData(threadsKey);
      const previousAllThreads = queryClient.getQueryData(allThreadsKey);

      const filterThreads = (old: any) => {
        if (!Array.isArray(old)) return old;
        if (old.length > 0 && !('conversation_id' in old[0])) return old;
        if (!old.some((t: MailThread) => t.conversation_id === conversationId)) return old;
        return old.filter((t: MailThread) => t.conversation_id !== conversationId);
      };

      queryClient.setQueriesData<MailThread[]>({ queryKey: threadsKey }, filterThreads);
      queryClient.setQueriesData<MailThread[]>({ queryKey: allThreadsKey }, filterThreads);

      return { previousThreads, previousAllThreads };
    },
    onError: (_err, variables, context: any) => {
      const { accountId } = variables;
      if (context) {
        queryClient.setQueryData(['mail', accountId, 'threads'], context.previousThreads);
        queryClient.setQueryData(['mail', 'all', 'threads'], context.previousAllThreads);
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: ['mail', variables.accountId, 'threads'] });
      queryClient.invalidateQueries({ queryKey: ['mail', 'all', 'threads'] });
      queryClient.invalidateQueries({ queryKey: ['mail', variables.accountId, 'folders'] });
    },
  });

  const snoozeThreadMutation = useMutation({
    mutationFn: async ({ provider, conversationId, until: _until }: MutationParams & { conversationId: string; until: string }) => {
      const msgs = await provider.getThread(conversationId, false);
      if (msgs.length > 0) {
        const lastMsg = msgs[msgs.length - 1];
        await provider.snooze(lastMsg.item_id);
      }
    },
    onMutate: async ({ accountId, conversationId }) => {
      const threadsKey = ['mail', accountId, 'threads'];
      const allThreadsKey = ['mail', 'all', 'threads'];

      await queryClient.cancelQueries({ queryKey: threadsKey });
      await queryClient.cancelQueries({ queryKey: allThreadsKey });

      const previousThreads = queryClient.getQueryData(threadsKey);
      const previousAllThreads = queryClient.getQueryData(allThreadsKey);

      const filterThreads = (old: any) => {
        if (!Array.isArray(old)) return old;
        if (old.length > 0 && !('conversation_id' in old[0])) return old;
        if (!old.some((t: MailThread) => t.conversation_id === conversationId)) return old;
        return old.filter((t: MailThread) => t.conversation_id !== conversationId);
      };

      queryClient.setQueriesData<MailThread[]>({ queryKey: threadsKey }, filterThreads);
      queryClient.setQueriesData<MailThread[]>({ queryKey: allThreadsKey }, filterThreads);

      return { previousThreads, previousAllThreads };
    },
    onError: (_err, variables, context: any) => {
      const { accountId } = variables;
      if (context) {
        queryClient.setQueryData(['mail', accountId, 'threads'], context.previousThreads);
        queryClient.setQueryData(['mail', 'all', 'threads'], context.previousAllThreads);
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: ['mail', variables.accountId, 'threads'] });
      queryClient.invalidateQueries({ queryKey: ['mail', 'all', 'threads'] });
      queryClient.invalidateQueries({ queryKey: ['mail', variables.accountId, 'folders'] });
    },
  });

  const markRead = useMemo(() => markReadMutation.mutate, [markReadMutation.mutate]);
  const moveToTrash = useMemo(() => moveToTrashMutation.mutate, [moveToTrashMutation.mutate]);
  const deletePermanently = useMemo(() => deletePermanentlyMutation.mutate, [deletePermanentlyMutation.mutate]);
  const moveThread = useMemo(() => moveThreadMutation.mutate, [moveThreadMutation.mutate]);
  const snoozeThread = useMemo(() => snoozeThreadMutation.mutate, [snoozeThreadMutation.mutate]);

  return useMemo(() => ({
    markRead,
    moveToTrash,
    deletePermanently,
    moveThread,
    snoozeThread,
  }), [markRead, moveToTrash, deletePermanently, moveThread, snoozeThread]);
}
