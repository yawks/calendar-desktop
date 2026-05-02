import { useCallback, useEffect, useMemo, useRef, useState, MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { useExchangeAuth } from '../../../shared/store/ExchangeAuthStore';
import { useGoogleAuth } from '../../../shared/store/GoogleAuthStore';
import { useImapAuth } from '../../../shared/store/ImapAuthStore';
import { useJmapAuth } from '../../../shared/store/JmapAuthStore';
import { useTheme } from '../../../shared/store/ThemeStore';
import { useContactSuggestions } from './useContactSuggestions';
import { MailProvider, ComposerAttachment } from '../providers/MailProvider';
import { EwsMailProvider } from '../providers/EwsMailProvider';
import { GmailMailProvider } from '../providers/GmailMailProvider';
import { ImapMailProvider } from '../providers/ImapMailProvider';
import { JmapMailProvider } from '../providers/JmapMailProvider';
import { Folder, MailMessage, MailThread, MailAttachment, ComposerRestoreData, MailSearchQuery } from '../types';
import { ALL_ACCOUNTS_ID, THEME_CYCLE, buildUnreadCounts } from '../utils';
import { RecipientEntry } from '../components/RecipientInput';
import { useQueryClient } from '@tanstack/react-query';
import { MAIL_KEYS, useMailFolders, useAllAccountFolders, useMailThreads, useAllAccountThreads, useMailConversation, useMailSearch, useAllAccountSearch, useMailIdentities } from './useMailQueries';
import { useMailMutations } from './useMailMutations';

export function useMailPageLogic() {
  const { t } = useTranslation();
  const { accounts: ewsAccounts, getValidToken: getEwsToken } = useExchangeAuth();
  const { accounts: googleAccounts, getValidToken: getGoogleToken } = useGoogleAuth();
  const { accounts: imapAccounts } = useImapAuth();
  const { accounts: jmapAccounts } = useJmapAuth();
  const { preference, setPreference } = useTheme();

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
    ...jmapAccounts.map(a => ({ id: a.id, email: a.email, name: a.displayName, providerType: 'jmap' as const, color: a.color })),
  ], [mailEwsAccounts, mailGoogleAccounts, imapAccounts, jmapAccounts]);

  const providersRef = useRef<Map<string, MailProvider>>(new Map());
  const allProviders = useMemo<Map<string, MailProvider>>(() => {
    const current = providersRef.current;
    const next = new Map<string, MailProvider>();

    for (const a of mailEwsAccounts) {
        if (!current.has(a.id) || !(current.get(a.id) instanceof EwsMailProvider)) {
            next.set(a.id, new EwsMailProvider(a.id, getEwsToken));
        } else {
            next.set(a.id, current.get(a.id)!);
        }
    }
    for (const a of mailGoogleAccounts) {
        if (!current.has(a.id) || !(current.get(a.id) instanceof GmailMailProvider)) {
            next.set(a.id, new GmailMailProvider(a.id, getGoogleToken));
        } else {
            next.set(a.id, current.get(a.id)!);
        }
    }
    for (const a of imapAccounts) {
        next.set(a.id, new ImapMailProvider(a)); // IMAP provider is usually cheap to recreate or we could stabilize too
    }
    for (const a of jmapAccounts) {
        next.set(a.id, new JmapMailProvider(a));
    }
    providersRef.current = next;
    return next;
  }, [mailEwsAccounts, mailGoogleAccounts, imapAccounts, jmapAccounts, getEwsToken, getGoogleToken]);

  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    () => allMailAccounts.length > 1 ? ALL_ACCOUNTS_ID : (allMailAccounts[0]?.id ?? ALL_ACCOUNTS_ID)
  );

  const isAllMode = selectedAccountId === ALL_ACCOUNTS_ID;
  const provider = isAllMode ? null : (allProviders.get(selectedAccountId) ?? null);
  const [selectedFolder, setSelectedFolder] = useState<Folder>('inbox');
  const [selectedThread, setSelectedThread] = useState<MailThread | null>(null);
  // Needed before queries so we can load identities for the composing account in all-mode
  const [composingAccountId, setComposingAccountId] = useState<string>(() => allMailAccounts[0]?.id ?? '');

  // --- STATE ---
  const [threadLimit, setThreadLimit] = useState(50);
  const [stableThreads, setStableThreads] = useState<MailThread[]>([]);
  const [searchQuery, setSearchQuery] = useState<MailSearchQuery | null>(null);

  // --- QUERIES ---
  const allAccountInfo = useMemo(() => allMailAccounts.map(a => {
    const atIdx = a.email.indexOf('@');
    const domain = atIdx >= 0 ? a.email.slice(atIdx + 1) : a.email;
    const label = domain.charAt(0).toUpperCase() + domain.slice(1);

    return {
      id: a.id,
      provider: allProviders.get(a.id) ?? null,
      label,
      color: a.color
    };
  }), [allMailAccounts, allProviders]);

  const folderQuery = useMailFolders(selectedAccountId, provider);
  const allFoldersQuery = useAllAccountFolders(allAccountInfo);

  const threadsQuery = useMailThreads(selectedAccountId, selectedFolder, provider, threadLimit, 0);
  const allThreadsQuery = useAllAccountThreads(selectedFolder, allAccountInfo, threadLimit, 0);

  // Refs pour que loadThreads puisse appeler refetch sans avoir les queries dans ses deps.
  const threadsRefetchRef = useRef(threadsQuery.refetch);
  threadsRefetchRef.current = threadsQuery.refetch;
  const allThreadsRefetchRef = useRef(allThreadsQuery.refetch);
  allThreadsRefetchRef.current = allThreadsQuery.refetch;

  const rawThreads = isAllMode ? allThreadsQuery.data : threadsQuery.data;
  const threadsLoading = isAllMode ? allThreadsQuery.isLoading : threadsQuery.isLoading;
  const threadsFetching = isAllMode ? allThreadsQuery.isFetching : threadsQuery.isFetching;

  // IDs masqués de façon optimiste — filtrés du display indépendamment du cache React Query,
  // ce qui empêche tout refetch (focus fenêtre, interval 60s) de les faire réapparaître.
  const [pendingRemovalIds, setPendingRemovalIds] = useState<Set<string>>(new Set());
  const threads = useMemo(
    () => stableThreads.filter(t => !pendingRemovalIds.has(t.conversation_id)),
    [stableThreads, pendingRemovalIds],
  );

  const hasMoreThreads = rawThreads.length >= threadLimit;
  const threadsLoadingMore = threadsFetching && stableThreads.length > 0;

  // Always keep a ref to the latest rawThreads so the reset effect can read it
  // synchronously without adding it to the dependency array.
  const rawThreadsRef = useRef(rawThreads);
  rawThreadsRef.current = rawThreads;

  // Accumulate threads without ever clearing during a load-more fetch.
  // Only reset when the user navigates to a different folder/account/search.
  useEffect(() => {
    if (rawThreads.length > 0) setStableThreads(rawThreads);
  }, [rawThreads]);

  useEffect(() => {
    // Initialise immediately with whatever the cache already has (may be [] if uncached).
    // Using the ref avoids a stale closure while keeping rawThreads out of the dep array.
    setStableThreads(rawThreadsRef.current);
    setThreadLimit(50);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId, selectedFolder, searchQuery]);

  const conversationQuery = useMailConversation(
    selectedThread?.accountId ?? selectedAccountId,
    selectedThread?.conversation_id ?? null,
    allProviders.get(selectedThread?.accountId ?? selectedAccountId) ?? provider,
    selectedFolder === 'drafts'
  );

  // Pending optimistic messages stored in React state (not in RQ cache) so they
  // survive any cache refetch triggered by polling, window focus, or manual refresh.
  const [pendingOptimisticMsgs, setPendingOptimisticMsgs] = useState<Map<string, MailMessage[]>>(new Map());

  const messages = useMemo(() => {
    const base = conversationQuery.data ?? [];
    const convId = selectedThread?.conversation_id;
    if (!convId) return base;
    const pending = pendingOptimisticMsgs.get(convId);
    if (!pending?.length) return base;
    return [...base, ...pending];
  }, [conversationQuery.data, selectedThread?.conversation_id, pendingOptimisticMsgs]);

  const messagesLoading = conversationQuery.isLoading;

  const searchSingleQuery = useMailSearch(selectedAccountId, searchQuery!, isAllMode ? null : provider);
  const searchAllQuery = useAllAccountSearch(searchQuery!, allAccountInfo);

  const searchResults = isAllMode ? searchAllQuery.data : searchSingleQuery.data;
  const searchLoading = isAllMode ? searchAllQuery.isLoading : searchSingleQuery.isLoading;

  // In all-mode, load identities for the thread's account (reply) or the composing account (new)
  const identityAccountId = isAllMode
    ? (selectedThread?.accountId ?? composingAccountId)
    : selectedAccountId;
  const identityProvider = allProviders.get(identityAccountId) ?? null;
  const identitiesQuery = useMailIdentities(identityAccountId, identityProvider);
  const accountIdentities = identitiesQuery.data;

  const EMPTY_FOLDERS = useMemo(() => [] as import('../types').MailFolder[], []);
  const allFolders = isAllMode ? EMPTY_FOLDERS : (folderQuery.data ?? EMPTY_FOLDERS);
  const allAccountFolders = allFoldersQuery.allAccountFolders;
  const allModeDynamicFolders = allFoldersQuery.allModeDynamicFolders;

  const folderUnreadCounts = useMemo(() => {
    if (isAllMode) return allFoldersQuery.mergedCounts;
    if (folderQuery.data) return buildUnreadCounts(folderQuery.data);
    return {};
  }, [isAllMode, allFoldersQuery.mergedCounts, folderQuery.data]);

  const sidebarDynamicFolders = useMemo(() => {
    if (isAllMode) return allModeDynamicFolders;
    const info = allAccountInfo.find(a => a.id === selectedAccountId);
    return (folderQuery.data ?? [])
      .filter(f => !['inbox', 'sentitems', 'deleteditems', 'drafts', 'snoozed'].includes(f.folder_id))
      .map(f => ({ ...f, accountId: selectedAccountId, accountColor: info?.color, accountLabel: info?.label }));
  }, [isAllMode, allModeDynamicFolders, folderQuery.data, selectedAccountId, allAccountInfo]);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const threadErrors = isAllMode ? allThreadsQuery.errors : (threadsQuery.error ? [threadsQuery.error] : []);
    const allErrors = [...threadErrors, ...allFoldersQuery.errors] as Error[];
    if (allErrors.length > 0) {
      const msg = allErrors[0].message;
      setError(prev => prev === msg ? prev : msg);
    }
  }, [isAllMode, allThreadsQuery.errors, threadsQuery.error, allFoldersQuery.errors]);

  // --- MUTATIONS ---
  const mutations = useMailMutations();
  const queryClient = useQueryClient();

  const [replyingTo, setReplyingTo] = useState<MailMessage | null>(null);
  const [replyMode, setReplyMode] = useState<'reply' | 'replyAll' | 'forward'>('reply');
  const [composing, setComposing] = useState(false);
  const [mailContacts] = useState<RecipientEntry[]>([]);
  const contacts = useContactSuggestions(mailContacts);
  const [deleteToast, setDeleteToast] = useState<{ label: string } | null>(null);
  const [actionToast, setActionToast] = useState<{ label: string; onCancel?: () => void } | null>(null);
  const [downloadToast, setDownloadToast] = useState<{ name: string; path: string } | null>(null);
  const downloadToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('mail-sidebar-collapsed') === 'true');
  const [sidebarWidth, setSidebarWidth] = useState(() => Number(localStorage.getItem('mail-sidebar-width') || 220));
  const [threadListWidth, setThreadListWidth] = useState(() => Number(localStorage.getItem('mail-threadlist-width') || 350));
  const [snoozedMap, setSnoozedMap] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('mail-snoozed') ?? '{}'); } catch { return {}; }
  });
  const [attachmentPreview, setAttachmentPreview] = useState<{
    attachment: MailAttachment; loading: boolean; data: string | null;
  } | null>(null);
  const [composerRestoreData, setComposerRestoreData] = useState<ComposerRestoreData | null>(null);
  const [composingDraftItemId, setComposingDraftItemId] = useState<string | null>(null);

  // ── Draft-reply map: conversationId → saved draft data ──────────────────────
  // Stored in localStorage so drafts survive page reloads.
  interface DraftReplyEntry {
    draftItemId: string;
    accountId: string;
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    body: string;
  }
  const DRAFT_MAP_KEY = 'mail-draft-reply-map';
  const loadDraftReplyMap = (): Map<string, DraftReplyEntry> => {
    try {
      const raw = localStorage.getItem(DRAFT_MAP_KEY);
      if (!raw) return new Map();
      const obj = JSON.parse(raw) as Record<string, DraftReplyEntry>;
      return new Map(Object.entries(obj));
    } catch { return new Map(); }
  };
  const persistDraftReplyMap = (map: Map<string, DraftReplyEntry>) => {
    const obj: Record<string, DraftReplyEntry> = {};
    map.forEach((v, k) => { obj[k] = v; });
    localStorage.setItem(DRAFT_MAP_KEY, JSON.stringify(obj));
  };

  const [draftReplyMap, setDraftReplyMap] = useState<Map<string, DraftReplyEntry>>(loadDraftReplyMap);

  // Expose as a stable Set for thread-list chips
  const draftConversationIds = useMemo(() => new Set(draftReplyMap.keys()), [draftReplyMap]);

  // Stable ref so Effect 1 can read the latest map without re-running every time it updates.
  const draftReplyMapRef = useRef(draftReplyMap);
  draftReplyMapRef.current = draftReplyMap;

  // Effect 1: restore composerRestoreData from local map when navigating to a conversation.
  // Deps: only thread/folder — NOT the map itself, so saving a draft while viewing the same
  // conversation doesn't immediately re-open the composer.
  useEffect(() => {
    const convId = selectedThread?.conversation_id ?? null;
    if (selectedFolder === 'drafts' || !convId) {
      setComposerRestoreData(null);
      setComposingDraftItemId(null);
      return;
    }
    const mapped = draftReplyMapRef.current.get(convId);
    if (!mapped) {
      setComposerRestoreData(null);
      setComposingDraftItemId(null);
      return;
    }
    setComposingDraftItemId(mapped.draftItemId || null);
    setComposerRestoreData({
      toRecipients: mapped.to.map(email => ({ email })),
      ccRecipients: mapped.cc.map(email => ({ email })),
      bccRecipients: mapped.bcc.map(email => ({ email })),
      subject: mapped.subject,
      body: mapped.body,
      attachments: [],
      showCc: mapped.cc.length > 0,
      showBcc: mapped.bcc.length > 0,
      isNewMessage: false,
      replyingToMsg: null,
      draftItemId: mapped.draftItemId || undefined,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedThread?.conversation_id, selectedFolder]);

  // Effect 2: once conversation messages load, set replyingTo so ThreadDetail renders the
  // composer, and update replyingToMsg for the quoted block.
  // Gate: composerRestoreData is non-null and is a reply (not a new message).
  const hasRestoreDraft = !!composerRestoreData && composerRestoreData.isNewMessage === false;
  useEffect(() => {
    if (!hasRestoreDraft) return;
    const msgs = conversationQuery.data ?? [];
    const lastMsg = msgs.filter((m: MailMessage) => !m.is_draft).slice(-1)[0] ?? null;
    if (!lastMsg) return;
    setReplyingTo(prev => (prev?.item_id === lastMsg.item_id ? prev : lastMsg));
    setReplyMode('reply');
    setComposerRestoreData(prev =>
      prev && prev.replyingToMsg?.item_id !== lastMsg.item_id
        ? { ...prev, replyingToMsg: lastMsg }
        : prev,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationQuery.data, hasRestoreDraft]);

  const pendingActionRef = useRef<{
    id: string;
    timerId: ReturnType<typeof setTimeout>;
    execute: () => void;
    rollback: () => void;
  } | null>(null);

  const isInSnoozedFolder = selectedFolder === 'snoozed';

  const resolveProvider = useCallback((accountId: string | undefined): MailProvider | null => {
    if (accountId) return allProviders.get(accountId) ?? null;
    if (!isAllMode) return allProviders.get(selectedAccountId) ?? null;
    return null;
  }, [allProviders, isAllMode, selectedAccountId]);

  const threadSupportsSnooze = useMemo(() => {
    const p = resolveProvider(selectedThread?.accountId);
    return p?.supportsSnooze ?? false;
  }, [resolveProvider, selectedThread?.accountId]);

  const openThread = useCallback((thread: MailThread) => {
    setSelectedThread(thread);
  }, []);

  const cancelDeletion = useCallback(() => {
    if (!pendingActionRef.current) return;
    clearTimeout(pendingActionRef.current.timerId);
    pendingActionRef.current.rollback();
    pendingActionRef.current = null;
    setDeleteToast(null);
  }, []);

  // Quand une nouvelle action arrive alors qu'une autre est déjà en attente,
  // on exécute immédiatement l'action précédente plutôt que de la rollbacker.
  const flushPendingAction = useCallback(() => {
    if (!pendingActionRef.current) return;
    clearTimeout(pendingActionRef.current.timerId);
    pendingActionRef.current.execute();
    pendingActionRef.current = null;
  }, []);

  /**
   * Masque immédiatement un thread via un Set React (indépendant du cache React Query).
   * Retourne un rollback pour le remettre en display si l'utilisateur annule.
   */
  const optimisticallyRemoveThread = useCallback((conversationId: string) => {
    setPendingRemovalIds(prev => new Set([...prev, conversationId]));
    return () => {
      setPendingRemovalIds(prev => {
        const next = new Set(prev);
        next.delete(conversationId);
        return next;
      });
    };
  }, []);

  const cycleTheme = useCallback(() => {
    const currentIndex = THEME_CYCLE.indexOf(preference);
    const nextIndex = (currentIndex + 1) % THEME_CYCLE.length;
    setPreference(THEME_CYCLE[nextIndex]);
  }, [preference, setPreference]);

  const isAllModeRef = useRef(isAllMode);
  isAllModeRef.current = isAllMode;

  const loadThreads = useCallback(async () => {
    if (isAllModeRef.current) {
      allThreadsRefetchRef.current();
    } else {
      threadsRefetchRef.current();
    }
  }, []);

  const reloadThreads = useCallback(async () => {
    setThreadLimit(50);
    if (isAllModeRef.current) {
      queryClient.invalidateQueries({ queryKey: MAIL_KEYS.all });
    } else {
      queryClient.invalidateQueries({ queryKey: ['mail', selectedAccountId] });
    }
  }, [queryClient, selectedAccountId]);

  const loadMoreThreads = useCallback(async () => {
    if (threadsFetching || !hasMoreThreads) return;
    setThreadLimit(prev => prev + 50);
  }, [threadsFetching, hasMoreThreads]);

  const markRead = useCallback((msgs: MailMessage[]) => {
    if (!selectedThread) return;
    const p = resolveProvider(selectedThread.accountId);
    if (p) mutations.markRead({ accountId: selectedThread.accountId ?? selectedAccountId, provider: p, conversationId: selectedThread.conversation_id, read: true, specificMessages: msgs, folderId: selectedFolder });
  }, [mutations, selectedThread, resolveProvider, selectedAccountId, selectedFolder]);

  const toggleRead = useCallback((msg: MailMessage) => {
    if (!selectedThread) return;
    const p = resolveProvider(selectedThread.accountId);
    if (p) mutations.markRead({ accountId: selectedThread.accountId ?? selectedAccountId, provider: p, conversationId: selectedThread.conversation_id, read: !msg.is_read, folderId: selectedFolder });
  }, [mutations, selectedThread, resolveProvider, selectedAccountId, selectedFolder]);

  const selectNextThread = useCallback((threadId: string) => {
    const currentIndex = threads.findIndex(t => t.conversation_id === threadId);
    if (currentIndex !== -1 && selectedThread?.conversation_id === threadId) {
        const nextThread = threads[currentIndex + 1] ?? threads[currentIndex - 1] ?? null;
        if (nextThread) {
            openThread(nextThread);
        } else {
            setSelectedThread(null);
        }
    }
  }, [threads, selectedThread, openThread]);

  const moveToTrash = useCallback((id: string) => {
    const thread = threads.find(t => t.conversation_id === id) ?? (selectedThread?.conversation_id === id ? selectedThread : null);
    if (!thread) return;
    const p = resolveProvider(thread.accountId);
    if (p) {
      flushPendingAction();
      const accountId = thread.accountId ?? selectedAccountId;
      const isInTrash = selectedFolder === 'deleteditems';
      selectNextThread(thread.conversation_id);
      const rollback = optimisticallyRemoveThread(thread.conversation_id);

      const execute = () => {
        const isDraft = selectedFolder === 'drafts';
        if (isInTrash) {
          mutations.deletePermanently({ accountId, provider: p, conversationId: thread.conversation_id });
        } else {
          mutations.moveToTrash({ accountId, provider: p, conversationId: thread.conversation_id, folderId: selectedFolder, threadUnreadCount: thread.unread_count, isDraft });
        }
        setPendingRemovalIds(prev => { const next = new Set(prev); next.delete(thread.conversation_id); return next; });
        setDeleteToast(null);
      };

      const toastLabel = isInTrash
        ? t('mail.deletedPermanently', 'Conversation supprimée définitivement')
        : t('mail.movedToTrash', 'Conversation déplacée vers la corbeille');
      setDeleteToast({ label: toastLabel });
      pendingActionRef.current = { id: thread.conversation_id, timerId: setTimeout(execute, 5000), execute, rollback };
    }
  }, [mutations, selectedThread, threads, resolveProvider, selectedAccountId, selectedFolder, selectNextThread, t, flushPendingAction, optimisticallyRemoveThread]);

  const handleToggleThreadRead = useCallback((thread: MailThread) => {
    const p = resolveProvider(thread.accountId);
    if (p) mutations.markRead({ accountId: thread.accountId ?? selectedAccountId, provider: p, conversationId: thread.conversation_id, read: thread.unread_count > 0, folderId: selectedFolder, threadUnreadCount: thread.unread_count });
  }, [mutations, resolveProvider, selectedAccountId, selectedFolder]);

  const handleDeleteThread = useCallback((thread: MailThread) => {
    moveToTrash(thread.conversation_id);
  }, [moveToTrash]);

  const persistSnooze = useCallback((conversationId: string, until: string) => {
    setSnoozedMap(prev => {
      const next = { ...prev, [conversationId]: until };
      localStorage.setItem('mail-snoozed', JSON.stringify(next));
      return next;
    });
  }, [setSnoozedMap]);

  const clearSnooze = useCallback((conversationId: string) => {
    setSnoozedMap(prev => {
      const next = { ...prev };
      delete next[conversationId];
      localStorage.setItem('mail-snoozed', JSON.stringify(next));
      return next;
    });
  }, [setSnoozedMap]);

  const handleSnooze = useCallback(async (snoozeUntil: string) => {
    if (!selectedThread) return;
    const p = resolveProvider(selectedThread.accountId);
    if (p) {
      flushPendingAction();
      const accountId = selectedThread.accountId ?? selectedAccountId;
      const conversationId = selectedThread.conversation_id;
      persistSnooze(conversationId, snoozeUntil);
      selectNextThread(conversationId);
      const removeOptimistic = optimisticallyRemoveThread(conversationId);
      const rollback = () => {
        removeOptimistic();
        clearSnooze(conversationId);
      };

      const execute = () => {
        mutations.snoozeThread(
          { accountId, provider: p, conversationId, until: snoozeUntil },
          { onError: () => clearSnooze(conversationId) },
        );
        setPendingRemovalIds(prev => { const next = new Set(prev); next.delete(conversationId); return next; });
        setDeleteToast(null);
      };

      setDeleteToast({ label: t('mail.snoozed_toast', 'Conversation mise en attente') });
      pendingActionRef.current = { id: conversationId, timerId: setTimeout(execute, 5000), execute, rollback };
    }
  }, [mutations, selectedThread, resolveProvider, selectedAccountId, selectNextThread, t, flushPendingAction, optimisticallyRemoveThread, persistSnooze, clearSnooze]);

  const handleUnsnooze = useCallback(async () => {
    if (!selectedThread) return;
    const p = resolveProvider(selectedThread.accountId);
    if (p) {
      clearSnooze(selectedThread.conversation_id);
      mutations.moveThread({
        accountId: selectedThread.accountId ?? selectedAccountId,
        provider: p,
        conversationId: selectedThread.conversation_id,
        targetFolderId: 'inbox',
      });
    }
  }, [selectedThread, resolveProvider, selectedAccountId, mutations, clearSnooze]);

  const handleMove = useCallback(async (targetFolderId: string) => {
    if (!selectedThread) return;
    const p = resolveProvider(selectedThread.accountId);
    if (p) {
      flushPendingAction();
      const accountId = selectedThread.accountId ?? selectedAccountId;
      const conversationId = selectedThread.conversation_id;
      selectNextThread(conversationId);
      const rollback = optimisticallyRemoveThread(conversationId);

      const execute = () => {
        mutations.moveThread({ accountId, provider: p, conversationId, targetFolderId });
        setPendingRemovalIds(prev => { const next = new Set(prev); next.delete(conversationId); return next; });
        setDeleteToast(null);
      };

      setDeleteToast({ label: t('mail.moved', 'Conversation déplacée') });
      pendingActionRef.current = { id: conversationId, timerId: setTimeout(execute, 5000), execute, rollback };
    }
  }, [selectedThread, mutations, resolveProvider, selectedAccountId, selectNextThread, t, flushPendingAction, optimisticallyRemoveThread]);

  const handleBulkDelete = useCallback(async () => {
    const permanent = selectedFolder === 'deleteditems';
    const byAccount = new Map<string, { accountId: string; provider: MailProvider; conversationIds: string[] }>();
    for (const id of selectedThreadIds) {
      const thread = threads.find(t => t.conversation_id === id);
      if (!thread) continue;
      const p = resolveProvider(thread.accountId);
      if (!p) continue;
      const accountId = thread.accountId ?? selectedAccountId;
      if (!byAccount.has(accountId)) byAccount.set(accountId, { accountId, provider: p, conversationIds: [] });
      byAccount.get(accountId)!.conversationIds.push(id);
    }
    for (const { accountId, provider, conversationIds } of byAccount.values()) {
      mutations.bulkDelete({ accountId, provider, conversationIds, permanent });
    }
    setSelectedThreadIds(new Set());
  }, [selectedThreadIds, threads, resolveProvider, selectedAccountId, mutations, selectedFolder]);

  const handleBulkSnooze = useCallback(async (until: string) => {
    for (const id of selectedThreadIds) {
      const thread = threads.find(t => t.conversation_id === id);
      if (thread) {
        const p = resolveProvider(thread.accountId);
        if (p) mutations.snoozeThread({ accountId: thread.accountId ?? selectedAccountId, provider: p, conversationId: id, until });
      }
    }
    setSelectedThreadIds(new Set());
  }, [selectedThreadIds, threads, resolveProvider, selectedAccountId, mutations]);
  const handleBulkMove = useCallback(async (targetFolderId: string) => {
    const byAccount = new Map<string, { accountId: string; provider: MailProvider; conversationIds: string[] }>();
    for (const id of selectedThreadIds) {
      const thread = threads.find(t => t.conversation_id === id);
      if (!thread) continue;
      const p = resolveProvider(thread.accountId);
      if (!p) continue;
      const accountId = thread.accountId ?? selectedAccountId;
      if (!byAccount.has(accountId)) byAccount.set(accountId, { accountId, provider: p, conversationIds: [] });
      byAccount.get(accountId)!.conversationIds.push(id);
    }
    for (const { accountId, provider, conversationIds } of byAccount.values()) {
      mutations.bulkMove({ accountId, provider, conversationIds, targetFolderId });
    }
    setSelectedThreadIds(new Set());
  }, [selectedThreadIds, threads, resolveProvider, selectedAccountId, mutations]);

  const handleBulkToggleRead = useCallback(async (read: boolean) => {
    for (const id of selectedThreadIds) {
      const thread = threads.find(t => t.conversation_id === id);
      if (thread) {
        const p = resolveProvider(thread.accountId);
        if (p) mutations.markRead({ accountId: thread.accountId ?? selectedAccountId, provider: p, conversationId: id, read });
      }
    }
  }, [selectedThreadIds, threads, resolveProvider, selectedAccountId, mutations]);

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
    to: string[], cc: string[], bcc: string[], subject: string, body: string,
    restoreData: ComposerRestoreData, attachments?: ComposerAttachment[],
  ) => {
    const { fromAccountId, fromIdentityId, draftItemId } = restoreData;
    const p = fromAccountId ? (allProviders.get(fromAccountId) ?? null) : resolveProvider(selectedThread?.accountId);
    if (!p) return;

    const accountId = fromAccountId ?? selectedThread?.accountId ?? selectedAccountId;
    const conversationId = restoreData.isNewMessage ? undefined : selectedThread?.conversation_id;
    const draftConversationId = draftItemId ? (selectedThread?.conversation_id ?? null) : null;

    const account = allMailAccounts.find(a => a.id === accountId);
    const optimisticId = '__optimistic__' + Date.now();
    const optimisticMsg: MailMessage = {
      item_id: optimisticId,
      change_key: '',
      subject,
      from_name: account?.name ?? null,
      from_email: account?.email ?? null,
      to_recipients: to.map(email => ({ email, name: null })),
      cc_recipients: cc.map(email => ({ email, name: null })),
      body_html: body,
      date_time_received: new Date().toISOString(),
      is_read: true,
      has_attachments: (attachments?.length ?? 0) > 0,
      attachments: [],
    };

    if (conversationId) {
      setPendingOptimisticMsgs(prev => {
        const next = new Map(prev);
        next.set(conversationId, [...(prev.get(conversationId) ?? []), optimisticMsg]);
        return next;
      });
    }

    const messagesKey = conversationId ? MAIL_KEYS.thread(accountId, conversationId) : null;
    const realCountBefore = messagesKey
      ? (queryClient.getQueryData<MailMessage[]>(messagesKey)?.length ?? 0)
      : 0;

    const removeOptimistic = () => {
      if (!conversationId) return;
      setPendingOptimisticMsgs(prev => {
        const next = new Map(prev);
        const remaining = (prev.get(conversationId) ?? []).filter(m => m.item_id !== optimisticId);
        if (remaining.length === 0) next.delete(conversationId);
        else next.set(conversationId, remaining);
        return next;
      });
    };

    // Extracted to keep nesting ≤ 4 levels inside the setTimeout
    const doPoll = async (attempt: number): Promise<void> => {
      if (!conversationId || !messagesKey) return;
      try {
        const fresh = await p.getThread(conversationId);
        if (fresh.length > realCountBefore) {
          queryClient.setQueryData<MailMessage[]>(messagesKey, fresh);
          const bump = (old: MailThread[] | undefined) =>
            old?.map(t => t.conversation_id === conversationId
              ? { ...t, message_count: t.message_count + 1 }
              : t);
          queryClient.setQueriesData<MailThread[]>({ queryKey: ['mail', accountId, 'threads'] }, bump);
          queryClient.setQueriesData<MailThread[]>({ queryKey: ['mail', 'all', 'threads'] }, bump);
          removeOptimistic();
          return;
        }
      } catch { /* network error — keep optimistic */ }
      if (attempt < 5) setTimeout(() => doPoll(attempt + 1), 4000);
    };

    // Build RFC 5322 threading headers (computed once, before the 5s timer)
    let inReplyTo: string | undefined;
    let references: string | undefined;
    const replyingToMsg = restoreData.replyingToMsg;
    if (!restoreData.isNewMessage && !restoreData.isForward && replyingToMsg?.message_id) {
      inReplyTo = replyingToMsg.message_id;
      references = replyingToMsg.references
        ? `${replyingToMsg.references} ${replyingToMsg.message_id}`
        : replyingToMsg.message_id;
    }

    const draftRollback = draftConversationId ? optimisticallyRemoveThread(draftConversationId) : null;

    let cancelled = false;
    const timerId = setTimeout(async () => {
      if (cancelled) return;
      try {
        await mutations.sendMail({
          accountId, provider: p, conversationId,
          to, cc, bcc, subject, bodyHtml: body, attachments, fromIdentityId,
          inReplyTo, references,
          replyToItemId: replyingToMsg?.item_id,
          replyToChangeKey: replyingToMsg?.change_key,
          isForward: restoreData.isForward,
        });
        if (conversationId) setTimeout(() => doPoll(1), 3000);
        if (draftItemId) {
          try { await p.permanentlyDelete(draftItemId); } catch { /* ignore */ }
          queryClient.invalidateQueries({ queryKey: MAIL_KEYS.threads(accountId, 'drafts') });
          queryClient.invalidateQueries({ queryKey: ['mail', accountId, 'threads'] });
          queryClient.invalidateQueries({ queryKey: ['mail', 'all', 'threads'] });
          if (draftConversationId) {
            setDraftReplyMap(prev => {
              const next = new Map(prev);
              next.delete(draftConversationId);
              persistDraftReplyMap(next);
              return next;
            });
          }
          setSelectedThread(null);
        }
      } catch (e) {
        setError(String(e));
        removeOptimistic();
        draftRollback?.();
      }
      setActionToast(null);
    }, 5000);

    const cancel = () => {
      cancelled = true;
      clearTimeout(timerId);
      removeOptimistic();
      draftRollback?.();
      setActionToast(null);
      setComposing(restoreData.isNewMessage);
    };

    setActionToast({ label: t('mail.sending', 'En cours d\'envoi…'), onCancel: cancel });
    setReplyingTo(null);
    setComposing(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allProviders, resolveProvider, selectedThread, selectedAccountId, allMailAccounts, mutations, t, queryClient]);

  const cancelSend = useCallback(() => {
    if (actionToast?.onCancel) actionToast.onCancel();
  }, [actionToast]);

  const handleSaveDraft = useCallback((
    accountId: string | undefined,
    to: string[], cc: string[], bcc: string[], subject: string, bodyHtml: string,
    replyToConversationId?: string,
  ) => {
    const p = resolveProvider(accountId);
    if (!p) return;
    const effectiveAccountId = accountId ?? selectedAccountId;
    // Optimistically store draft data immediately (draftItemId will be filled when save resolves)
    if (replyToConversationId) {
      setDraftReplyMap(prev => {
        const next = new Map(prev);
        const existing = prev.get(replyToConversationId);
        next.set(replyToConversationId, {
          draftItemId: existing?.draftItemId ?? '',
          accountId: effectiveAccountId,
          to, cc, bcc: bcc ?? [], subject, body: bodyHtml,
        });
        persistDraftReplyMap(next);
        return next;
      });
    }
    p.saveDraft({ to, cc, bcc, subject, bodyHtml }).then(itemId => {
      if (replyToConversationId && itemId) {
        setDraftReplyMap(prev => {
          const next = new Map(prev);
          const existing = prev.get(replyToConversationId);
          if (existing) {
            next.set(replyToConversationId, { ...existing, draftItemId: itemId });
            persistDraftReplyMap(next);
          }
          return next;
        });
        // Back-fill the itemId in composerRestoreData if it was set without one
        setComposerRestoreData(prev =>
          prev && !prev.draftItemId && prev.isNewMessage === false
            ? { ...prev, draftItemId: itemId }
            : prev,
        );
        setComposingDraftItemId(itemId);
      }
    }).catch(e => setError(String(e)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolveProvider, selectedAccountId]);

  const dismissDraftForConversation = useCallback((conversationId: string) => {
    setDraftReplyMap(prev => {
      const next = new Map(prev);
      next.delete(conversationId);
      persistDraftReplyMap(next);
      return next;
    });
    setComposerRestoreData(null);
    setComposingDraftItemId(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = useCallback(async (query: MailSearchQuery | null) => {
    if (!query || Object.values(query).every(v => !v)) {
      setSearchQuery(null);
      return;
    }
    setSearchQuery(query);
  }, []);

  const handleFoldersLoaded = useCallback(() => {}, []);

  const startResizingSidebar = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      setSidebarWidth(Math.max(150, Math.min(300, startWidth + delta)));
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
      setThreadListWidth(Math.max(200, Math.min(500, startWidth + delta)));
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
    threads, threadsLoading: threadsLoading && threadLimit === 50, threadsRefreshing: threadsFetching && stableThreads.length > 0, threadsLoadingMore, hasMoreThreads, selectedThread,
    messages, messagesLoading, replyingTo, replyMode, composing, composingAccountId,
    contacts, error, deleteToast, downloadToast, actionToast,
    selectedThreadIds, composerRestoreData, composingDraftItemId, sidebarCollapsed,
    sidebarWidth, threadListWidth, snoozedMap, isInSnoozedFolder, allFolders,
    allAccountFolders, folderUnreadCounts, sidebarDynamicFolders, attachmentPreview,
    setSelectedAccountId, setSelectedFolder, setComposing, setComposingAccountId,
    setError, setDownloadToast, cancelDeletion, cycleTheme, loadThreads, reloadThreads, loadMoreThreads,
    openThread, markRead, toggleRead, moveToTrash, handleToggleThreadRead,
    handleDeleteThread, handleSnooze, handleUnsnooze, handleMove, handleBulkDelete,
    handleBulkSnooze, handleBulkMove, handleBulkToggleRead, previewAttachment,
    downloadAttachment, getRawAttachmentData, scheduleSend, cancelSend, handleSaveDraft,
    startResizingSidebar, startResizingThreadList, setSidebarCollapsed,
    setSelectedThreadIds, setAttachmentPreview, provider, setReplyingTo, setReplyMode, setActionToast,
    handleFoldersLoaded, setSelectedThread, threadSupportsSnooze,
    searchQuery, searchResults, searchLoading, handleSearch,
    isSending: mutations.isSending,
    accountIdentities,
    draftConversationIds,
    dismissDraftForConversation,
  };
}
