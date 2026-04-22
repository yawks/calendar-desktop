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
import { useMailFolders, useAllAccountFolders, useMailThreads, useAllAccountThreads, useMailConversation, useMailSearch, useAllAccountSearch } from './useMailQueries';
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

  const allProviders = useMemo<Map<string, MailProvider>>(() => {
    const map = new Map<string, MailProvider>();
    for (const a of mailEwsAccounts) map.set(a.id, new EwsMailProvider(a.id, getEwsToken));
    for (const a of mailGoogleAccounts) map.set(a.id, new GmailMailProvider(a.id, getGoogleToken));
    for (const a of imapAccounts) map.set(a.id, new ImapMailProvider(a));
    for (const a of jmapAccounts) map.set(a.id, new JmapMailProvider(a));
    return map;
  }, [mailEwsAccounts, mailGoogleAccounts, imapAccounts, jmapAccounts, getEwsToken, getGoogleToken]);

  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    () => allMailAccounts.length > 1 ? ALL_ACCOUNTS_ID : (allMailAccounts[0]?.id ?? ALL_ACCOUNTS_ID)
  );

  const isAllMode = selectedAccountId === ALL_ACCOUNTS_ID;
  const provider = isAllMode ? null : (allProviders.get(selectedAccountId) ?? null);
  const [selectedFolder, setSelectedFolder] = useState<Folder>('inbox');
  const [selectedThread, setSelectedThread] = useState<MailThread | null>(null);

  // --- STATE ---
  const [threadOffset, setThreadOffset] = useState(0);
  const [allThreads, setAllThreads] = useState<MailThread[]>([]);
  const [hasMoreThreads, setHasMoreThreads] = useState(true);
  const [threadsLoadingMore, setThreadsLoadingMore] = useState(false);
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

  const threadsQuery = useMailThreads(selectedAccountId, selectedFolder, provider, 50, threadOffset);
  const allThreadsQuery = useAllAccountThreads(selectedFolder, allAccountInfo, 50, threadOffset);

  const currentBatch = useMemo(() => isAllMode ? allThreadsQuery.data : (threadsQuery.data ?? []), [isAllMode, allThreadsQuery.data, threadsQuery.data]);
  const threadsLoading = isAllMode ? allThreadsQuery.isLoading : threadsQuery.isLoading;

  useEffect(() => {
    if (threadOffset === 0) {
      setAllThreads(currentBatch);
    } else {
      setAllThreads(prev => {
        const existingIds = new Set(prev.map(t => t.conversation_id));
        const newThreads = currentBatch.filter(t => !existingIds.has(t.conversation_id));
        return [...prev, ...newThreads];
      });
    }
    setHasMoreThreads(currentBatch.length >= 50);
    setThreadsLoadingMore(false);
  }, [currentBatch, threadOffset]);

  useEffect(() => {
    setThreadOffset(0);
  }, [selectedAccountId, selectedFolder, searchQuery]);

  const conversationQuery = useMailConversation(
    selectedThread?.accountId ?? selectedAccountId,
    selectedThread?.conversation_id ?? null,
    allProviders.get(selectedThread?.accountId ?? selectedAccountId) ?? provider
  );

  const messages = conversationQuery.data ?? [];
  const messagesLoading = conversationQuery.isLoading;

  const searchSingleQuery = useMailSearch(selectedAccountId, searchQuery!, isAllMode ? null : provider);
  const searchAllQuery = useAllAccountSearch(searchQuery!, allAccountInfo);

  const searchResults = isAllMode ? searchAllQuery.data : (searchSingleQuery.data ?? []);
  const searchLoading = isAllMode ? searchAllQuery.isLoading : searchSingleQuery.isLoading;

  const allFolders = isAllMode ? [] : (folderQuery.data ?? []);
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
    const allErrors = [...(isAllMode ? allThreadsQuery.errors : (threadsQuery.error ? [threadsQuery.error] : [])), ...allFoldersQuery.errors] as Error[];
    if (allErrors.length > 0) {
      const msg = allErrors[0].message;
      setError(prev => prev === msg ? prev : msg);
    }
  }, [isAllMode, allThreadsQuery.errors, threadsQuery.error, allFoldersQuery.errors]);

  // --- MUTATIONS ---
  const mutations = useMailMutations();

  const [replyingTo, setReplyingTo] = useState<MailMessage | null>(null);
  const [replyMode, setReplyMode] = useState<'reply' | 'replyAll' | 'forward'>('reply');
  const [composing, setComposing] = useState(false);
  const [composingAccountId, setComposingAccountId] = useState<string>(() => allMailAccounts[0]?.id ?? '');
  const [mailContacts] = useState<RecipientEntry[]>([]);
  const contacts = useContactSuggestions(mailContacts);
  const [deleteToast, setDeleteToast] = useState<{ label: string } | null>(null);
  const [actionToast, setActionToast] = useState<{ label: string } | null>(null);
  const [downloadToast, setDownloadToast] = useState<{ name: string; path: string } | null>(null);
  const downloadToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('mail-sidebar-collapsed') === 'true');
  const [sidebarWidth, setSidebarWidth] = useState(() => Number(localStorage.getItem('mail-sidebar-width') || 220));
  const [threadListWidth, setThreadListWidth] = useState(() => Number(localStorage.getItem('mail-threadlist-width') || 350));
  const [snoozedMap] = useState<Record<string, string>>({});
  const [snoozedByItemId] = useState<Record<string, string>>({});
  const [attachmentPreview, setAttachmentPreview] = useState<{
    attachment: MailAttachment; loading: boolean; data: string | null;
  } | null>(null);
  const [composerRestoreData, _setComposerRestoreData] = useState<ComposerRestoreData | null>(null);
  const [composingDraftItemId] = useState<string | null>(null);

  const pendingActionRef = useRef<{
    id: string;
    timerId: ReturnType<typeof setTimeout>;
    execute: () => void;
  } | null>(null);

  const isInSnoozedFolder = selectedFolder === 'snoozed';

  const resolveProvider = useCallback((accountId: string | undefined): MailProvider | null => {
    if (accountId) return allProviders.get(accountId) ?? null;
    if (!isAllMode) return allProviders.get(selectedAccountId) ?? null;
    return null;
  }, [allProviders, isAllMode, selectedAccountId]);

  const openThread = useCallback((thread: MailThread) => {
    setSelectedThread(thread);
    if (thread.unread_count > 0) {
      const p = allProviders.get(thread.accountId ?? selectedAccountId);
      if (p) mutations.markRead({ accountId: thread.accountId ?? selectedAccountId, provider: p, conversationId: thread.conversation_id, read: true });
    }
  }, [allProviders, selectedAccountId, mutations]);

  const cancelDeletion = useCallback(() => {
    if (!pendingActionRef.current) return;
    clearTimeout(pendingActionRef.current.timerId);
    pendingActionRef.current = null;
    setDeleteToast(null);
  }, []);

  const cycleTheme = useCallback(() => {
    const currentIndex = THEME_CYCLE.indexOf(preference);
    const nextIndex = (currentIndex + 1) % THEME_CYCLE.length;
    setPreference(THEME_CYCLE[nextIndex]);
  }, [preference, setPreference]);

  const loadThreads = useCallback(async () => {
    if (isAllMode) {
      allThreadsQuery.refetch();
    } else {
      threadsQuery.refetch();
    }
  }, [isAllMode, threadsQuery, allThreadsQuery]);

  const reloadThreads = useCallback(async () => {
    setThreadOffset(0);
    loadThreads();
  }, [loadThreads]);

  const loadMoreThreads = useCallback(async () => {
    if (threadsLoadingMore || !hasMoreThreads) return;
    setThreadsLoadingMore(true);
    setThreadOffset(prev => prev + 50);
  }, [threadsLoadingMore, hasMoreThreads]);

  const markRead = useCallback((_msgs: MailMessage[]) => {
    if (!selectedThread) return;
    const p = resolveProvider(selectedThread.accountId);
    if (p) mutations.markRead({ accountId: selectedThread.accountId ?? selectedAccountId, provider: p, conversationId: selectedThread.conversation_id, read: true });
  }, [mutations, selectedThread, resolveProvider, selectedAccountId]);

  const toggleRead = useCallback((msg: MailMessage) => {
    if (!selectedThread) return;
    const p = resolveProvider(selectedThread.accountId);
    if (p) mutations.markRead({ accountId: selectedThread.accountId ?? selectedAccountId, provider: p, conversationId: selectedThread.conversation_id, read: !msg.is_read });
  }, [mutations, selectedThread, resolveProvider, selectedAccountId]);

  const selectNextThread = useCallback((threadId: string) => {
    const currentIndex = allThreads.findIndex(t => t.conversation_id === threadId);
    if (currentIndex !== -1 && selectedThread?.conversation_id === threadId) {
        const nextThread = allThreads[currentIndex + 1] ?? allThreads[currentIndex - 1] ?? null;
        if (nextThread) {
            openThread(nextThread);
        } else {
            setSelectedThread(null);
        }
    }
  }, [allThreads, selectedThread, openThread]);

  const moveToTrash = useCallback((id: string) => {
    const thread = selectedThread ?? allThreads.find(t => t.conversation_id === id);
    if (!thread) return;
    const p = resolveProvider(thread.accountId);
    if (p) {
      cancelDeletion();
      selectNextThread(thread.conversation_id);

      const execute = () => {
        mutations.moveToTrash({ accountId: thread.accountId ?? selectedAccountId, provider: p, conversationId: thread.conversation_id });
        setDeleteToast(null);
      };

      setDeleteToast({ label: t('mail.movedToTrash', 'Conversation déplacée vers la corbeille') });
      pendingActionRef.current = {
        id: thread.conversation_id,
        timerId: setTimeout(execute, 5000),
        execute
      };
    }
  }, [mutations, selectedThread, allThreads, resolveProvider, selectedAccountId, selectNextThread, t, cancelDeletion]);

  const handleToggleThreadRead = useCallback((thread: MailThread) => {
    const p = resolveProvider(thread.accountId);
    if (p) mutations.markRead({ accountId: thread.accountId ?? selectedAccountId, provider: p, conversationId: thread.conversation_id, read: thread.unread_count > 0 });
  }, [mutations, resolveProvider, selectedAccountId]);

  const handleDeleteThread = useCallback((thread: MailThread) => {
    const p = resolveProvider(thread.accountId);
    if (!p) return;

    cancelDeletion();
    selectNextThread(thread.conversation_id);

    const execute = () => {
      mutations.moveToTrash({ accountId: thread.accountId ?? selectedAccountId, provider: p, conversationId: thread.conversation_id });
      setDeleteToast(null);
    };

    setDeleteToast({ label: t('mail.deleted', 'Conversation supprimée') });
    pendingActionRef.current = {
      id: thread.conversation_id,
      timerId: setTimeout(execute, 5000),
      execute
    };
  }, [mutations, resolveProvider, selectedAccountId, selectNextThread, t, cancelDeletion]);

  const handleSnooze = useCallback(async (snoozeUntil: string) => {
    if (!selectedThread) return;
    const p = resolveProvider(selectedThread.accountId);
    if (p) {
      cancelDeletion();
      const conversationId = selectedThread.conversation_id;
      selectNextThread(conversationId);

      const execute = () => {
        mutations.snoozeThread({ accountId: selectedThread.accountId ?? selectedAccountId, provider: p, conversationId, until: snoozeUntil });
        setDeleteToast(null);
      };

      setDeleteToast({ label: t('mail.snoozed_toast', 'Conversation mise en attente') });
      pendingActionRef.current = {
        id: conversationId,
        timerId: setTimeout(execute, 5000),
        execute
      };
    }
  }, [mutations, selectedThread, resolveProvider, selectedAccountId, selectNextThread, t, cancelDeletion]);

  const handleUnsnooze = useCallback(async () => {
    if (!selectedThread) return;
    const p = resolveProvider(selectedThread.accountId);
    if (p) {
        // Implement unsnooze if provider supports it, or just move back to Inbox
        await mutations.moveThread({
            accountId: selectedThread.accountId ?? selectedAccountId,
            provider: p,
            conversationId: selectedThread.conversation_id,
            targetFolderId: 'inbox'
        });
    }
  }, [selectedThread, resolveProvider, selectedAccountId, mutations]);

  const handleMove = useCallback(async (targetFolderId: string) => {
    if (!selectedThread) return;
    const p = resolveProvider(selectedThread.accountId);
    if (p) {
      cancelDeletion();
      const conversationId = selectedThread.conversation_id;
      selectNextThread(conversationId);

      const execute = () => {
        mutations.moveThread({ accountId: selectedThread.accountId ?? selectedAccountId, provider: p, conversationId, targetFolderId });
        setDeleteToast(null);
      };

      setDeleteToast({ label: t('mail.moved', 'Conversation déplacée') });
      pendingActionRef.current = {
        id: conversationId,
        timerId: setTimeout(execute, 5000),
        execute
      };
    }
  }, [selectedThread, mutations, resolveProvider, selectedAccountId, selectNextThread, t, cancelDeletion]);

  const handleBulkDelete = useCallback(async () => {
    for (const id of selectedThreadIds) {
      const thread = allThreads.find(t => t.conversation_id === id);
      if (thread) {
        const p = resolveProvider(thread.accountId);
        if (p) mutations.moveToTrash({ accountId: thread.accountId ?? selectedAccountId, provider: p, conversationId: id });
      }
    }
    setSelectedThreadIds(new Set());
  }, [selectedThreadIds, allThreads, resolveProvider, selectedAccountId, mutations]);

  const handleBulkSnooze = useCallback(async (until: string) => {
    for (const id of selectedThreadIds) {
      const thread = allThreads.find(t => t.conversation_id === id);
      if (thread) {
        const p = resolveProvider(thread.accountId);
        if (p) mutations.snoozeThread({ accountId: thread.accountId ?? selectedAccountId, provider: p, conversationId: id, until });
      }
    }
    setSelectedThreadIds(new Set());
  }, [selectedThreadIds, allThreads, resolveProvider, selectedAccountId, mutations]);
  const handleBulkMove = useCallback(async (targetFolderId: string) => {
    for (const id of selectedThreadIds) {
      const thread = allThreads.find(t => t.conversation_id === id);
      if (thread) {
        const p = resolveProvider(thread.accountId);
        if (p) mutations.moveThread({ accountId: thread.accountId ?? selectedAccountId, provider: p, conversationId: id, targetFolderId });
      }
    }
    setSelectedThreadIds(new Set());
  }, [selectedThreadIds, allThreads, resolveProvider, selectedAccountId, mutations]);

  const handleBulkToggleRead = useCallback(async (read: boolean) => {
    for (const id of selectedThreadIds) {
      const thread = allThreads.find(t => t.conversation_id === id);
      if (thread) {
        const p = resolveProvider(thread.accountId);
        if (p) mutations.markRead({ accountId: thread.accountId ?? selectedAccountId, provider: p, conversationId: id, read });
      }
    }
  }, [selectedThreadIds, allThreads, resolveProvider, selectedAccountId, mutations]);

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
    fromAccountId?: string, fromIdentityId?: string,
  ) => {
    const p = fromAccountId ? (allProviders.get(fromAccountId) ?? null) : resolveProvider(selectedThread?.accountId);
    if (!p) return;

    const accountId = fromAccountId ?? selectedThread?.accountId ?? selectedAccountId;
    const conversationId = restoreData.isNewMessage ? undefined : selectedThread?.conversation_id;

    const execute = async () => {
      try {
        await mutations.sendMail({
          accountId, provider: p, conversationId,
          to, cc, bcc, subject, bodyHtml: body, attachments, fromIdentityId
        });
        setActionToast(null);
      } catch (e) {
        setError(String(e));
      }
    };

    setTimeout(execute, 5000);
    setActionToast({ label: t('mail.sending_scheduled', 'Envoi programmé...') });

    setReplyingTo(null);
    setComposing(false);
  }, [allProviders, resolveProvider, selectedThread, selectedAccountId, mutations, t]);

  const sendTimeoutRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const cancelSend = useCallback((tempId: string) => {
    if (sendTimeoutRef.current[tempId]) {
        clearTimeout(sendTimeoutRef.current[tempId]);
        delete sendTimeoutRef.current[tempId];
        // Remove optimistic message
        // Since we don't have direct access to setQueryData here easily without polluting,
        // we might just let it be or invalidate.
        // Actually, for simplicity in this migration, we'll focus on the standard undo.
    }
  }, []);

  const handleSaveDraft = useCallback((accountId: string | undefined, to: string[], cc: string[], bcc: string[], subject: string, bodyHtml: string) => {
    const p = resolveProvider(accountId);
    if (!p) return;
    p.saveDraft({ to, cc, bcc, subject, bodyHtml }).catch(e => setError(String(e)));
  }, [resolveProvider]);

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
    threads: allThreads, threadsLoading: threadsLoading && threadOffset === 0, threadsLoadingMore, hasMoreThreads, selectedThread,
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
    setSelectedThreadIds, setAttachmentPreview, provider, setReplyingTo, setReplyMode,
    snoozedByItemId, handleFoldersLoaded, setSelectedThread,
    searchQuery, searchResults, searchLoading, handleSearch,
    isSending: mutations.isSending
  };
}
