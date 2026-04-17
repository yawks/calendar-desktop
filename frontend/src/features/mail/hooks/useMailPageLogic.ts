import { useCallback, useEffect, useMemo, useRef, useState, MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { useExchangeAuth } from '../../../shared/store/ExchangeAuthStore';
import { useGoogleAuth } from '../../../shared/store/GoogleAuthStore';
import { useImapAuth } from '../../../shared/store/ImapAuthStore';
import { useTheme } from '../../../shared/store/ThemeStore';
import { useContactSuggestions } from './useContactSuggestions';
import { MailProvider, ComposerAttachment, ProviderType } from '../providers/MailProvider';
import { CachedMailProvider, OnInboxRefreshed } from '../providers/CachedMailProvider';
import { EwsMailProvider } from '../providers/EwsMailProvider';
import { GmailMailProvider } from '../providers/GmailMailProvider';
import { ImapMailProvider } from '../providers/ImapMailProvider';
import { Folder, MailMessage, MailThread, MailAttachment, ComposerRestoreData, MailSearchQuery } from '../types';
import { ALL_ACCOUNTS_ID, THEME_CYCLE, buildUnreadCounts } from '../utils';
import { RecipientEntry } from '../components/RecipientInput';

export function useMailPageLogic() {
  const { t } = useTranslation();
  const { accounts: ewsAccounts, getValidToken: getEwsToken } = useExchangeAuth();
  const { accounts: googleAccounts, getValidToken: getGoogleToken } = useGoogleAuth();
  const { accounts: imapAccounts } = useImapAuth();
  const { preference, setPreference } = useTheme();

  const onInboxRefreshedRef = useRef<OnInboxRefreshed | null>(null);

  const mailEwsAccounts = useMemo(
    () => ewsAccounts.filter(a => !a.enabledCapabilities || a.enabledCapabilities.includes('email')),
    [ewsAccounts]
  );
  const mailGoogleAccounts = useMemo(
    () => googleAccounts.filter(a => !a.enabledCapabilities || a.enabledCapabilities.includes('email')),
    [googleAccounts]
  );

  const allMailAccounts = useMemo(() => [
    ...mailEwsAccounts.map(a => ({ id: a.id, email: a.email, name: a.displayName, providerType: 'ews' as const, color: a.color })),
    ...mailGoogleAccounts.map(a => ({ id: a.id, email: a.email, name: a.name, providerType: 'gmail' as const, color: a.color })),
    ...imapAccounts.map(a => ({ id: a.id, email: a.email, name: a.displayName, providerType: 'imap' as const, color: a.color })),
  ], [mailEwsAccounts, mailGoogleAccounts, imapAccounts]);

  const allProviders = useMemo<Map<string, MailProvider>>(() => {
    const map = new Map<string, MailProvider>();
    for (const a of mailEwsAccounts) {
      map.set(a.id, new CachedMailProvider(
        new EwsMailProvider(a.id, getEwsToken),
        (aid, threads) => onInboxRefreshedRef.current?.(aid, threads),
      ));
    }
    for (const a of mailGoogleAccounts) {
      map.set(a.id, new CachedMailProvider(
        new GmailMailProvider(a.id, getGoogleToken),
        (aid, threads) => onInboxRefreshedRef.current?.(aid, threads),
      ));
    }
    for (const a of imapAccounts) {
      map.set(a.id, new CachedMailProvider(
        new ImapMailProvider(a),
        (aid, threads) => onInboxRefreshedRef.current?.(aid, threads),
      ));
    }
    return map;
  }, [mailEwsAccounts, mailGoogleAccounts, imapAccounts, getEwsToken, getGoogleToken]);

  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    () => allMailAccounts.length > 1 ? ALL_ACCOUNTS_ID : (allMailAccounts[0]?.id ?? ALL_ACCOUNTS_ID)
  );

  const isAllMode = selectedAccountId === ALL_ACCOUNTS_ID;

  const resolveProvider = useCallback((accountId: string | undefined): MailProvider | null => {
    if (accountId) return allProviders.get(accountId) ?? null;
    if (!isAllMode) return allProviders.get(selectedAccountId) ?? null;
    return null;
  }, [allProviders, isAllMode, selectedAccountId]);

  const provider = isAllMode ? null : (allProviders.get(selectedAccountId) ?? null);
  const [selectedFolder, setSelectedFolder] = useState<Folder>('inbox');
  const [threads, setThreads] = useState<MailThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsLoadingMore, setThreadsLoadingMore] = useState(false);
  const [hasMoreThreads, setHasMoreThreads] = useState(true);
  const [selectedThread, setSelectedThread] = useState<MailThread | null>(null);
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  // Stable refs for use inside useCallback/ref callbacks that can't list these as deps
  const selectedThreadRef = useRef<MailThread | null>(null);
  selectedThreadRef.current = selectedThread;
  const messagesRef = useRef<MailMessage[]>([]);
  messagesRef.current = messages;
  const [replyingTo, setReplyingTo] = useState<MailMessage | null>(null);
  const [replyMode, setReplyMode] = useState<'reply' | 'replyAll' | 'forward'>('reply');
  const [composing, setComposing] = useState(false);
  const [composingAccountId, setComposingAccountId] = useState<string>(() => allMailAccounts[0]?.id ?? '');
  const [mailContacts, setMailContacts] = useState<RecipientEntry[]>([]);
  const contacts = useContactSuggestions(mailContacts);
  const [error, setError] = useState<string | null>(null);
  const [deleteToast, setDeleteToast] = useState<{ label: string } | null>(null);
  const [downloadToast, setDownloadToast] = useState<{ name: string; path: string } | null>(null);
  const downloadToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDeletionRef = useRef<{
    revert: () => void;
    execute: () => Promise<void>;
    timerId: ReturnType<typeof setTimeout>;
    conversationId?: string;
  } | null>(null);

  const [sendToast, setSendToast] = useState<{ label: string } | null>(null);
  const [draftToast, setDraftToast] = useState<{ label: string } | null>(null);
  const draftToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [actionToast, setActionToast] = useState<{ label: string } | null>(null);
  const actionToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Search ─────────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState<MailSearchQuery | null>(null);
  const [searchResults, setSearchResults] = useState<MailThread[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());
  const [composerRestoreData, setComposerRestoreData] = useState<ComposerRestoreData | null>(null);
  const [composingDraftItemId, setComposingDraftItemId] = useState<{ itemId: string; accountId: string } | null>(null);
  const pendingSendRef = useRef<{
    execute: () => Promise<void>;
    timerId: ReturnType<typeof setTimeout>;
    restoreData: ComposerRestoreData;
    optimisticConversationId?: string;
  } | null>(null);

  const folderAccountedRef = useRef(new Set<string>());

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    localStorage.getItem('mail-sidebar-collapsed') === 'true'
  );
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('mail-sidebar-width');
    return saved ? Number.parseInt(saved, 10) : 180;
  });
  const [threadListWidth, setThreadListWidth] = useState(() => {
    const saved = localStorage.getItem('mail-threadlist-width');
    return saved ? Number.parseInt(saved, 10) : 280;
  });

  const [snoozedMap, setSnoozedMap] = useState<Record<string, string>>(() => {
    const stored: { itemId: string; accountId: string; snoozeUntil: string; conversationId?: string }[] =
      JSON.parse(localStorage.getItem('mail-snoozed-items') ?? '[]');
    const map: Record<string, string> = {};
    for (const item of stored) {
      if (item.conversationId) map[item.conversationId] = item.snoozeUntil;
    }
    return map;
  });
  const [snoozedByItemId, setSnoozedByItemId] = useState<Record<string, string>>(() => {
    const stored: { itemId: string; snoozeUntil: string }[] =
      JSON.parse(localStorage.getItem('mail-snoozed-items') ?? '[]');
    const map: Record<string, string> = {};
    for (const item of stored) map[item.itemId] = item.snoozeUntil;
    return map;
  });

  const [allFolders, setAllFolders] = useState<import('../types').MailFolder[]>([]);
  const [allAccountFolders, setAllAccountFolders] = useState<Map<string, import('../types').MailFolder[]>>(new Map());
  const [folderUnreadCounts, setFolderUnreadCounts] = useState<Record<string, number>>({});
  const snoozedFolderId = allFolders.find(f => f.display_name === 'Snoozed')?.folder_id;
  const isInSnoozedFolder = snoozedFolderId !== undefined && selectedFolder === snoozedFolderId;

  const handleFoldersLoaded = useCallback((folders: import('../types').MailFolder[]) => {
    setAllFolders(folders);
    setFolderUnreadCounts(buildUnreadCounts(folders));
  }, []);

  const allModeDynamicFolders = useMemo(() => {
    if (!isAllMode) return null;
    const STATIC_IDS = new Set(['inbox', 'sentitems', 'deleteditems', 'INBOX', 'SENT', 'TRASH', 'SPAM', 'DRAFT']);
    const WELL_KNOWN_NAMES = new Set([
      'inbox', 'sent', 'sent items', 'deleted items', 'drafts', 'outbox', 'junk email',
      'spam', 'trash', 'boîte de réception', 'éléments envoyés', 'éléments supprimés',
      'courrier indésirable', 'brouillons',
    ]);
    const result: (import('../types').MailFolder & { accountId: string; accountColor?: string })[] = [];
    for (const [accountId, folders] of allAccountFolders.entries()) {
      const acc = allMailAccounts.find(a => a.id === accountId);
      for (const f of folders) {
        if (STATIC_IDS.has(f.folder_id) || WELL_KNOWN_NAMES.has(f.display_name.toLowerCase())) continue;
        result.push({ ...f, accountId, accountColor: acc?.color });
      }
    }
    result.sort((a, b) => a.display_name.localeCompare(b.display_name));
    return result;
  }, [isAllMode, allAccountFolders, allMailAccounts]);

  useEffect(() => () => {
    if (pendingDeletionRef.current) clearTimeout(pendingDeletionRef.current.timerId);
    if (pendingSendRef.current) {
      clearTimeout(pendingSendRef.current.timerId);
      pendingSendRef.current.execute().catch(() => {});
    }
  }, []);

  const scheduleDeletion = useCallback((
    label: string,
    revert: () => void,
    execute: () => Promise<void>,
    conversationId?: string,
  ) => {
    if (pendingDeletionRef.current) {
      clearTimeout(pendingDeletionRef.current.timerId);
      const { execute: prevExec, revert: prevRevert } = pendingDeletionRef.current;
      pendingDeletionRef.current = null;
      prevExec().catch(e => { prevRevert(); setError(String(e)); });
    }

    const timerId = setTimeout(() => {
      execute().catch(e => { revert(); setError(String(e)); });
      pendingDeletionRef.current = null;
      setDeleteToast(null);
    }, 10_000);

    pendingDeletionRef.current = { revert, execute, timerId, conversationId };
    setDeleteToast({ label });
  }, []);

  const cancelDeletion = useCallback(() => {
    if (!pendingDeletionRef.current) return;
    clearTimeout(pendingDeletionRef.current.timerId);
    pendingDeletionRef.current.revert();
    pendingDeletionRef.current = null;
    setDeleteToast(null);
  }, []);

  const cycleTheme = () => {
    const idx = THEME_CYCLE.indexOf(preference);
    setPreference(THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]);
  };

  useEffect(() => {
    if (!selectedAccountId && allMailAccounts.length > 0) setSelectedAccountId(allMailAccounts[0].id);
  }, [allMailAccounts, selectedAccountId]);

  const loadThreads = useCallback(async () => {
    setThreadsLoading(true);
    setError(null);
    folderAccountedRef.current.clear();
    try {
      if (isAllMode) {
        const [threadResults, folderResults] = await Promise.all([
          Promise.allSettled(
            Array.from(allProviders.entries()).map(async ([accountId, p]) => {
              const acc = allMailAccounts.find(a => a.id === accountId);
              const atIdx = (acc?.email ?? '').indexOf('@');
              const domain = atIdx >= 0 ? (acc?.email ?? '').slice(atIdx + 1) : (acc?.email ?? '');
              const accountLabel = domain.charAt(0).toUpperCase() + domain.slice(1);
              const accountColor = acc?.color;
              const threads = await p.listThreads(selectedFolder, 50, 0);
              const accountFrom = acc?.name ?? acc?.email ?? null;
              return threads.map(t => ({
                ...t,
                accountId,
                accountLabel,
                accountColor,
                from_name: selectedFolder === 'drafts' ? (t.from_name ?? accountFrom) : t.from_name,
              }));
            })
          ),
          Promise.allSettled(
            Array.from(allProviders.entries()).map(async ([accountId, p]) => ({ accountId, folders: await p.listFolders() }))
          ),
        ]);
        const merged = threadResults
          .flatMap(r => r.status === 'fulfilled' ? r.value : [])
          .sort((a, b) => new Date(b.last_delivery_time).getTime() - new Date(a.last_delivery_time).getTime());
        setThreads(merged);
        setHasMoreThreads(merged.length >= 50);
        const mergedCounts: Record<string, number> = {};
        const newAccountFolders = new Map<string, import('../types').MailFolder[]>();
        for (const r of folderResults) {
          if (r.status !== 'fulfilled') continue;
          const { accountId, folders } = r.value as { accountId: string, folders: import('../types').MailFolder[] };
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
          const acc = allMailAccounts.find(a => a.id === provider.accountId);
          const accountFrom = acc?.name ?? acc?.email ?? null;
          setThreads(result.map(t => ({ ...t, from_name: t.from_name ?? accountFrom })));
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
  }, [isAllMode, allProviders, provider, selectedFolder, allMailAccounts]);

  const loadMoreThreads = useCallback(async () => {
    if (threadsLoadingMore || !hasMoreThreads) return;
    setThreadsLoadingMore(true);
    try {
      if (isAllMode) {
        const perProviderOffset = new Map<string, number>();
        for (const t of threads) {
          if (t.accountId) perProviderOffset.set(t.accountId, (perProviderOffset.get(t.accountId) ?? 0) + 1);
        }

        const results = await Promise.allSettled(
          Array.from(allProviders.entries()).map(async ([accountId, p]) => {
            const offset = perProviderOffset.get(accountId) ?? 0;
            const acc = allMailAccounts.find(a => a.id === accountId);
            const atIdx = (acc?.email ?? '').indexOf('@');
            const domain = atIdx >= 0 ? (acc?.email ?? '').slice(atIdx + 1) : (acc?.email ?? '');
            const accountLabel = domain.charAt(0).toUpperCase() + domain.slice(1);
            const accountColor = acc?.color;
            const fetched = await p.listThreads(selectedFolder, 50, offset);
            return fetched.map(t => ({ ...t, accountId, accountLabel, accountColor }));
          })
        );

        const newThreads = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
        if (newThreads.length > 0) {
          setThreads(prev => {
            const seen = new Set(prev.map(t => t.conversation_id));
            const fresh = newThreads.filter(t => !seen.has(t.conversation_id));
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
          setThreads(prev => {
            const seen = new Set(prev.map(t => t.conversation_id));
            return [...prev, ...result.filter(t => !seen.has(t.conversation_id))];
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
  }, [isAllMode, allProviders, allMailAccounts, provider, threadsLoadingMore, hasMoreThreads, threads, selectedFolder]);

  useEffect(() => {
    setSelectedThread(null);
    setMessages([]);
    setReplyingTo(null);
    setHasMoreThreads(true);
    setSelectedThreadIds(new Set());
    loadThreads();
  }, [loadThreads]);

  const updateBadge = useCallback(async () => {
    try {
      if (isAllMode) {
        const counts = await Promise.allSettled(
          Array.from(allProviders.values()).map(p => p.getInboxUnread())
        );
        const total = counts.reduce((sum, r) => sum + (r.status === 'fulfilled' ? (r.value as number) : 0), 0);
        invoke('set_badge_count', { count: total }).catch(() => {});
      } else if (provider) {
        const count = await provider.getInboxUnread();
        invoke('set_badge_count', { count }).catch(() => {});
      }
    } catch { /* Non-critical */ }
  }, [isAllMode, allProviders, provider]);

  onInboxRefreshedRef.current = (accountId: string, freshThreads: MailThread[]) => {
    if (selectedFolder !== 'inbox') return;
    const pendingDeleteCid = pendingDeletionRef.current?.conversationId;
    const filtered = pendingDeleteCid
      ? freshThreads.filter(t => t.conversation_id !== pendingDeleteCid)
      : freshThreads;
    const optimisticCid = pendingSendRef.current?.optimisticConversationId;
    const applyOptimistic = (t: MailThread) =>
      optimisticCid && t.conversation_id === optimisticCid
        ? { ...t, message_count: t.message_count + 1 }
        : t;
    if (isAllMode) {
      const acc = allMailAccounts.find(a => a.id === accountId);
      const atIdx = (acc?.email ?? '').indexOf('@');
      const domain = atIdx >= 0 ? (acc?.email ?? '').slice(atIdx + 1) : (acc?.email ?? '');
      const accountLabel = domain.charAt(0).toUpperCase() + domain.slice(1);
      const accountColor = acc?.color;
      const tagged = filtered.map(t => applyOptimistic({ ...t, accountId, accountLabel, accountColor }));
      setThreads(prev => {
        const others = prev.filter(t => t.accountId !== accountId);
        return [...others, ...tagged].sort((a, b) =>
          new Date(b.last_delivery_time).getTime() - new Date(a.last_delivery_time).getTime()
        );
      });
    } else if (selectedAccountId === accountId) {
      setThreads(filtered.map(applyOptimistic));
    }
    // Auto-refresh the currently open conversation if the server reports new messages
    if (selectedThread) {
      const freshThread = filtered.find(t => t.conversation_id === selectedThread.conversation_id);
      if (freshThread) {
        const realCount = messages.filter(m => m.item_id !== '__optimistic__').length;
        if (freshThread.message_count > realCount) {
          const p = resolveProvider(selectedThread.accountId);
          if (p) {
            p.getThread(selectedThread.conversation_id, false, false)
              .then(result => {
                if (result.length > realCount) {
                  setMessages(result);
                  setThreads(prev => prev.map(th =>
                    th.conversation_id === selectedThread.conversation_id
                      ? { ...th, message_count: result.length }
                      : th
                  ));
                }
              })
              .catch(() => {});
          }
        }
      }
    }
  };

  const silentRefresh = useCallback(async () => {
    try {
      if (isAllMode) {
        const [threadResults, folderResults] = await Promise.all([
          Promise.allSettled(
            Array.from(allProviders.entries()).map(async ([accountId, p]) => {
              const acc = allMailAccounts.find(a => a.id === accountId);
              const atIdx = (acc?.email ?? '').indexOf('@');
              const domain = atIdx >= 0 ? (acc?.email ?? '').slice(atIdx + 1) : (acc?.email ?? '');
              const accountLabel = domain.charAt(0).toUpperCase() + domain.slice(1);
              const accountColor = acc?.color;
              const threads = selectedFolder === 'inbox'
                ? await (p.forceRefreshInbox?.(50) ?? p.listThreads(selectedFolder, 50, 0))
                : await p.listThreads(selectedFolder, 50, 0);
              return threads.map(t => ({ ...t, accountId, accountLabel, accountColor }));
            })
          ),
          Promise.allSettled(
            Array.from(allProviders.entries()).map(async ([accountId, p]) => ({ accountId, folders: await p.listFolders() }))
          ),
        ]);
        const optimisticCidSR = pendingSendRef.current?.optimisticConversationId;
        const pendingDeleteCidSR = pendingDeletionRef.current?.conversationId;
        const merged = threadResults
          .flatMap(r => r.status === 'fulfilled' ? r.value : [])
          .filter(t => !pendingDeleteCidSR || t.conversation_id !== pendingDeleteCidSR)
          .sort((a, b) => new Date(b.last_delivery_time).getTime() - new Date(a.last_delivery_time).getTime())
          .map(t => optimisticCidSR && t.conversation_id === optimisticCidSR
            ? { ...t, message_count: t.message_count + 1 }
            : t);
        setThreads(merged);
        // Auto-refresh currently open conversation if server reports new messages
        const openThread_ = selectedThreadRef.current;
        if (openThread_) {
          const freshThread = merged.find(t => t.conversation_id === openThread_.conversation_id);
          if (freshThread) {
            const currentMsgs = messagesRef.current;
            const realCount = currentMsgs.filter(m => m.item_id !== '__optimistic__').length;
            if (freshThread.message_count > realCount) {
              const p = resolveProvider(openThread_.accountId);
              if (p) {
                p.getThread(openThread_.conversation_id, false, false)
                  .then(result => { if (result.length > realCount) setMessages(result); })
                  .catch(() => {});
              }
            }
          }
        }
        const mergedCounts: Record<string, number> = {};
        const newAccountFolders = new Map<string, import('../types').MailFolder[]>();
        for (const r of folderResults) {
          if (r.status !== 'fulfilled') continue;
          const { accountId, folders } = r.value as { accountId: string, folders: import('../types').MailFolder[] };
          newAccountFolders.set(accountId, folders);
          const counts = buildUnreadCounts(folders);
          for (const [key, val] of Object.entries(counts)) {
            mergedCounts[key] = (mergedCounts[key] ?? 0) + (val as number);
          }
        }
        setFolderUnreadCounts(mergedCounts);
        setAllAccountFolders(newAccountFolders);
      } else if (provider) {
        const fetchThreads = selectedFolder === 'inbox'
          ? provider.forceRefreshInbox?.(50) ?? provider.listThreads(selectedFolder, 50, 0)
          : provider.listThreads(selectedFolder, 50, 0);
        const [result, folders] = await Promise.all([
          fetchThreads,
          provider.listFolders(),
        ]);
        const optimisticCidSR = pendingSendRef.current?.optimisticConversationId;
        const pendingDeleteCidSR2 = pendingDeletionRef.current?.conversationId;
        const adjustedResult = result
          .filter(t => !pendingDeleteCidSR2 || t.conversation_id !== pendingDeleteCidSR2)
          .map(t => optimisticCidSR && t.conversation_id === optimisticCidSR
            ? { ...t, message_count: t.message_count + 1 }
            : t);
        setThreads(adjustedResult);
        setHasMoreThreads(result.length >= 50);
        setFolderUnreadCounts(buildUnreadCounts(folders));
        // Auto-refresh currently open conversation if server reports new messages
        const openThread_ = selectedThreadRef.current;
        if (openThread_) {
          const freshThread = adjustedResult.find(t => t.conversation_id === openThread_.conversation_id);
          if (freshThread) {
            const currentMsgs = messagesRef.current;
            const realCount = currentMsgs.filter(m => m.item_id !== '__optimistic__').length;
            if (freshThread.message_count > realCount) {
              const p = resolveProvider(openThread_.accountId);
              if (p) {
                p.getThread(openThread_.conversation_id, false, false)
                  .then(result => { if (result.length > realCount) setMessages(result); })
                  .catch(() => {});
              }
            }
          }
        }
      }
    } catch { /* Non-critical */ }
  }, [isAllMode, allProviders, provider, selectedFolder, allMailAccounts]);

  useEffect(() => {
    updateBadge();
    const id = setInterval(() => {
      silentRefresh();
      updateBadge();
    }, 60_000);
    return () => clearInterval(id);
  }, [updateBadge, silentRefresh]);

  useEffect(() => {
    const wakeupSnoozed = async () => {
      const key = 'mail-snoozed-items';
      const stored: { itemId: string; accountId: string; snoozeUntil: string; providerType?: 'ews' | 'gmail' }[] =
        JSON.parse(localStorage.getItem(key) ?? '[]');
      const now = new Date();
      const expired = stored.filter(item => new Date(item.snoozeUntil) <= now);
      if (expired.length === 0) return;

      for (const item of expired) {
        try {
          const pt = item.providerType ?? 'ews';
          const tempProvider = pt === 'gmail'
            ? new GmailMailProvider(item.accountId, getGoogleToken)
            : new EwsMailProvider(item.accountId, getEwsToken);
          await tempProvider.moveToFolder(item.itemId, 'inbox');
        } catch { /* best-effort */ }
      }

      const remaining = stored.filter(item => new Date(item.snoozeUntil) > now);
      localStorage.setItem(key, JSON.stringify(remaining));

      if (selectedFolder === 'inbox' && expired.some(i => i.accountId === selectedAccountId)) {
        silentRefresh();
      }
    };

    wakeupSnoozed();
    const id = setInterval(wakeupSnoozed, 60_000);
    return () => clearInterval(id);
  }, [getEwsToken, getGoogleToken, selectedFolder, selectedAccountId, silentRefresh]);

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
            toRecipients: msg.to_recipients.map(r => ({ email: r.email, name: r.name ?? undefined })),
            ccRecipients: msg.cc_recipients.map(r => ({ email: r.email, name: r.name ?? undefined })),
            bccRecipients: [],
            subject: msg.subject,
            body: msg.body_html,
            attachments: [],
            showCc: msg.cc_recipients.length > 0,
            showBcc: false,
            isNewMessage: true,
            replyingToMsg: null
          });
          setComposingDraftItemId(thread.accountId ? { itemId: msg.item_id, accountId: thread.accountId } : null);
          if (thread.accountId) setComposingAccountId(thread.accountId);
          setComposing(true);
          setSelectedThread(null);
        }
      } catch (e) {
        console.error('[mail] openThread error:', e);
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
      setThreads(prev => prev.map(th =>
        th.conversation_id === thread.conversation_id
          ? { ...th, unread_count: 0, message_count: result.length }
          : th
      ));
      if (thread.unread_count > 0 && !folderAccountedRef.current.has(thread.conversation_id)) {
        folderAccountedRef.current.add(thread.conversation_id);
        setFolderUnreadCounts(prev => ({
          ...prev,
          [selectedFolder]: Math.max(0, (prev[selectedFolder] ?? 0) - thread.unread_count),
        }));
      }
      setMailContacts(prev => {
        const map = new Map(prev.map(c => [c.email.toLowerCase(), c]));
        for (const msg of result) {
          const entries = [
            msg.from_email ? { email: msg.from_email, name: msg.from_name ?? undefined } : null,
            ...msg.to_recipients.map(r => ({ email: r.email, name: r.name ?? undefined })),
            ...msg.cc_recipients.map(r => ({ email: r.email, name: r.name ?? undefined })),
          ];
          for (const e of entries) {
            if (!e?.email) continue;
            const key = e.email.toLowerCase();
            if (!map.has(key)) map.set(key, { email: e.email, name: e.name });
          }
        }
        return Array.from(map.values());
      });
    } catch (e) {
      console.error('[mail] openThread error:', e);
      setError(String(e));
    } finally {
      setMessagesLoading(false);
    }
  }, [resolveProvider, selectedFolder]);

  const markRead = useCallback(async (msgs: MailMessage[]) => {
    const p = resolveProvider(selectedThread?.accountId);
    if (!p || msgs.length === 0) return;
    const items = msgs.map(m => ({ item_id: m.item_id, change_key: m.change_key }));
    const ids = msgs.map(m => m.item_id);
    const unreadCount = msgs.filter(m => !m.is_read).length;
    try {
      await p.markRead(items);
      setMessages(prev => prev.map(m =>
        ids.includes(m.item_id) ? { ...m, is_read: true } : m
      ));
      if (unreadCount > 0) {
        setThreads(prev => prev.map(th =>
          th.conversation_id === selectedThread?.conversation_id
            ? { ...th, unread_count: Math.max(0, th.unread_count - unreadCount) }
            : th
        ));
        if (!folderAccountedRef.current.has(selectedThread?.conversation_id ?? '')) {
          setFolderUnreadCounts(prev => ({
            ...prev,
            [selectedFolder]: Math.max(0, (prev[selectedFolder] ?? 0) - unreadCount),
          }));
        }
      }
    } catch (e) {
      console.error('[mail] markRead error:', e);
      setError(String(e));
    }
  }, [resolveProvider, selectedThread, selectedFolder]);

  const toggleRead = useCallback(async (msg: MailMessage) => {
    const p = resolveProvider(selectedThread?.accountId);
    if (!p) return;
    try {
      const items = [{ item_id: msg.item_id, change_key: msg.change_key }];
      if (msg.is_read) {
        await p.markUnread(items);
      } else {
        await p.markRead(items);
      }
      setMessages(prev => prev.map(m =>
        m.item_id === msg.item_id ? { ...m, is_read: !m.is_read } : m
      ));
      setThreads(prev => prev.map(th =>
        th.conversation_id === selectedThread?.conversation_id
          ? { ...th, unread_count: msg.is_read ? th.unread_count + 1 : Math.max(0, th.unread_count - 1) }
          : th
      ));
      setFolderUnreadCounts(prev => ({
        ...prev,
        [selectedFolder]: Math.max(0, (prev[selectedFolder] ?? 0) + (msg.is_read ? 1 : -1)),
      }));
    } catch (e) {
      console.error('[mail] toggleRead error:', e);
      setError(String(e));
    }
  }, [resolveProvider, selectedThread, selectedFolder]);

  const moveToTrash = useCallback((itemId: string) => {
    const p = resolveProvider(selectedThread?.accountId);
    if (!p) return;
    const msgToDelete = messages.find(m => m.item_id === itemId);
    if (!msgToDelete) return;

    const remaining = messages.filter(m => m.item_id !== itemId);
    const removedThread = remaining.length === 0 ? selectedThread : null;
    const convId = selectedThread?.conversation_id;

    const alreadyAccounted = folderAccountedRef.current.has(selectedThread?.conversation_id ?? '');
    const wasUnread = !msgToDelete.is_read && !alreadyAccounted;

    setMessages(remaining);
    if (removedThread) {
      setSelectedThread(null);
      setThreads(prev => prev.filter(th => th.conversation_id !== convId));
    }
    if (wasUnread) {
      setFolderUnreadCounts(prev => ({
        ...prev,
        [selectedFolder]: Math.max(0, (prev[selectedFolder] ?? 0) - 1),
      }));
      if (!removedThread) {
        setThreads(prev => prev.map(th =>
          th.conversation_id === selectedThread?.conversation_id
            ? { ...th, unread_count: Math.max(0, th.unread_count - 1) }
            : th
        ));
        setSelectedThread(prev => prev ? { ...prev, unread_count: Math.max(0, prev.unread_count - 1) } : prev);
      }
    }

    scheduleDeletion(
      t('mail.messageDeleted', 'Message supprimé'),
      () => {
        setMessages(prev => {
          const restored = [...prev, msgToDelete];
          restored.sort((a, b) =>
            new Date(a.date_time_received).getTime() - new Date(b.date_time_received).getTime()
          );
          return restored;
        });
        if (removedThread) {
          setSelectedThread(removedThread);
          setThreads(prev => {
            const restored = [...prev, removedThread];
            restored.sort((a, b) =>
              new Date(b.last_delivery_time).getTime() - new Date(a.last_delivery_time).getTime()
            );
            return restored;
          });
        }
        if (wasUnread) {
          setFolderUnreadCounts(prev => ({
            ...prev,
            [selectedFolder]: (prev[selectedFolder] ?? 0) + 1,
          }));
          if (!removedThread) {
            setThreads(prev => prev.map(th =>
              th.conversation_id === selectedThread?.conversation_id
                ? { ...th, unread_count: th.unread_count + 1 }
                : th
            ));
            setSelectedThread(prev => prev ? { ...prev, unread_count: prev.unread_count + 1 } : prev);
          }
        }
      },
      async () => {
        if (selectedFolder === 'deleteditems') {
          await p.permanentlyDelete(itemId);
        } else {
          await p.moveToTrash(itemId);
        }
        if (convId) (p as CachedMailProvider).evict?.(convId).catch(() => {});
      },
      convId,
    );
  }, [resolveProvider, messages, selectedThread, selectedFolder, scheduleDeletion, t]);

  const handleToggleThreadRead = useCallback(async (thread: MailThread) => {
    const p = resolveProvider(thread.accountId);
    if (!p) return;
    const shouldMarkRead = thread.unread_count > 0;

    const newUnread = shouldMarkRead ? 0 : thread.message_count;
    setThreads(prev => prev.map(th =>
      th.conversation_id === thread.conversation_id
        ? { ...th, unread_count: newUnread }
        : th
    ));
    if (selectedThread?.conversation_id === thread.conversation_id) {
      setSelectedThread(prev => prev ? { ...prev, unread_count: newUnread } : prev);
      setMessages(prev => prev.map(m => ({ ...m, is_read: shouldMarkRead })));
    }
    setFolderUnreadCounts(prev => {
      const delta = shouldMarkRead ? -thread.unread_count : thread.message_count;
      return { ...prev, [selectedFolder]: Math.max(0, (prev[selectedFolder] ?? 0) + delta) };
    });

    try {
      const msgs = await p.getThread(thread.conversation_id, selectedFolder === 'deleteditems');
      const items = msgs.map(m => ({ item_id: m.item_id, change_key: m.change_key }));
      if (shouldMarkRead) {
        await p.markRead(items);
      } else {
        await p.markUnread(items);
      }
    } catch (e) {
      setThreads(prev => prev.map(th =>
        th.conversation_id === thread.conversation_id
          ? { ...th, unread_count: thread.unread_count }
          : th
      ));
      if (selectedThread?.conversation_id === thread.conversation_id) {
        setSelectedThread(prev => prev ? { ...prev, unread_count: thread.unread_count } : prev);
        setMessages(prev => prev.map(m => ({ ...m, is_read: !shouldMarkRead })));
      }
      setError(String(e));
    }
  }, [resolveProvider, selectedThread, selectedFolder]);

  const handleDeleteThread = useCallback((thread: MailThread) => {
    const p = resolveProvider(thread.accountId);
    if (!p) return;

    const wasSelected = selectedThread?.conversation_id === thread.conversation_id;
    const savedMessages = wasSelected ? messages : [];

    let nextThread: MailThread | null = null;
    if (wasSelected) {
      const idx = threads.findIndex(th => th.conversation_id === thread.conversation_id);
      if (idx !== -1) {
        nextThread = threads[idx + 1] ?? threads[idx - 1] ?? null;
      }
    }

    const alreadyAccounted = folderAccountedRef.current.has(thread.conversation_id);
    const unreadToDecrement = alreadyAccounted ? 0 : thread.unread_count;

    setThreads(prev => prev.filter(th => th.conversation_id !== thread.conversation_id));
    if (wasSelected) {
      setMessages([]);
      if (nextThread) {
        openThread(nextThread);
      } else {
        setSelectedThread(null);
      }
    }
    if (unreadToDecrement > 0) {
      setFolderUnreadCounts(prev => ({
        ...prev,
        [selectedFolder]: Math.max(0, (prev[selectedFolder] ?? 0) - unreadToDecrement),
      }));
    }

    const label = thread.message_count > 1
      ? t('mail.messagesDeleted', 'Messages supprimés')
      : t('mail.messageDeleted', 'Message supprimé');

    scheduleDeletion(
      label,
      () => {
        setThreads(prev => {
          const restored = [...prev, thread];
          restored.sort((a, b) =>
            new Date(b.last_delivery_time).getTime() - new Date(a.last_delivery_time).getTime()
          );
          return restored;
        });
        if (wasSelected) {
          setSelectedThread(thread);
          setMessages(savedMessages);
        }
        if (unreadToDecrement > 0) {
          setFolderUnreadCounts(prev => ({
            ...prev,
            [selectedFolder]: (prev[selectedFolder] ?? 0) + unreadToDecrement,
          }));
        }
      },
      async () => {
        const inTrash = selectedFolder === 'deleteditems';
        const isDraft = selectedFolder === 'drafts';
        if (isDraft) {
          await p.permanentlyDelete(thread.conversation_id);
        } else {
          const msgs = await p.getThread(thread.conversation_id, inTrash);
          for (const msg of msgs) {
            if (inTrash) {
              await p.permanentlyDelete(msg.item_id);
            } else {
              await p.moveToTrash(msg.item_id);
            }
          }
        }
        (p as CachedMailProvider).evict?.(thread.conversation_id).catch(() => {});
      },
      thread.conversation_id,
    );
  }, [resolveProvider, selectedThread, messages, selectedFolder, scheduleDeletion, t, threads, openThread]);

  const handleSnooze = useCallback(async (snoozeUntil: string) => {
    const p = resolveProvider(selectedThread?.accountId);
    if (!p || messages.length === 0 || !selectedThread) return;
    const lastMsg = messages[messages.length - 1];
    try {
      await p.snooze(lastMsg.item_id);
      const key = 'mail-snoozed-items';
      const stored: { itemId: string; accountId: string; snoozeUntil: string; conversationId?: string; providerType?: ProviderType }[] =
        JSON.parse(localStorage.getItem(key) ?? '[]');
      stored.push({ itemId: lastMsg.item_id, accountId: p.accountId, snoozeUntil, conversationId: selectedThread.conversation_id, providerType: p.providerType });
      localStorage.setItem(key, JSON.stringify(stored));
      setSnoozedMap(prev => ({ ...prev, [selectedThread.conversation_id]: snoozeUntil }));
      setSnoozedByItemId(prev => ({ ...prev, [lastMsg.item_id]: snoozeUntil }));
      setThreads(prev => prev.filter(t => t.conversation_id !== selectedThread.conversation_id));
      (p as CachedMailProvider).evict?.(selectedThread.conversation_id).catch(() => {});
      setSelectedThread(null);
      setMessages([]);
    } catch (e) { setError(String(e)); }
  }, [resolveProvider, messages, selectedThread]);

  const handleUnsnooze = useCallback(async () => {
    const p = resolveProvider(selectedThread?.accountId);
    if (!p || messages.length === 0 || !selectedThread) return;
    const lastMsg = messages[messages.length - 1];
    try {
      await p.moveToFolder(lastMsg.item_id, 'inbox');
      const key = 'mail-snoozed-items';
      const stored: { itemId: string }[] = JSON.parse(localStorage.getItem(key) ?? '[]');
      localStorage.setItem(key, JSON.stringify(stored.filter(i => i.itemId !== lastMsg.item_id)));
      setSnoozedMap(prev => {
        const next = { ...prev };
        delete next[selectedThread.conversation_id];
        return next;
      });
      setSnoozedByItemId(prev => {
        const next = { ...prev };
        delete next[lastMsg.item_id];
        return next;
      });
      setThreads(prev => prev.filter(t => t.conversation_id !== selectedThread.conversation_id));
      setSelectedThread(null);
      setMessages([]);
    } catch (e) { setError(String(e)); }
  }, [resolveProvider, messages, selectedThread]);

  const handleMove = useCallback(async (targetFolderId: string) => {
    const p = resolveProvider(selectedThread?.accountId);
    if (!p || !selectedThread) return;
    const thread = selectedThread;
    const savedMessages = messages;
    const unreadToDecrement = thread.unread_count;

    const idx = threads.findIndex(th => th.conversation_id === thread.conversation_id);
    const nextThread: MailThread | null = idx !== -1
      ? (threads[idx + 1] ?? threads[idx - 1] ?? null)
      : null;

    setThreads(prev => prev.filter(t => t.conversation_id !== thread.conversation_id));
    setMessages([]);
    if (nextThread) {
      openThread(nextThread);
    } else {
      setSelectedThread(null);
    }
    if (unreadToDecrement > 0) {
      setFolderUnreadCounts(prev => ({
        ...prev,
        [selectedFolder]: Math.max(0, (prev[selectedFolder] ?? 0) - unreadToDecrement),
      }));
    }
    try {
      for (const msg of savedMessages) {
        await p.moveToFolder(msg.item_id, targetFolderId);
      }
      (p as CachedMailProvider).evict?.(thread.conversation_id).catch(() => {});
    } catch (e) {
      setError(String(e));
      setThreads(prev => {
        const restored = [...prev, thread];
        restored.sort((a, b) =>
          new Date(b.last_delivery_time).getTime() - new Date(a.last_delivery_time).getTime()
        );
        return restored;
      });
      setSelectedThread(thread);
      setMessages(savedMessages);
      if (unreadToDecrement > 0) {
        setFolderUnreadCounts(prev => ({
          ...prev,
          [selectedFolder]: (prev[selectedFolder] ?? 0) + unreadToDecrement,
        }));
      }
    }
  }, [resolveProvider, messages, selectedThread, selectedFolder, threads, openThread]);

  const showActionToast = useCallback((label: string) => {
    if (actionToastTimerRef.current) clearTimeout(actionToastTimerRef.current);
    setActionToast({ label });
    actionToastTimerRef.current = setTimeout(() => setActionToast(null), 4000);
  }, []);

  const handleBulkDelete = useCallback(async () => {
    const toDelete = threads.filter(t => selectedThreadIds.has(t.conversation_id));
    if (toDelete.length === 0) return;

    setThreads(prev => prev.filter(t => !selectedThreadIds.has(t.conversation_id)));
    if (selectedThread && selectedThreadIds.has(selectedThread.conversation_id)) {
      setSelectedThread(null);
      setMessages([]);
    }
    setSelectedThreadIds(new Set());
    showActionToast(
      `${toDelete.length} conversation${toDelete.length > 1 ? 's supprimées' : ' supprimée'}`
    );

    for (const thread of toDelete) {
      const p = resolveProvider(thread.accountId);
      if (!p) continue;
      try {
        const inTrash = selectedFolder === 'deleteditems';
        if (selectedFolder === 'drafts') {
          await p.permanentlyDelete(thread.conversation_id);
        } else {
          const msgs = await p.getThread(thread.conversation_id, inTrash);
          for (const msg of msgs) {
            if (inTrash) await p.permanentlyDelete(msg.item_id);
            else await p.moveToTrash(msg.item_id);
          }
        }
        (p as CachedMailProvider).evict?.(thread.conversation_id).catch(() => {});
      } catch (e) {
        setError(String(e));
      }
    }
  }, [threads, selectedThreadIds, selectedThread, resolveProvider, selectedFolder, showActionToast]);

  const handleBulkSnooze = useCallback(async (snoozeUntil: string) => {
    const toSnooze = threads.filter(t => selectedThreadIds.has(t.conversation_id));
    if (toSnooze.length === 0) return;

    setThreads(prev => prev.filter(t => !selectedThreadIds.has(t.conversation_id)));
    if (selectedThread && selectedThreadIds.has(selectedThread.conversation_id)) {
      setSelectedThread(null);
      setMessages([]);
    }
    showActionToast(
      `${toSnooze.length} conversation${toSnooze.length > 1 ? 's snoozées' : ' snoozée'}`
    );

    for (const thread of toSnooze) {
      const p = resolveProvider(thread.accountId);
      if (!p) continue;
      try {
        const msgs = await p.getThread(thread.conversation_id, false);
        const lastMsg = msgs[msgs.length - 1];
        if (!lastMsg) continue;
        await p.snooze(lastMsg.item_id);
        const key = 'mail-snoozed-items';
        const stored: { itemId: string; accountId: string; snoozeUntil: string; conversationId?: string; providerType?: ProviderType }[] =
          JSON.parse(localStorage.getItem(key) ?? '[]');
        stored.push({ itemId: lastMsg.item_id, accountId: p.accountId, snoozeUntil, conversationId: thread.conversation_id, providerType: p.providerType });
        localStorage.setItem(key, JSON.stringify(stored));
        setSnoozedMap(prev => ({ ...prev, [thread.conversation_id]: snoozeUntil }));
        setSnoozedByItemId(prev => ({ ...prev, [lastMsg.item_id]: snoozeUntil }));
        (p as CachedMailProvider).evict?.(thread.conversation_id).catch(() => {});
      } catch (e) {
        setError(String(e));
      }
    }
  }, [threads, selectedThreadIds, selectedThread, resolveProvider, showActionToast]);

  const handleBulkMove = useCallback(async (targetFolderId: string) => {
    const toMove = threads.filter(t => selectedThreadIds.has(t.conversation_id));
    if (toMove.length === 0) return;

    setThreads(prev => prev.filter(t => !selectedThreadIds.has(t.conversation_id)));
    if (selectedThread && selectedThreadIds.has(selectedThread.conversation_id)) {
      setSelectedThread(null);
      setMessages([]);
    }
    showActionToast(
      `${toMove.length} conversation${toMove.length > 1 ? 's déplacées' : ' déplacée'}`
    );

    for (const thread of toMove) {
      const p = resolveProvider(thread.accountId);
      if (!p) continue;
      try {
        const msgs = await p.getThread(thread.conversation_id, false);
        for (const msg of msgs) await p.moveToFolder(msg.item_id, targetFolderId);
        (p as CachedMailProvider).evict?.(thread.conversation_id).catch(() => {});
      } catch (e) {
        setError(String(e));
      }
    }
  }, [threads, selectedThreadIds, selectedThread, resolveProvider, showActionToast]);

  const handleBulkToggleRead = useCallback(async (markAsRead: boolean) => {
    const toUpdate = threads.filter(t => selectedThreadIds.has(t.conversation_id));
    if (toUpdate.length === 0) return;

    setThreads(prev => prev.map(t =>
      selectedThreadIds.has(t.conversation_id)
        ? { ...t, unread_count: markAsRead ? 0 : t.message_count }
        : t
    ));
    showActionToast(
      markAsRead
        ? `${toUpdate.length} conversation${toUpdate.length > 1 ? 's marquées comme lues' : ' marquée comme lue'}`
        : `${toUpdate.length} conversation${toUpdate.length > 1 ? 's marquées comme non lues' : ' marquée comme non lue'}`
    );

    for (const thread of toUpdate) {
      const p = resolveProvider(thread.accountId);
      if (!p) continue;
      try {
        const msgs = await p.getThread(thread.conversation_id, selectedFolder === 'deleteditems');
        const items = msgs.map(m => ({ item_id: m.item_id, change_key: m.change_key }));
        if (markAsRead) await p.markRead(items);
        else await p.markUnread(items);
      } catch (e) {
        setError(String(e));
      }
    }
  }, [threads, selectedThreadIds, resolveProvider, selectedFolder, showActionToast]);

  const [attachmentPreview, setAttachmentPreview] = useState<{
    attachment: MailAttachment; loading: boolean; data: string | null;
  } | null>(null);

  const previewAttachment = useCallback(async (att: MailAttachment) => {
    const p = resolveProvider(selectedThread?.accountId);
    if (!p) return;
    const canPreviewInApp = att.content_type.startsWith('image/') || att.content_type.includes('pdf');
    if (!canPreviewInApp) {
      try { await p.openAttachment(att); } catch (e) { setError(String(e)); }
      return;
    }
    setAttachmentPreview({ attachment: att, loading: true, data: null });
    try {
      const data = await p.getAttachmentData(att);
      setAttachmentPreview({ attachment: att, loading: false, data });
    } catch (e) {
      setError(String(e));
      setAttachmentPreview(null);
    }
  }, [resolveProvider, selectedThread]);

  const downloadAttachment = useCallback(async (att: MailAttachment) => {
    const p = resolveProvider(selectedThread?.accountId);
    if (!p) return;
    try {
      const data = await p.getAttachmentData(att);
      const path = await invoke<string>('save_file_to_downloads', { filename: att.name, data });
      if (downloadToastTimerRef.current) clearTimeout(downloadToastTimerRef.current);
      setDownloadToast({ name: att.name, path });
      downloadToastTimerRef.current = setTimeout(() => setDownloadToast(null), 15000);
    } catch (e) { setError(String(e)); }
  }, [resolveProvider, selectedThread]);

  const getRawAttachmentData = useCallback(async (att: MailAttachment): Promise<string> => {
    const p = resolveProvider(selectedThread?.accountId);
    if (!p) throw new Error('Provider introuvable');
    return p.getAttachmentData(att);
  }, [resolveProvider, selectedThread]);

  const scheduleSend = useCallback(async (
    to: string[],
    cc: string[],
    bcc: string[],
    subject: string,
    body: string,
    restoreData: ComposerRestoreData,
    attachments?: ComposerAttachment[],
    fromAccountId?: string,
  ) => {
    const p = fromAccountId
      ? (allProviders.get(fromAccountId) ?? null)
      : resolveProvider(selectedThread?.accountId);
    if (!p) return;

    if (pendingSendRef.current) {
      clearTimeout(pendingSendRef.current.timerId);
      await pendingSendRef.current.execute().catch(e => setError(String(e)));
    }

    const replyToItemId = restoreData?.replyingToMsg?.item_id ?? null;
    const replyToChangeKey = restoreData?.replyingToMsg?.change_key ?? null;

    // Optimistic update: add the sent message immediately so the thread feels instant.
    const optimisticConversationId = (!restoreData?.isNewMessage && selectedThread)
      ? selectedThread.conversation_id
      : undefined;

    if (optimisticConversationId) {
      const senderAccountId = fromAccountId ?? selectedThread?.accountId;
      const senderAccount = allMailAccounts.find(a => a.id === senderAccountId);
      const optimisticMsg: MailMessage = {
        item_id: '__optimistic__',
        change_key: '',
        subject,
        from_name: senderAccount?.name ?? null,
        from_email: senderAccount?.email ?? null,
        to_recipients: to.map(e => ({ email: e, name: null })),
        cc_recipients: cc.map(e => ({ email: e, name: null })),
        body_html: body,
        date_time_received: new Date().toISOString(),
        is_read: true,
        has_attachments: (attachments?.length ?? 0) > 0,
        attachments: [],
      };
      setMessages(prev => [...prev, optimisticMsg]);
      setThreads(prev => prev.map(th =>
        th.conversation_id === optimisticConversationId
          ? { ...th, message_count: th.message_count + 1 }
          : th
      ));
    }

    const execute = async () => {
      try {
        await p.sendMail({ to, cc, bcc, subject, bodyHtml: body, replyToItemId, replyToChangeKey, attachments });
        if (!restoreData?.isNewMessage && selectedThread) {
          // Evict cache so the next getThread() fetches fresh data from the server.
          // We intentionally do NOT call openThread() here: the server may not have
          // the sent message in the conversation yet, so fetching immediately would
          // replace the optimistic message with stale data. The background refresh
          // (onInboxRefreshed / silentRefresh) will auto-refresh messages once the
          // server's message_count reflects the new reply.
          await (p as CachedMailProvider).evict?.(selectedThread.conversation_id);
        }
      } catch (e) {
        // Roll back the optimistic message on send failure
        if (optimisticConversationId) {
          setMessages(prev => prev.filter(m => m.item_id !== '__optimistic__'));
          setThreads(prev => prev.map(th =>
            th.conversation_id === optimisticConversationId
              ? { ...th, message_count: Math.max(0, th.message_count - 1) }
              : th
          ));
        }
        throw e;
      }
    };

    const timerId = setTimeout(async () => {
      pendingSendRef.current = null;
      setSendToast(null);
      setComposerRestoreData(null);
      execute().catch(e => setError(String(e)));
    }, 5_000);

    pendingSendRef.current = { execute, timerId, restoreData: restoreData as any, optimisticConversationId };
    setComposerRestoreData(restoreData as any);
    setSendToast({ label: t('mail.messageSent', 'Message envoyé') });
    setReplyingTo(null);
    setComposing(false);
  }, [allProviders, allMailAccounts, resolveProvider, selectedThread, t]);

  const cancelSend = useCallback(() => {
    if (!pendingSendRef.current) return;
    clearTimeout(pendingSendRef.current.timerId);
    const { restoreData, optimisticConversationId } = pendingSendRef.current;
    pendingSendRef.current = null;
    setSendToast(null);
    // Remove the optimistic message added on send
    if (optimisticConversationId) {
      setMessages(prev => prev.filter(m => m.item_id !== '__optimistic__'));
      setThreads(prev => prev.map(th =>
        th.conversation_id === optimisticConversationId
          ? { ...th, message_count: Math.max(0, th.message_count - 1) }
          : th
      ));
    }
    setComposerRestoreData(restoreData);
    if ((restoreData as any).isNewMessage) {
      setComposing(true);
    } else {
      setReplyingTo((restoreData as any).replyingToMsg);
    }
  }, []);

  const handleSaveDraft = useCallback((
    accountId: string | undefined,
    to: string[],
    cc: string[],
    bcc: string[],
    subject: string,
    bodyHtml: string,
  ) => {
    const p = resolveProvider(accountId);
    if (!p) return;
    p.saveDraft({ to, cc, bcc, subject, bodyHtml }).catch(e => setError(String(e)));
    if (draftToastTimerRef.current) clearTimeout(draftToastTimerRef.current);
    setDraftToast({ label: t('mail.savedToDrafts', 'Brouillon enregistré') });
    draftToastTimerRef.current = setTimeout(() => {
      setDraftToast(null);
      draftToastTimerRef.current = null;
    }, 3_000);
  }, [resolveProvider, t]);

  const handleSearch = useCallback(async (query: MailSearchQuery | null) => {
    console.log('[handleSearch] called with:', JSON.stringify(query));
    console.log('[handleSearch] isAllMode:', isAllMode, '| provider:', provider?.providerType, provider?.accountId);

    if (!query || Object.values(query).every(v => !v)) {
      console.log('[handleSearch] empty query → clearing search');
      setSearchQuery(null);
      setSearchResults([]);
      return;
    }

    setSearchQuery(query);
    setSearchLoading(true);
    setSelectedThread(null);

    try {
      if (isAllMode) {
        console.log('[handleSearch] ALL mode — providers:', Array.from(allProviders.keys()));
        const results = await Promise.allSettled(
          Array.from(allProviders.entries()).map(async ([accountId, p]) => {
            console.log(`[handleSearch] searching account ${accountId} (${p.providerType})…`);
            const acc = allMailAccounts.find(a => a.id === accountId);
            const atIdx = (acc?.email ?? '').indexOf('@');
            const domain = atIdx >= 0 ? (acc?.email ?? '').slice(atIdx + 1) : (acc?.email ?? '');
            const accountLabel = domain.charAt(0).toUpperCase() + domain.slice(1);
            const accountColor = acc?.color;
            const threads = await p.searchThreads(query);
            console.log(`[handleSearch] account ${accountId} → ${threads.length} results`);
            return threads.map(t => ({ ...t, accountId, accountLabel, accountColor }));
          })
        );
        results.forEach((r, i) => {
          if (r.status === 'rejected') console.error(`[handleSearch] account[${i}] error:`, r.reason);
        });
        const merged = results
          .flatMap(r => r.status === 'fulfilled' ? r.value : [])
          .sort((a, b) => new Date(b.last_delivery_time).getTime() - new Date(a.last_delivery_time).getTime());
        console.log('[handleSearch] total merged results:', merged.length);
        setSearchResults(merged);
      } else {
        if (!provider) {
          console.warn('[handleSearch] no provider available');
          return;
        }
        console.log(`[handleSearch] single provider ${provider.providerType} (${provider.accountId})`);
        const threads = await provider.searchThreads(query);
        console.log(`[handleSearch] → ${threads.length} results`);
        setSearchResults(threads);
      }
    } catch (e) {
      console.error('[handleSearch] error:', e);
      setError(String(e));
    } finally {
      setSearchLoading(false);
    }
  }, [isAllMode, allProviders, allMailAccounts, provider]);

  const startResizingSidebar = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(150, Math.min(300, startWidth + delta));
      setSidebarWidth(newWidth);
      localStorage.setItem('mail-sidebar-width', String(newWidth));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [sidebarWidth]);

  const startResizingThreadList = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = threadListWidth;

    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(200, Math.min(500, startWidth + delta));
      setThreadListWidth(newWidth);
      localStorage.setItem('mail-threadlist-width', String(newWidth));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [threadListWidth]);

  return {
    t, preference, allMailAccounts, selectedAccountId, isAllMode, selectedFolder,
    threads, threadsLoading, threadsLoadingMore, hasMoreThreads, selectedThread,
    messages, messagesLoading, replyingTo, replyMode, composing, composingAccountId,
    contacts, error, deleteToast, downloadToast, sendToast, draftToast, actionToast,
    selectedThreadIds, composerRestoreData, composingDraftItemId, sidebarCollapsed,
    sidebarWidth, threadListWidth, snoozedMap, isInSnoozedFolder, allFolders,
    allAccountFolders, folderUnreadCounts, allModeDynamicFolders, attachmentPreview,
    setSelectedAccountId, setSelectedFolder, setComposing, setComposingAccountId,
    setError, setDownloadToast, cancelDeletion, cycleTheme, loadThreads, loadMoreThreads,
    openThread, markRead, toggleRead, moveToTrash, handleToggleThreadRead,
    handleDeleteThread, handleSnooze, handleUnsnooze, handleMove, handleBulkDelete,
    handleBulkSnooze, handleBulkMove, handleBulkToggleRead, previewAttachment,
    downloadAttachment, getRawAttachmentData, scheduleSend, cancelSend, handleSaveDraft,
    startResizingSidebar, startResizingThreadList, setSidebarCollapsed,
    setSelectedThreadIds, setAttachmentPreview, provider, setReplyingTo, setReplyMode,
    snoozedByItemId, handleFoldersLoaded, setSelectedThread,
    searchQuery, searchResults, searchLoading, handleSearch,
  };
}
