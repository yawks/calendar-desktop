import { useCallback, useEffect, useMemo } from 'react';
import { MailThread, MailFolder } from '../types';
import { MailProvider } from '../providers/MailProvider';
import { buildUnreadCounts } from '../folderUtils';

export function useMailLogic({
  allProviders,
  allMailAccounts,
  selectedFolder,
  setThreads,
  setThreadsLoading,
  setThreadsLoadingMore,
  setHasMoreThreads,
  setFolderUnreadCounts,
  setAllAccountFolders,
  setError,
  isAllMode,
  resolveProvider,
  provider,
  setSelectedThread,
  setMessages,
  setReplyingTo,
  setSelectedThreadIds,
  allAccountFolders,
  setMessagesLoading,
  setComposerRestoreData,
  setComposingDraftItemId,
  setComposingAccountId,
  setComposing,
  folderAccountedRef,
  threads,
  hasMoreThreads,
  threadsLoadingMore,
  setMailContacts,
  updateBadge,
}: any) {

  const allModeDynamicFolders = useMemo(() => {
    if (!isAllMode) return null;
    const result: (MailFolder & { accountId: string; accountColor?: string })[] = [];
    const entries = Array.from(allAccountFolders.entries() as IterableIterator<[string, MailFolder[]]>);
    for (const [accountId, folders] of entries) {
      const acc = allMailAccounts.find((a: any) => a.id === accountId);
      for (const f of folders) {
        const STATIC_IDS = new Set(['inbox', 'sentitems', 'deleteditems', 'INBOX', 'SENT', 'TRASH', 'SPAM', 'DRAFT']);
        const WELL_KNOWN_NAMES = new Set(['inbox', 'sent', 'sent items', 'deleted items', 'drafts', 'outbox', 'junk email', 'spam', 'trash', 'boîte de réception', 'éléments envoyés', 'éléments supprimés', 'courrier indésirable', 'brouillons']);
        if (STATIC_IDS.has(f.folder_id) || WELL_KNOWN_NAMES.has(f.display_name.toLowerCase())) continue;
        result.push({ ...f, accountId: accountId as string, accountColor: acc?.color });
      }
    }
    result.sort((a: any, b: any) => a.display_name.localeCompare(b.display_name));
    return result;
  }, [isAllMode, allAccountFolders, allMailAccounts]);

  const loadThreads = useCallback(async () => {
    setThreadsLoading(true);
    setError(null);
    if (folderAccountedRef.current) folderAccountedRef.current.clear();
    try {
      if (isAllMode) {
        const providerEntries = Array.from(allProviders.entries() as IterableIterator<[string, any]>);
        const [threadResults, folderResults] = await Promise.all([
          Promise.allSettled(
            providerEntries.map(async ([accountId, p]) => {
              const acc = allMailAccounts.find((a: any) => a.id === accountId);
              const atIdx = (acc?.email ?? '').indexOf('@');
              const domain = atIdx >= 0 ? (acc?.email ?? '').slice(atIdx + 1) : (acc?.email ?? '');
              const accountLabel = domain.charAt(0).toUpperCase() + domain.slice(1);
              const accountColor = acc?.color;
              const threads = await (p as MailProvider).listThreads(selectedFolder, 50, 0);
              const accountFrom = acc?.name ?? acc?.email ?? null;
              return threads.map((t: any) => ({
                ...t,
                accountId,
                accountLabel,
                accountColor,
                from_name: selectedFolder === 'drafts' ? (t.from_name ?? accountFrom) : t.from_name,
              }));
            })
          ),
          Promise.allSettled(
            providerEntries.map(async ([accountId, p]) => {
               return { accountId, folders: await (p as MailProvider).listFolders() };
            })
          ),
        ]);
        const merged = threadResults
          .flatMap((r: any) => r.status === 'fulfilled' ? (r.value as any) : [])
          .sort((a, b) => new Date(b.last_delivery_time).getTime() - new Date(a.last_delivery_time).getTime());
        setThreads(merged);
        setHasMoreThreads(merged.length >= 50);

        const mergedCounts: Record<string, number> = {};
        const newAccountFolders = new Map<string, MailFolder[]>();
        for (const r of folderResults) {
          if (r.status !== 'fulfilled') continue;
          const { accountId, folders } = r.value as any;
          newAccountFolders.set(accountId, folders);
          const counts = buildUnreadCounts(folders);
          for (const [key, val] of Object.entries(counts)) {
            mergedCounts[key] = (mergedCounts[key] ?? 0) + (val as number);
          }
        }
        setFolderUnreadCounts(mergedCounts);
        setAllAccountFolders(newAccountFolders);
      } else {
        if (!provider) return;
        const result = await provider.listThreads(selectedFolder, 50, 0);
        if (selectedFolder === 'drafts') {
          const acc = allMailAccounts.find((a: any) => a.id === provider.accountId);
          const accountFrom = acc?.name ?? acc?.email ?? null;
          setThreads(result.map((t: any) => ({ ...t, from_name: t.from_name ?? accountFrom })));
        } else {
          setThreads(result);
        }
        setHasMoreThreads(result.length >= 50);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setThreadsLoading(false);
    }
  }, [isAllMode, allProviders, selectedFolder, allMailAccounts, provider, setThreads, setThreadsLoading, setHasMoreThreads, setFolderUnreadCounts, setAllAccountFolders, setError, folderAccountedRef]);

  const loadMoreThreads = useCallback(async () => {
    if (threadsLoadingMore || !hasMoreThreads) return;
    setThreadsLoadingMore(true);
    try {
      if (isAllMode) {
        const perProviderOffset = new Map<string, number>();
        for (const t of threads) {
          if (t.accountId) perProviderOffset.set(t.accountId, (perProviderOffset.get(t.accountId) ?? 0) + 1);
        }
        const providerEntries = Array.from(allProviders.entries() as IterableIterator<[string, any]>);
        const results = await Promise.allSettled(
          providerEntries.map(async ([accountId, p]) => {
            const offset = perProviderOffset.get(accountId) ?? 0;
            const acc = allMailAccounts.find((a: any) => a.id === accountId);
            const atIdx = (acc?.email ?? '').indexOf('@');
            const domain = atIdx >= 0 ? (acc?.email ?? '').slice(atIdx + 1) : (acc?.email ?? '');
            const accountLabel = domain.charAt(0).toUpperCase() + domain.slice(1);
            const accountColor = acc?.color;
            const fetched = await (p as MailProvider).listThreads(selectedFolder, 50, offset);
            return fetched.map((t: any) => ({ ...t, accountId, accountLabel, accountColor }));
          })
        );
        const newThreads = results.flatMap((r: any) => r.status === 'fulfilled' ? (r.value as any) : []);
        if (newThreads.length > 0) {
          setThreads((prev: MailThread[]) => {
            const seen = new Set(prev.map(t => t.conversation_id));
            const fresh = newThreads.filter((t: any) => !seen.has(t.conversation_id));
            return [...prev, ...fresh].sort((a, b) =>
              new Date(b.last_delivery_time).getTime() - new Date(a.last_delivery_time).getTime()
            );
          });
          setHasMoreThreads(newThreads.length >= 50);
        } else {
          setHasMoreThreads(false);
        }
      } else {
        if (!provider) return;
        const result = await provider.listThreads(selectedFolder, 50, threads.length);
        if (result.length > 0) {
          setThreads((prev: MailThread[]) => {
            const seen = new Set(prev.map(t => t.conversation_id));
            return [...prev, ...result.filter((t: any) => !seen.has(t.conversation_id))];
          });
          setHasMoreThreads(result.length >= 50);
        } else {
          setHasMoreThreads(false);
        }
      }
    } catch (e) {
      console.error('[mail] loadMoreThreads error:', e);
    } finally {
      setThreadsLoadingMore(false);
    }
  }, [isAllMode, allProviders, allMailAccounts, provider, threadsLoadingMore, hasMoreThreads, threads, selectedFolder, setThreads, setHasMoreThreads, setThreadsLoadingMore]);

  const openThread = useCallback(async (thread: MailThread) => {
    const p = resolveProvider(thread.accountId);
    if (!p) return;
    if (selectedFolder === 'drafts') {
      setMessagesLoading(true);
      try {
        const result = await p.getThread(thread.conversation_id, false, true);
        const msg = result[0];
        if (msg) {
          setComposerRestoreData({
            isNewMessage: true,
            recipients: msg.to_recipients.map((r: any) => ({ email: r.email, name: r.name ?? undefined })),
            cc: msg.cc_recipients.map((r: any) => ({ email: r.email, name: r.name ?? undefined })),
            bcc: [],
            subject: msg.subject,
            bodyHtml: msg.body_html,
            replyingToMsg: null,
          });
          setComposingDraftItemId(thread.accountId ? { itemId: msg.item_id, accountId: thread.accountId } : null);
          if (thread.accountId) setComposingAccountId(thread.accountId);
          setComposing(true);
          setSelectedThread(null);
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setMessagesLoading(false);
      }
      return;
    }
    setSelectedThread(thread);
    setReplyingTo(null);
    setMessagesLoading(true);
    try {
      const result = await p.getThread(thread.conversation_id, selectedFolder === 'deleteditems', false);
      setMessages(result);
      setThreads((prev: MailThread[]) => prev.map(th => th.conversation_id === thread.conversation_id ? { ...th, unread_count: 0 } : th));
      if (thread.unread_count > 0 && !folderAccountedRef.current.has(thread.conversation_id)) {
        folderAccountedRef.current.add(thread.conversation_id);
        setFolderUnreadCounts((prev: any) => ({ ...prev, [selectedFolder]: Math.max(0, (prev[selectedFolder] ?? 0) - thread.unread_count) }));
      }

      const newContacts: any[] = [];
      for (const msg of result) {
        if (msg.from_email) newContacts.push({ email: msg.from_email, name: msg.from_name ?? undefined });
        for (const r of [...msg.to_recipients, ...msg.cc_recipients]) {
           newContacts.push({ email: r.email, name: r.name ?? undefined });
        }
      }
      setMailContacts((prev: any[]) => {
        const seen = new Set(prev.map(c => c.email.toLowerCase()));
        const unique = newContacts.filter(c => {
          if (seen.has(c.email.toLowerCase())) return false;
          seen.add(c.email.toLowerCase());
          return true;
        });
        return [...prev, ...unique];
      });

    } catch (e) {
      setError(String(e));
    } finally {
      setMessagesLoading(false);
    }
  }, [resolveProvider, selectedFolder, setMessagesLoading, setComposerRestoreData, setComposingDraftItemId, setComposingAccountId, setComposing, setSelectedThread, setError, setReplyingTo, setMessages, setThreads, folderAccountedRef, setFolderUnreadCounts, setMailContacts]);

  const silentRefresh = useCallback(async () => {
    try {
      if (isAllMode) {
        const providerEntries = Array.from(allProviders.entries() as IterableIterator<[string, any]>);
        const [threadResults, folderResults] = await Promise.all([
          Promise.allSettled(
            providerEntries.map(async ([accountId, p]) => {
              const acc = allMailAccounts.find((a: any) => a.id === accountId);
              const atIdx = (acc?.email ?? '').indexOf('@');
              const domain = atIdx >= 0 ? (acc?.email ?? '').slice(atIdx + 1) : (acc?.email ?? '');
              const accountLabel = domain.charAt(0).toUpperCase() + domain.slice(1);
              const accountColor = acc?.color;
              const threads = selectedFolder === 'inbox'
                ? await ((p as MailProvider).forceRefreshInbox?.(50) ?? (p as MailProvider).listThreads(selectedFolder, 50, 0))
                : await (p as MailProvider).listThreads(selectedFolder, 50, 0);
              return threads.map((t: any) => ({ ...t, accountId, accountLabel, accountColor }));
            })
          ),
          Promise.allSettled(
            providerEntries.map(async ([accountId, p]) => {
               return { accountId, folders: await (p as MailProvider).listFolders() };
            })
          ),
        ]);
        const merged = threadResults
          .flatMap((r: any) => r.status === 'fulfilled' ? (r.value as any) : [])
          .sort((a, b) => new Date(b.last_delivery_time).getTime() - new Date(a.last_delivery_time).getTime());
        setThreads(merged);
        const mergedCounts: Record<string, number> = {};
        for (const r of folderResults) {
          if (r.status !== 'fulfilled') continue;
          const { folders } = r.value as any;
          const counts = buildUnreadCounts(folders);
          for (const [key, val] of Object.entries(counts)) {
            mergedCounts[key] = (mergedCounts[key] ?? 0) + (val as number);
          }
        }
        setFolderUnreadCounts(mergedCounts);
      } else {
        if (!provider) return;
        const fresh = selectedFolder === 'inbox'
          ? await (provider.forceRefreshInbox?.(50) ?? provider.listThreads(selectedFolder, 50, 0))
          : await provider.listThreads(selectedFolder, 50, 0);
        setThreads(fresh);
        const folders = await provider.listFolders();
        setFolderUnreadCounts(buildUnreadCounts(folders));
      }
    } catch { /* ignore */ }
  }, [isAllMode, allProviders, provider, selectedFolder, allMailAccounts, setThreads, setFolderUnreadCounts]);

  useEffect(() => {
    const id = setInterval(() => {
      silentRefresh();
      updateBadge();
    }, 60_000);
    return () => clearInterval(id);
  }, [silentRefresh, updateBadge]);

  useEffect(() => {
    setSelectedThread(null);
    setMessages([]);
    setReplyingTo(null);
    setHasMoreThreads(true);
    setSelectedThreadIds(new Set());
    loadThreads();
  }, [loadThreads, setSelectedThread, setMessages, setReplyingTo, setHasMoreThreads, setSelectedThreadIds]);

  return { loadThreads, silentRefresh, loadMoreThreads, openThread, allModeDynamicFolders };
}
