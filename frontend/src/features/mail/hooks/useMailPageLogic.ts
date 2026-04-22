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
import { useMailFolders, useAllAccountFolders, useMailThreads, useAllAccountThreads, useMailConversation } from './useMailQueries';
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

  // --- QUERIES ---
  const allAccountInfo = useMemo(() => allMailAccounts.map(a => ({
    id: a.id,
    provider: allProviders.get(a.id) ?? null,
    label: a.name ?? a.email,
    color: a.color
  })), [allMailAccounts, allProviders]);

  const folderQuery = useMailFolders(selectedAccountId, provider);
  const allFoldersQuery = useAllAccountFolders(allAccountInfo);

  const threadsQuery = useMailThreads(selectedAccountId, selectedFolder, provider);
  const allThreadsQuery = useAllAccountThreads(selectedFolder, allAccountInfo);

  const threads = isAllMode ? allThreadsQuery.data : (threadsQuery.data ?? []);
  const threadsLoading = isAllMode ? allThreadsQuery.isLoading : threadsQuery.isLoading;

  const conversationQuery = useMailConversation(
    selectedThread?.accountId ?? selectedAccountId,
    selectedThread?.conversation_id ?? null,
    allProviders.get(selectedThread?.accountId ?? selectedAccountId) ?? provider
  );

  const messages = conversationQuery.data ?? [];
  const messagesLoading = conversationQuery.isLoading;

  const allFolders = isAllMode ? [] : (folderQuery.data ?? []);
  const allAccountFolders = allFoldersQuery.allAccountFolders;

  const folderUnreadCounts = useMemo(() => {
    if (isAllMode) return allFoldersQuery.mergedCounts;
    if (folderQuery.data) return buildUnreadCounts(folderQuery.data);
    return {};
  }, [isAllMode, allFoldersQuery.mergedCounts, folderQuery.data]);

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

  const [threadsLoadingMore] = useState(false);
  const [hasMoreThreads] = useState(true);
  const [replyingTo, setReplyingTo] = useState<MailMessage | null>(null);
  const [replyMode, setReplyMode] = useState<'reply' | 'replyAll' | 'forward'>('reply');
  const [composing, setComposing] = useState(false);
  const [composingAccountId, setComposingAccountId] = useState<string>(() => allMailAccounts[0]?.id ?? '');
  const [mailContacts] = useState<RecipientEntry[]>([]);
  const contacts = useContactSuggestions(mailContacts);
  const [deleteToast] = useState<{ label: string } | null>(null);
  const [downloadToast, setDownloadToast] = useState<{ name: string; path: string } | null>(null);
  const downloadToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sendToast, setSendToast] = useState<{ label: string } | null>(null);
  const [draftToast, setDraftToast] = useState<{ label: string } | null>(null);
  const draftToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [actionToast, setActionToast] = useState<{ label: string } | null>(null);
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
  const [searchQuery, setSearchQuery] = useState<MailSearchQuery | null>(null);
  const [searchResults] = useState<MailThread[]>([]);
  const [searchLoading] = useState(false);

  const pendingDeletionRef = useRef<{
    revert: () => void;
    execute: () => Promise<void>;
    timerId: ReturnType<typeof setTimeout>;
    conversationId?: string;
  } | null>(null);

  const pendingSendRef = useRef<{
    execute: () => Promise<void>;
    timerId: ReturnType<typeof setTimeout>;
    restoreData: ComposerRestoreData;
    optimisticConversationId?: string;
  } | null>(null);

  const isInSnoozedFolder = selectedFolder === 'snoozed';
  const allModeDynamicFolders = useMemo(() => [], []);

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
    if (!pendingDeletionRef.current) return;
    clearTimeout(pendingDeletionRef.current.timerId);
    pendingDeletionRef.current.revert();
    pendingDeletionRef.current = null;
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

  const reloadThreads = loadThreads;
  const loadMoreThreads = useCallback(async () => {}, []);

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

  const moveToTrash = useCallback((id: string) => {
    const thread = selectedThread ?? threads.find(t => t.conversation_id === id);
    if (!thread) return;
    const p = resolveProvider(thread.accountId);
    if (p) mutations.moveToTrash({ accountId: thread.accountId ?? selectedAccountId, provider: p, conversationId: thread.conversation_id });
  }, [mutations, selectedThread, threads, resolveProvider, selectedAccountId]);

  const handleToggleThreadRead = useCallback((thread: MailThread) => {
    const p = resolveProvider(thread.accountId);
    if (p) mutations.markRead({ accountId: thread.accountId ?? selectedAccountId, provider: p, conversationId: thread.conversation_id, read: thread.unread_count === 0 });
  }, [mutations, resolveProvider, selectedAccountId]);

  const handleDeleteThread = useCallback((thread: MailThread) => {
    const p = resolveProvider(thread.accountId);
    if (p) mutations.moveToTrash({ accountId: thread.accountId ?? selectedAccountId, provider: p, conversationId: thread.conversation_id });
  }, [mutations, resolveProvider, selectedAccountId]);

  const handleSnooze = useCallback(async (snoozeUntil: string) => {
    if (!selectedThread) return;
    const p = resolveProvider(selectedThread.accountId);
    if (p) mutations.snoozeThread({ accountId: selectedThread.accountId ?? selectedAccountId, provider: p, conversationId: selectedThread.conversation_id, until: snoozeUntil });
  }, [mutations, selectedThread, resolveProvider, selectedAccountId]);

  const handleUnsnooze = useCallback(async () => {}, []);

  const handleMove = useCallback(async (targetFolderId: string) => {
    if (!selectedThread) return;
    const p = resolveProvider(selectedThread.accountId);
    if (p) mutations.moveThread({ accountId: selectedThread.accountId ?? selectedAccountId, provider: p, conversationId: selectedThread.conversation_id, targetFolderId });
  }, [selectedThread, mutations, resolveProvider, selectedAccountId]);

  const handleBulkDelete = useCallback(async () => {
    for (const id of selectedThreadIds) {
      const thread = threads.find(t => t.conversation_id === id);
      if (thread) {
        const p = resolveProvider(thread.accountId);
        if (p) mutations.moveToTrash({ accountId: thread.accountId ?? selectedAccountId, provider: p, conversationId: id });
      }
    }
    setSelectedThreadIds(new Set());
  }, [selectedThreadIds, threads, resolveProvider, selectedAccountId, mutations]);

  const handleBulkSnooze = useCallback(async (_until: string) => {}, []);
  const handleBulkMove = useCallback(async (targetFolderId: string) => {
    for (const id of selectedThreadIds) {
      const thread = threads.find(t => t.conversation_id === id);
      if (thread) {
        const p = resolveProvider(thread.accountId);
        if (p) mutations.moveThread({ accountId: thread.accountId ?? selectedAccountId, provider: p, conversationId: id, targetFolderId });
      }
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
    fromAccountId?: string, fromIdentityId?: string,
  ) => {
    const p = fromAccountId ? (allProviders.get(fromAccountId) ?? null) : resolveProvider(selectedThread?.accountId);
    if (!p) return;
    const execute = async () => {
      await p.sendMail({ to, cc, bcc, subject, bodyHtml: body, attachments, fromIdentityId });
    };
    const timerId = setTimeout(async () => {
      pendingSendRef.current = null;
      setSendToast(null);
      execute().catch(e => setError(String(e)));
    }, 5000);
    pendingSendRef.current = { execute, timerId, restoreData };
    setSendToast({ label: t('mail.messageSent', 'Message envoyé') });
    setReplyingTo(null);
    setComposing(false);
  }, [allProviders, resolveProvider, selectedThread, t]);

  const cancelSend = useCallback(() => {
    if (!pendingSendRef.current) return;
    clearTimeout(pendingSendRef.current.timerId);
    pendingSendRef.current = null;
    setSendToast(null);
  }, []);

  const handleSaveDraft = useCallback((accountId: string | undefined, to: string[], cc: string[], bcc: string[], subject: string, bodyHtml: string) => {
    const p = resolveProvider(accountId);
    if (!p) return;
    p.saveDraft({ to, cc, bcc, subject, bodyHtml }).catch(e => setError(String(e)));
    if (draftToastTimerRef.current) clearTimeout(draftToastTimerRef.current);
    setDraftToast({ label: t('mail.savedToDrafts', 'Brouillon enregistré') });
    draftToastTimerRef.current = setTimeout(() => {
      setDraftToast(null);
      draftToastTimerRef.current = null;
    }, 3000);
  }, [resolveProvider, t]);

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

  const showActionToast = useCallback((label: string) => {
    setActionToast({ label });
    setTimeout(() => setActionToast(null), 3000);
  }, []);

  return {
    t, preference, allMailAccounts, selectedAccountId, isAllMode, selectedFolder,
    threads, threadsLoading: threadsLoading, threadsLoadingMore, hasMoreThreads, selectedThread,
    messages, messagesLoading, replyingTo, replyMode, composing, composingAccountId,
    contacts, error, deleteToast, downloadToast, sendToast, draftToast, actionToast,
    selectedThreadIds, composerRestoreData, composingDraftItemId, sidebarCollapsed,
    sidebarWidth, threadListWidth, snoozedMap, isInSnoozedFolder, allFolders,
    allAccountFolders, folderUnreadCounts, allModeDynamicFolders, attachmentPreview,
    setSelectedAccountId, setSelectedFolder, setComposing, setComposingAccountId,
    setError, setDownloadToast, cancelDeletion, cycleTheme, loadThreads, reloadThreads, loadMoreThreads,
    openThread, markRead, toggleRead, moveToTrash, handleToggleThreadRead,
    handleDeleteThread, handleSnooze, handleUnsnooze, handleMove, handleBulkDelete,
    handleBulkSnooze, handleBulkMove, handleBulkToggleRead, previewAttachment,
    downloadAttachment, getRawAttachmentData, scheduleSend, cancelSend, handleSaveDraft,
    startResizingSidebar, startResizingThreadList, setSidebarCollapsed,
    setSelectedThreadIds, setAttachmentPreview, provider, setReplyingTo, setReplyMode,
    snoozedByItemId, handleFoldersLoaded, setSelectedThread,
    searchQuery, searchResults, searchLoading, handleSearch, showActionToast,
  };
}
