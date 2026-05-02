import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MailProvider, ComposerAttachment } from '../providers/MailProvider';
import { MAIL_KEYS } from './useMailQueries';
import { MailThread, MailMessage, MailFolder } from '../types';
import { DISPLAY_TO_STATIC } from '../utils';
import { useMemo } from 'react';

export interface MutationParams {
  accountId: string;
  provider: MailProvider;
}

function makeThreadFilter(conversationId: string) {
  return (old: any) => {
    if (!Array.isArray(old)) return old;
    if (old.length > 0 && !('conversation_id' in old[0])) return old;
    if (!old.some((t: MailThread) => t.conversation_id === conversationId)) return old;
    return old.filter((t: MailThread) => t.conversation_id !== conversationId);
  };
}

export function useMailMutations() {
  const queryClient = useQueryClient();

  const markReadMutation = useMutation({
    mutationFn: async ({ provider, conversationId, read, specificMessages }: MutationParams & { conversationId: string; read: boolean; folderId?: string; specificMessages?: MailMessage[]; threadUnreadCount?: number }) => {
      let items: { item_id: string; change_key: string; conversation_id: string }[];
      if (specificMessages && specificMessages.length > 0) {
        items = specificMessages.map(m => ({ item_id: m.item_id, change_key: m.change_key, conversation_id: conversationId }));
      } else {
        const msgs = await provider.getThread(conversationId, false);
        items = msgs.map(m => ({ item_id: m.item_id, change_key: m.change_key, conversation_id: conversationId }));
      }
      if (read) await provider.markRead(items);
      else await provider.markUnread(items);
    },
    onMutate: async ({ accountId, conversationId, read, folderId, specificMessages, threadUnreadCount }) => {
      const threadsKey = ['mail', accountId, 'threads'];
      const allThreadsKey = ['mail', 'all', 'threads'];
      const messagesKey = MAIL_KEYS.thread(accountId, conversationId);
      const foldersKey = MAIL_KEYS.folders(accountId);

      await queryClient.cancelQueries({ queryKey: threadsKey });
      await queryClient.cancelQueries({ queryKey: allThreadsKey });

      const previousThreads = queryClient.getQueryData(threadsKey);
      const previousAllThreads = queryClient.getQueryData(allThreadsKey);
      const previousMessages = queryClient.getQueryData(messagesKey);
      const previousFolders = queryClient.getQueryData(foldersKey);

      // Number of unread messages transitioning to read
      const unreadDelta: number = (() => {
        if (!read) return 0;
        if (specificMessages) return specificMessages.filter(m => !m.is_read).length;
        return threadUnreadCount ?? 0;
      })();

      const updateThreads = (old: any) => {
        if (!Array.isArray(old)) return old;
        if (old.length > 0 && !('conversation_id' in old[0])) return old;
        let changed = false;
        const next = old.map((t: MailThread) => {
          if (t.conversation_id === conversationId) {
            const targetUnread = read ? Math.max(0, t.unread_count - unreadDelta) : t.message_count;
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

      queryClient.setQueriesData<MailMessage[]>({ queryKey: messagesKey }, (old) => {
        if (!Array.isArray(old)) return old;
        if (specificMessages) {
          const ids = new Set(specificMessages.map(m => m.item_id));
          const needsUpdate = old.some(m => ids.has(m.item_id) && m.is_read !== read);
          if (!needsUpdate) return old;
          return old.map(m => ids.has(m.item_id) ? { ...m, is_read: read } : m);
        }
        const needsUpdate = old.some(m => m.is_read !== read);
        if (!needsUpdate) return old;
        return old.map(m => m.is_read === read ? m : { ...m, is_read: read });
      });

      // Optimistically update folder unread count (marking as read only)
      if (read && unreadDelta > 0 && folderId) {
        queryClient.setQueriesData<MailFolder[]>({ queryKey: foldersKey }, (old) => {
          if (!Array.isArray(old)) return old;
          return old.map(f => {
            const staticKey = DISPLAY_TO_STATIC[f.display_name.toLowerCase()] ?? f.folder_id;
            if (f.folder_id === folderId || staticKey === folderId) {
              return { ...f, unread_count: Math.max(0, f.unread_count - unreadDelta) };
            }
            return f;
          });
        });
      }

      return { previousThreads, previousAllThreads, previousMessages, previousFolders };
    },
    onError: (_err, variables, context: any) => {
      const { accountId, conversationId } = variables;
      if (context) {
        queryClient.setQueryData(['mail', accountId, 'threads'], context.previousThreads);
        queryClient.setQueryData(['mail', 'all', 'threads'], context.previousAllThreads);
        queryClient.setQueriesData({ queryKey: MAIL_KEYS.thread(accountId, conversationId) }, () => context.previousMessages);
        if (context.previousFolders !== undefined) {
          queryClient.setQueryData(MAIL_KEYS.folders(accountId), context.previousFolders);
        }
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: MAIL_KEYS.unread(variables.accountId) });
    },
  });

  const moveToTrashMutation = useMutation({
    mutationFn: async ({ provider, conversationId, isDraft }: MutationParams & { conversationId: string; folderId?: string; threadUnreadCount?: number; isDraft?: boolean }) => {
      if (isDraft) {
        // For drafts, conversation_id == item_id — no need to fetch the thread first.
        await provider.moveToTrash(conversationId);
        return;
      }
      const msgs = await provider.getThread(conversationId, false);
      for (const msg of msgs) {
        await provider.moveToTrash(msg.item_id);
      }
    },
    onMutate: async ({ accountId, conversationId, folderId, threadUnreadCount }) => {
      const threadsKey = ['mail', accountId, 'threads'];
      const allThreadsKey = ['mail', 'all', 'threads'];
      const foldersKey = MAIL_KEYS.folders(accountId);

      await queryClient.cancelQueries({ queryKey: threadsKey });
      await queryClient.cancelQueries({ queryKey: allThreadsKey });

      const previousThreads = queryClient.getQueryData(threadsKey);
      const previousAllThreads = queryClient.getQueryData(allThreadsKey);
      const previousFolders = queryClient.getQueryData(foldersKey);

      const unreadDelta = threadUnreadCount ?? 0;

      const filter = makeThreadFilter(conversationId);
      queryClient.setQueriesData<MailThread[]>({ queryKey: threadsKey }, filter);
      queryClient.setQueriesData<MailThread[]>({ queryKey: allThreadsKey }, filter);

      if (unreadDelta > 0 && folderId) {
        queryClient.setQueriesData<MailFolder[]>({ queryKey: foldersKey }, (old) => {
          if (!Array.isArray(old)) return old;
          return old.map(f => {
            const staticKey = DISPLAY_TO_STATIC[f.display_name.toLowerCase()] ?? f.folder_id;
            if (f.folder_id === folderId || staticKey === folderId) {
              return { ...f, unread_count: Math.max(0, f.unread_count - unreadDelta) };
            }
            return f;
          });
        });
      }

      return { previousThreads, previousAllThreads, previousFolders };
    },
    onError: (_err, variables, context: any) => {
      const { accountId } = variables;
      if (context) {
        queryClient.setQueryData(['mail', accountId, 'threads'], context.previousThreads);
        queryClient.setQueryData(['mail', 'all', 'threads'], context.previousAllThreads);
        if (context.previousFolders !== undefined) {
          queryClient.setQueryData(MAIL_KEYS.folders(accountId), context.previousFolders);
        }
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: MAIL_KEYS.unread(variables.accountId) });
    },
  });

  const deletePermanentlyMutation = useMutation({
    mutationFn: async ({ provider, conversationId, isDraft }: MutationParams & { conversationId: string; isDraft?: boolean }) => {
      if (isDraft) {
        await provider.permanentlyDelete(conversationId);
        return;
      }
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

      const filter = makeThreadFilter(conversationId);
      queryClient.setQueriesData<MailThread[]>({ queryKey: threadsKey }, filter);
      queryClient.setQueriesData<MailThread[]>({ queryKey: allThreadsKey }, filter);

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
      queryClient.invalidateQueries({ queryKey: MAIL_KEYS.unread(variables.accountId) });
      queryClient.invalidateQueries({ queryKey: MAIL_KEYS.folders(variables.accountId) });
    },
  });

  const bulkOnMutate = async (accountId: string, conversationIds: string[]) => {
    const threadsKey = ['mail', accountId, 'threads'];
    const allThreadsKey = ['mail', 'all', 'threads'];
    await queryClient.cancelQueries({ queryKey: threadsKey });
    await queryClient.cancelQueries({ queryKey: allThreadsKey });
    const previousThreads = queryClient.getQueryData(threadsKey);
    const previousAllThreads = queryClient.getQueryData(allThreadsKey);
    const idSet = new Set(conversationIds);
    const filter = (old: any) => {
      if (!Array.isArray(old)) return old;
      if (old.length > 0 && !('conversation_id' in old[0])) return old;
      return old.filter((t: MailThread) => !idSet.has(t.conversation_id));
    };
    queryClient.setQueriesData<MailThread[]>({ queryKey: threadsKey }, filter);
    queryClient.setQueriesData<MailThread[]>({ queryKey: allThreadsKey }, filter);
    return { previousThreads, previousAllThreads };
  };

  const bulkDeleteMutation = useMutation({
    mutationFn: async ({ provider, conversationIds, permanent }: MutationParams & { conversationIds: string[]; permanent: boolean }) => {
      if (permanent) {
        await provider.bulkPermanentlyDelete(conversationIds);
      } else {
        await provider.bulkMoveToTrash(conversationIds);
      }
    },
    onMutate: ({ accountId, conversationIds }) => bulkOnMutate(accountId, conversationIds),
    onError: (_err, variables, context: any) => {
      if (context) {
        queryClient.setQueryData(['mail', variables.accountId, 'threads'], context.previousThreads);
        queryClient.setQueryData(['mail', 'all', 'threads'], context.previousAllThreads);
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: MAIL_KEYS.unread(variables.accountId) });
      queryClient.invalidateQueries({ queryKey: MAIL_KEYS.folders(variables.accountId) });
    },
  });

  const bulkMoveMutation = useMutation({
    mutationFn: async ({ provider, conversationIds, targetFolderId }: MutationParams & { conversationIds: string[]; targetFolderId: string }) => {
      await provider.bulkMoveToFolder(conversationIds, targetFolderId);
    },
    onMutate: ({ accountId, conversationIds }) => bulkOnMutate(accountId, conversationIds),
    onError: (_err, variables, context: any) => {
      if (context) {
        queryClient.setQueryData(['mail', variables.accountId, 'threads'], context.previousThreads);
        queryClient.setQueryData(['mail', 'all', 'threads'], context.previousAllThreads);
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: MAIL_KEYS.unread(variables.accountId) });
      queryClient.invalidateQueries({ queryKey: MAIL_KEYS.folders(variables.accountId) });
      queryClient.invalidateQueries({ queryKey: MAIL_KEYS.threads(variables.accountId, variables.targetFolderId) });
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

      const filter = makeThreadFilter(conversationId);
      queryClient.setQueriesData<MailThread[]>({ queryKey: threadsKey }, filter);
      queryClient.setQueriesData<MailThread[]>({ queryKey: allThreadsKey }, filter);

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
      queryClient.invalidateQueries({ queryKey: MAIL_KEYS.unread(variables.accountId) });
      queryClient.invalidateQueries({ queryKey: MAIL_KEYS.folders(variables.accountId) });
      queryClient.invalidateQueries({ queryKey: MAIL_KEYS.threads(variables.accountId, variables.targetFolderId) });
      queryClient.invalidateQueries({ queryKey: MAIL_KEYS.threads(variables.accountId, 'snoozed') });
    },
  });

  const snoozeThreadMutation = useMutation({
    mutationFn: async ({ provider, conversationId, until: _until }: MutationParams & { conversationId: string; until: string }) => {
      if (!provider.snooze) return;
      const msgs = await provider.getThread(conversationId, false);
      // Move every message in the thread to Snoozed so the thread disappears
      // from all regular folders, not just the one containing the last message.
      for (const msg of msgs) {
        await provider.snooze(msg.item_id);
      }
    },
    onMutate: async ({ accountId, conversationId }) => {
      const threadsKey = ['mail', accountId, 'threads'];
      const allThreadsKey = ['mail', 'all', 'threads'];

      await queryClient.cancelQueries({ queryKey: threadsKey });
      await queryClient.cancelQueries({ queryKey: allThreadsKey });

      const previousThreads = queryClient.getQueryData(threadsKey);
      const previousAllThreads = queryClient.getQueryData(allThreadsKey);

      const filter = makeThreadFilter(conversationId);
      queryClient.setQueriesData<MailThread[]>({ queryKey: threadsKey }, filter);
      queryClient.setQueriesData<MailThread[]>({ queryKey: allThreadsKey }, filter);

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
      queryClient.invalidateQueries({ queryKey: MAIL_KEYS.unread(variables.accountId) });
      queryClient.invalidateQueries({ queryKey: MAIL_KEYS.folders(variables.accountId) });
      queryClient.invalidateQueries({ queryKey: MAIL_KEYS.threads(variables.accountId, 'snoozed') });
    },
  });

  const sendMailMutation = useMutation({
    mutationFn: async ({ provider, to, cc, bcc, subject, bodyHtml, attachments, fromIdentityId, inReplyTo, references, replyToItemId, replyToChangeKey, isForward }: MutationParams & { to: string[], cc: string[], bcc: string[], subject: string, bodyHtml: string, attachments?: ComposerAttachment[], fromIdentityId?: string; conversationId?: string; inReplyTo?: string; references?: string; replyToItemId?: string; replyToChangeKey?: string; isForward?: boolean }) => {
      await provider.sendMail({ to, cc, bcc, subject, bodyHtml, attachments, fromIdentityId, inReplyTo, references, replyToItemId, replyToChangeKey, isForward });
    },
    // No onMutate/onSettled: scheduleSend owns the optimistic update and post-send polling.
  });

  // Les fonctions `mutate`/`mutateAsync` sont stables par garantie de React Query —
  // on peut les utiliser directement sans les envelopper dans un useCallback.
  const markRead = markReadMutation.mutate;
  const moveToTrash = moveToTrashMutation.mutate;
  const deletePermanently = deletePermanentlyMutation.mutate;
  const bulkDelete = bulkDeleteMutation.mutate;
  const bulkMove = bulkMoveMutation.mutate;
  const moveThread = moveThreadMutation.mutate;
  const snoozeThread = snoozeThreadMutation.mutate;
  const sendMail = sendMailMutation.mutateAsync;
  const isSending = sendMailMutation.isPending;

  return useMemo(() => ({
    markRead,
    moveToTrash,
    deletePermanently,
    bulkDelete,
    bulkMove,
    moveThread,
    snoozeThread,
    sendMail,
    isSending,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [isSending]);
}
