import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MailProvider, ComposerAttachment } from '../providers/MailProvider';
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

      // Do NOT cancel messagesKey query here to avoid breaking the initial load
      await queryClient.cancelQueries({ queryKey: threadsKey });
      await queryClient.cancelQueries({ queryKey: allThreadsKey });

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
      // Avoid immediate global invalidation to prevent cascading refreshes
      // Rely on optimistic update and background refetchInterval
      // Only invalidate unread count if necessary
      queryClient.invalidateQueries({ queryKey: MAIL_KEYS.unread(variables.accountId) });
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

  const sendMailMutation = useMutation({
    mutationFn: async ({ provider, to, cc, bcc, subject, bodyHtml, attachments, fromIdentityId }: MutationParams & { to: string[], cc: string[], bcc: string[], subject: string, bodyHtml: string, attachments?: ComposerAttachment[], fromIdentityId?: string; conversationId?: string }) => {
      await provider.sendMail({ to, cc, bcc, subject, bodyHtml, attachments, fromIdentityId });
    },
    onMutate: async ({ accountId, conversationId, bodyHtml, subject }: MutationParams & { to: string[], cc: string[], bcc: string[], subject: string, bodyHtml: string, attachments?: ComposerAttachment[], fromIdentityId?: string; conversationId?: string }) => {
      if (!conversationId) return;

      const messagesKey = MAIL_KEYS.thread(accountId, conversationId);
      await queryClient.cancelQueries({ queryKey: messagesKey });
      const previousMessages = queryClient.getQueryData<MailMessage[]>(messagesKey);

      if (previousMessages) {
        const optimisticMsg: MailMessage = {
          item_id: '__optimistic__' + Date.now(),
          change_key: '',
          subject,
          from_name: 'Me',
          from_email: '',
          to_recipients: [],
          cc_recipients: [],
          body_html: bodyHtml,
          date_time_received: new Date().toISOString(),
          is_read: true,
          has_attachments: false,
          attachments: [],
        };
        queryClient.setQueryData<MailMessage[]>(messagesKey, [...previousMessages, optimisticMsg]);
      }
      return { previousMessages };
    },
    onError: (_err, variables, context: any) => {
      if (context?.previousMessages) {
        queryClient.setQueryData(MAIL_KEYS.thread(variables.accountId, (variables as any).conversationId || ''), context.previousMessages);
      }
    },
    onSettled: (_data, _error, variables) => {
      const { accountId, conversationId } = variables as any;
      if (conversationId) {
        queryClient.invalidateQueries({ queryKey: MAIL_KEYS.thread(accountId, conversationId) });
      }
    }
  });

  const markRead = useMemo(() => markReadMutation.mutate, [markReadMutation.mutate]);
  const moveToTrash = useMemo(() => moveToTrashMutation.mutate, [moveToTrashMutation.mutate]);
  const deletePermanently = useMemo(() => deletePermanentlyMutation.mutate, [deletePermanentlyMutation.mutate]);
  const moveThread = useMemo(() => moveThreadMutation.mutate, [moveThreadMutation.mutate]);
  const snoozeThread = useMemo(() => snoozeThreadMutation.mutate, [snoozeThreadMutation.mutate]);

  return {
    markRead,
    moveToTrash,
    deletePermanently,
    moveThread,
    snoozeThread,
    sendMail: (args: MutationParams & { conversationId?: string; to: string[], cc: string[], bcc: string[], subject: string, bodyHtml: string, attachments?: ComposerAttachment[], fromIdentityId?: string }) => sendMailMutation.mutateAsync(args),
    isSending: sendMailMutation.isPending,
  };
}
