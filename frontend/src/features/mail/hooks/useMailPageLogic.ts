import { useCallback, useEffect, useMemo, useRef, useState, MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { fileService } from '../../../shared/services/fileService';
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
import { Folder, MailMessage, MailThread, MailAttachment, ComposerRestoreData, MailSearchQuery, MailFolder } from '../types';
import { ALL_ACCOUNTS_ID, DISPLAY_TO_STATIC, THEME_CYCLE, buildUnreadCounts, getErrorMessage } from '../utils';
import { RecipientEntry } from '../components/RecipientInput';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { MAIL_KEYS, useMailFolders, useAllAccountFolders, useMailThreads, useAllAccountThreads, useMailConversation, useMailSearch, useAllAccountSearch, useMailIdentities, useAllAccountIdentities } from './useMailQueries';
import { useMailMutations } from './useMailMutations';
import { cleanupContactIndex, recordContactObservations, searchContactIndex, type ContactObservation } from '../utils/contactIndex';
import { useContactBackfill } from './useContactBackfill';
import { useOfflineMailSync } from './useOfflineMailSync';
import { isOfflineLikeError, isTemporaryMailServiceError } from '../../../shared/utils/networkError';
import { useOfflineMailSettings } from '../../../shared/store/OfflineMailStore';
import { removeOfflineInboxMessages } from '../utils/offlineMailCache';
import { clearConnectionIssue, isConnectionFailure, reportConnectionIssue } from '../../../shared/store/ConnectionIssueStore';

const threadIdentity = (thread: MailThread) => `${thread.accountId ?? ''}:${thread.conversation_id}`;

function deduplicateThreads(threads: MailThread[]): MailThread[] {
  const seen = new Set<string>();
  return threads.filter(thread => {
    const identity = threadIdentity(thread);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function useMailPageLogic() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { accounts: ewsAccounts, getValidToken: getEwsToken } = useExchangeAuth();
  const { accounts: googleAccounts, getValidToken: getGoogleToken } = useGoogleAuth();
  const { accounts: imapAccounts } = useImapAuth();
  const { accounts: jmapAccounts } = useJmapAuth();
  const { preference, setPreference } = useTheme();
  const { settings: offlineMail } = useOfflineMailSettings();

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
            next.set(a.id, new EwsMailProvider(a.id, getEwsToken, a.email));
        } else {
            next.set(a.id, current.get(a.id)!);
        }
    }
    for (const a of mailGoogleAccounts) {
        if (!current.has(a.id) || !(current.get(a.id) instanceof GmailMailProvider)) {
            next.set(a.id, new GmailMailProvider(a.id, getGoogleToken, a.email));
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
  const backfillAccounts = useMemo(() => allMailAccounts.map(account => ({
    ...account,
    provider: allProviders.get(account.id) ?? null,
  })), [allMailAccounts, allProviders]);
  const { synchronize: synchronizeOfflineMail, isSynchronizing: offlineMailSynchronizing } = useOfflineMailSync(backfillAccounts);
  const contactBackfillStatus = useContactBackfill(backfillAccounts);

  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    () => allMailAccounts.length > 1 ? ALL_ACCOUNTS_ID : (allMailAccounts[0]?.id ?? ALL_ACCOUNTS_ID)
  );

  const isAllMode = selectedAccountId === ALL_ACCOUNTS_ID;
  const provider = isAllMode ? null : (allProviders.get(selectedAccountId) ?? null);
  const [selectedFolder, setSelectedFolder] = useState<Folder>('inbox');
  const [selectedFolderAccountId, setSelectedFolderAccountId] = useState<string | undefined>();
  const [selectedThread, setSelectedThread] = useState<MailThread | null>(null);
  const preserveThreadOnAccountChangeRef = useRef(false);
  // Needed before queries so we can load identities for the composing account in all-mode
  const [composingAccountId, setComposingAccountId] = useState<string>(() => allMailAccounts[0]?.id ?? '');

  // --- STATE ---
  const THREAD_PAGE_SIZE = 50;
  const [threadOffset, setThreadOffset] = useState(0);
  const [stableThreads, setStableThreads] = useState<MailThread[]>([]);
  const [searchQuery, setSearchQuery] = useState<MailSearchQuery | null>(null);

  // --- QUERIES ---
  const allAccountInfo = useMemo(() => allMailAccounts.map(a => {
    const atIdx = a.email.indexOf('@');
    const domain = atIdx >= 0 ? a.email.slice(atIdx + 1) : a.email;
    const label = domain.charAt(0).toUpperCase() + domain.slice(1);

    return {
      id: a.id,
      email: a.email,
      name: a.name,
      provider: allProviders.get(a.id) ?? null,
      label,
      color: a.color,
    };
  }), [allMailAccounts, allProviders]);

  const folderQuery = useMailFolders(selectedAccountId, provider);
  const allFoldersQuery = useAllAccountFolders(allAccountInfo);

  const unifiedFolderAccounts = useMemo(() => {
    const staticFolders = new Set(['inbox', 'sentitems', 'deleteditems', 'drafts', 'snoozed', 'spam']);
    if (staticFolders.has(selectedFolder)) return allAccountInfo;
    const ownerIds = selectedFolderAccountId
      ? new Set([selectedFolderAccountId])
      : new Set([...allFoldersQuery.allAccountFolders.entries()]
          .filter(([, folders]) => folders.some(folder => folder.folder_id === selectedFolder))
          .map(([accountId]) => accountId));
    return ownerIds.size > 0
      ? allAccountInfo.filter(account => ownerIds.has(account.id))
      : allAccountInfo;
  }, [allAccountInfo, allFoldersQuery.allAccountFolders, selectedFolder, selectedFolderAccountId]);

  const threadsQuery = useMailThreads(selectedAccountId, selectedFolder, provider, THREAD_PAGE_SIZE, threadOffset);
  const allThreadsQuery = useAllAccountThreads(selectedFolder, unifiedFolderAccounts, THREAD_PAGE_SIZE, threadOffset);
  const allThreadCountQueries = useQueries({
    queries: unifiedFolderAccounts.map(account => ({
      queryKey: ['mail', account.id, 'thread-count-v2', selectedFolder],
      queryFn: () => account.provider!.getThreadCount!(selectedFolder),
      enabled: isAllMode && !!account.provider?.getThreadCount,
      staleTime: 60 * 1000,
      retry: false,
    })),
  });
  const threadCountQuery = useQuery({
    queryKey: ['mail', selectedAccountId, 'thread-count-v2', selectedFolder],
    queryFn: () => provider!.getThreadCount!(selectedFolder),
    enabled: !isAllMode && !!provider?.getThreadCount,
    staleTime: 60 * 1000,
    retry: false,
  });
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
    () => deduplicateThreads(stableThreads).filter(t => !pendingRemovalIds.has(t.conversation_id)),
    [stableThreads, pendingRemovalIds],
  );

  const allThreadTotalCount = useMemo(() => {
    if (!isAllMode || unifiedFolderAccounts.length === 0) return undefined;
    let total = 0;
    for (let index = 0; index < unifiedFolderAccounts.length; index += 1) {
      const account = unifiedFolderAccounts[index];
      if (!account.provider?.getThreadCount) return undefined;
      const count = allThreadCountQueries[index]?.data;
      if (typeof count !== 'number') return undefined;
      total += count;
    }
    return total;
  }, [allThreadCountQueries, isAllMode, unifiedFolderAccounts]);
  const threadTotalCount = isAllMode ? allThreadTotalCount : threadCountQuery.data;

  const hasMoreThreads = isAllMode
    ? allThreadsQuery.hasMore
    : rawThreads.length >= THREAD_PAGE_SIZE;
  const threadsLoadingMore = threadsFetching && threadOffset > 0;
  // A persisted empty array counts as "data" for React Query, so isLoading is
  // false even while the first real network request is running. Treat that
  // state as an initial load instead of rendering the empty-folder view.
  const threadsInitialLoading = stableThreads.length === 0
    && (threadsLoading || threadsFetching || rawThreads.length > 0);

  // Always keep a ref to the latest rawThreads so the reset effect can read it
  // synchronously without adding it to the dependency array.
  const rawThreadsRef = useRef(rawThreads);
  rawThreadsRef.current = rawThreads;

  // Accumulate threads without ever clearing during a load-more fetch.
  // Only reset when the user navigates to a different folder/account/search.
  useEffect(() => {
    if (threadOffset === 0) {
      setStableThreads(deduplicateThreads(rawThreads));
      return;
    }
    if (rawThreads.length === 0) return;
    setStableThreads(previous => {
      const uniquePrevious = deduplicateThreads(previous);
      const known = new Set(uniquePrevious.map(threadIdentity));
      const next = rawThreads.filter(thread => {
        const identity = threadIdentity(thread);
        if (known.has(identity)) return false;
        known.add(identity);
        return true;
      });
      if (next.length) return [...uniquePrevious, ...next];
      return uniquePrevious.length === previous.length ? previous : uniquePrevious;
    });
  }, [rawThreads, threadOffset]);

  useEffect(() => {
    // Initialise immediately with whatever the cache already has (may be [] if uncached).
    // Using the ref avoids a stale closure while keeping rawThreads out of the dep array.
    setStableThreads(deduplicateThreads(rawThreadsRef.current));
    setThreadOffset(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId, selectedFolder, searchQuery]);

  useEffect(() => {
    if (preserveThreadOnAccountChangeRef.current) {
      preserveThreadOnAccountChangeRef.current = false;
      return;
    }
    setSelectedThread(null);
    setReplyingTo(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId]);

  const isOptimisticThread = selectedThread?.conversation_id.startsWith('__optimistic_thread__') ?? false;
  const conversationQuery = useMailConversation(
    selectedThread?.accountId ?? selectedAccountId,
    isOptimisticThread ? null : (selectedThread?.conversation_id ?? null),
    allProviders.get(selectedThread?.accountId ?? selectedAccountId) ?? provider,
    selectedFolder,
    selectedFolder === 'drafts',
    selectedFolder === 'deleteditems',
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

  useEffect(() => {
    if (!conversationQuery.error) return;
    if (isOfflineLikeError(conversationQuery.error)) return;
    const message = conversationQuery.error instanceof Error
      ? conversationQuery.error.message
      : String(conversationQuery.error);
    setError(message);
    const accountId = selectedThread?.accountId ?? selectedAccountId;
    const account = allMailAccounts.find(item => item.id === accountId);
    if (account && isConnectionFailure(conversationQuery.error)) {
      reportConnectionIssue({ accountId, provider: account.providerType === 'ews' ? 'exchange' : account.providerType === 'gmail' ? 'google' : account.providerType, message });
    }
  }, [conversationQuery.error, selectedThread?.accountId, selectedAccountId, allMailAccounts]);

  const searchSingleQuery = useMailSearch(selectedAccountId, searchQuery!, isAllMode ? null : provider);
  const searchAllQuery = useAllAccountSearch(searchQuery!, allAccountInfo);

  const searchResults = isAllMode ? searchAllQuery.data : searchSingleQuery.data;
  const searchLoading = isAllMode ? searchAllQuery.isLoading : searchSingleQuery.isLoading;

  // Single-account mode: query the selected account's identities
  const singleIdentityProvider = isAllMode ? null : (allProviders.get(selectedAccountId) ?? null);
  const singleIdentitiesQuery = useMailIdentities(selectedAccountId, singleIdentityProvider);

  // All-accounts mode: query all providers in parallel (with synthetic fallback for EWS/IMAP)
  const allModeIdentities = useAllAccountIdentities(allAccountInfo);

  const composerProvider = allProviders.get(
    selectedThread?.accountId ?? composingAccountId ?? selectedAccountId
  ) ?? provider;

  const accountIdentities = useMemo(() => {
    if (isAllMode) return allModeIdentities;
    const accInfo = allAccountInfo.find(a => a.id === selectedAccountId);
    return singleIdentitiesQuery.data.map(i => ({
      ...i,
      accountId: selectedAccountId,
      accountColor: accInfo?.color,
      accountLabel: accInfo?.label,
    }));
  }, [isAllMode, allModeIdentities, singleIdentitiesQuery.data, selectedAccountId, allAccountInfo]);

  const EMPTY_FOLDERS = useMemo(() => [] as import('../types').MailFolder[], []);
  const allFolders = isAllMode ? EMPTY_FOLDERS : (folderQuery.data ?? EMPTY_FOLDERS);
  const allAccountFolders = allFoldersQuery.allAccountFolders;
  const allModeDynamicFolders = allFoldersQuery.allModeDynamicFolders;

  const folderUnreadCounts = useMemo(() => {
    if (isAllMode) return allFoldersQuery.mergedCounts;
    if (folderQuery.data) return buildUnreadCounts(folderQuery.data);
    return {};
  }, [isAllMode, allFoldersQuery.mergedCounts, folderQuery.data]);

  const previousFolderUnreadCountsRef = useRef(new Map<string, number>());
  useEffect(() => {
    const countKey = `${selectedAccountId}:${selectedFolder}`;
    const currentUnreadCount = folderUnreadCounts[selectedFolder];
    if (currentUnreadCount === undefined) return;

    const previousUnreadCount = previousFolderUnreadCountsRef.current.get(countKey);
    previousFolderUnreadCountsRef.current.set(countKey, currentUnreadCount);
    if (previousUnreadCount === undefined || currentUnreadCount <= previousUnreadCount) return;

    // Folder metadata can finish polling before the paginated thread query.
    // A rising unread count means new inbox content is available, so force the
    // first page fresh instead of leaving the UI parked on an older page/cache.
    setThreadOffset(0);
    const accountIds = isAllMode
      ? unifiedFolderAccounts.map(account => account.id)
      : [selectedAccountId];
    for (const accountId of accountIds) {
      void queryClient.invalidateQueries({
        queryKey: [...MAIL_KEYS.threads(accountId, selectedFolder), THREAD_PAGE_SIZE, 0],
        exact: true,
        refetchType: 'all',
      });
    }
  }, [folderUnreadCounts, isAllMode, queryClient, selectedAccountId, selectedFolder, unifiedFolderAccounts]);

  const sidebarDynamicFolders = useMemo(() => {
    if (isAllMode) return allModeDynamicFolders;
    const info = allAccountInfo.find(a => a.id === selectedAccountId);
    return (folderQuery.data ?? [])
      .filter(f => {
        const normalized = DISPLAY_TO_STATIC[f.display_name.toLowerCase()] ?? f.folder_id;
        return !['inbox', 'sentitems', 'deleteditems', 'drafts', 'scheduled', 'snoozed', 'spam'].includes(normalized);
      })
      .map(f => ({ ...f, accountId: selectedAccountId, accountColor: info?.color, accountLabel: info?.label }));
  }, [isAllMode, allModeDynamicFolders, folderQuery.data, selectedAccountId, allAccountInfo]);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const threadErrors = isAllMode ? allThreadsQuery.errors : (threadsQuery.error ? [{ accountId: selectedAccountId, error: threadsQuery.error }] : []);
    const allErrors = [...threadErrors, ...allFoldersQuery.errors]
      .filter(candidate => !isOfflineLikeError(candidate.error));
    const temporaryMessage = t('mail.temporaryServiceUnavailable');
    if (allErrors.length > 0) {
      const firstError = allErrors[0];
      const msg = isTemporaryMailServiceError(firstError.error) ? temporaryMessage : getErrorMessage(firstError.error);
      const account = allMailAccounts.find(item => item.id === firstError.accountId);
      if (account && isConnectionFailure(firstError.error)) {
        reportConnectionIssue({ accountId: account.id, provider: account.providerType === 'ews' ? 'exchange' : account.providerType === 'gmail' ? 'google' : account.providerType, message: msg });
      }
      setError(prev => prev === msg ? prev : msg);
    } else {
      for (const account of allMailAccounts) clearConnectionIssue(account.id);
      setError(prev => prev === temporaryMessage ? null : prev);
    }
  }, [isAllMode, allThreadsQuery.errors, threadsQuery.error, allFoldersQuery.errors, t, selectedAccountId, allMailAccounts]);

  // --- MUTATIONS ---
  const mutations = useMailMutations();

  const [replyingTo, setReplyingTo] = useState<MailMessage | null>(null);
  const [replyMode, setReplyMode] = useState<'reply' | 'replyAll' | 'forward'>('reply');
  const [composing, setComposing] = useState(false);
  const observedMailContacts = useMemo<RecipientEntry[]>(() => {
    const byEmail = new Map<string, RecipientEntry>();
    const add = (email?: string | null, name?: string | null) => {
      if (!email) return;
      const key = email.trim().toLowerCase();
      if (!key.includes('@')) return;
      const existing = byEmail.get(key);
      if (!existing || (!existing.name && name)) {
        byEmail.set(key, { email: key, name: name || undefined, source: 'mail' });
      }
    };
    for (const thread of stableThreads) {
      add(thread.from_email, thread.from_name);
      for (const recipient of thread.to_recipients ?? []) add(recipient.email, recipient.name);
      for (const recipient of thread.cc_recipients ?? []) add(recipient.email, recipient.name);
      for (const sender of thread.unique_senders ?? []) add(sender.email, sender.name);
    }
    for (const message of messages) {
      add(message.from_email, message.from_name);
      for (const recipient of message.to_recipients) add(recipient.email, recipient.name);
      for (const recipient of message.cc_recipients) add(recipient.email, recipient.name);
    }
    return [...byEmail.values()];
  }, [stableThreads, messages]);
  const accountIds = useMemo(() => allMailAccounts.map(account => account.id), [allMailAccounts]);
  const indexedContactsQuery = useQuery({
    queryKey: ['contact-index', accountIds],
    queryFn: () => searchContactIndex(accountIds),
    enabled: accountIds.length > 0,
    staleTime: 60_000,
  });
  const observationsByAccount = useMemo(() => {
    const grouped = new Map<string, ContactObservation[]>();
    const accountEmails = new Map(allMailAccounts.map(account => [account.id, account.email.toLowerCase()]));
    const add = (accountId: string, email: string | null | undefined, name: string | null | undefined,
      kind: ContactObservation['kind'], occurredAt: number, eventId: string) => {
      const normalized = email?.trim().toLowerCase();
      if (!normalized || normalized === accountEmails.get(accountId) || !normalized.includes('@')) return;
      const localPart = normalized.split('@', 1)[0].replaceAll(/[._-]/g, '');
      if (localPart.includes('noreply') || localPart === 'mailerdaemon') return;
      const list = grouped.get(accountId) ?? [];
      list.push({ email: normalized, displayName: name || undefined, kind, occurredAt, eventId });
      grouped.set(accountId, list);
    };
    for (const thread of stableThreads) {
      const accountId = thread.accountId ?? selectedAccountId;
      if (!accountId || accountId === ALL_ACCOUNTS_ID) continue;
      const parsed = Date.parse(thread.last_delivery_time);
      const occurredAt = Number.isFinite(parsed) ? Math.floor(parsed / 1000) : Math.floor(Date.now() / 1000);
      if (selectedFolder === 'sentitems') {
        for (const recipient of [...(thread.to_recipients ?? []), ...(thread.cc_recipients ?? [])]) {
          add(accountId, recipient.email, recipient.name, 'sent', occurredAt, `thread:${thread.conversation_id}:${occurredAt}`);
        }
      } else {
        add(accountId, thread.from_email, thread.from_name, 'received', occurredAt, `thread:${thread.conversation_id}:${occurredAt}`);
      }
    }
    return grouped;
  }, [allMailAccounts, selectedAccountId, selectedFolder, stableThreads]);
  useEffect(() => {
    let cancelled = false;
    Promise.all([...observationsByAccount].map(([accountId, observations]) =>
      recordContactObservations(accountId, observations)
    )).then(results => {
      if (!cancelled && results.some(count => count > 0)) {
        void queryClient.invalidateQueries({ queryKey: ['contact-index'] });
        void queryClient.invalidateQueries({ queryKey: ['contact-index-search'] });
      }
    }).catch(error => console.error('[contact-index] unable to record observations', error));
    return () => { cancelled = true; };
  }, [observationsByAccount, queryClient]);
  useEffect(() => {
    cleanupContactIndex(365)
      .then(deleted => {
        if (deleted > 0) void queryClient.invalidateQueries({ queryKey: ['contact-index'] });
        if (deleted > 0) void queryClient.invalidateQueries({ queryKey: ['contact-index-search'] });
      })
      .catch(error => console.error('[contact-index] cleanup failed', error));
  }, [queryClient]);
  const mailContacts = useMemo<RecipientEntry[]>(() => {
    const merged = new Map<string, RecipientEntry>();
    for (const contact of indexedContactsQuery.data ?? []) {
      merged.set(contact.email.toLowerCase(), { email: contact.email, name: contact.name, source: 'mail' });
    }
    for (const contact of observedMailContacts) {
      const key = contact.email.toLowerCase();
      const existing = merged.get(key);
      merged.set(key, { ...existing, ...contact, name: contact.name ?? existing?.name });
    }
    return [...merged.values()];
  }, [indexedContactsQuery.data, observedMailContacts]);
  const contacts = useContactSuggestions(mailContacts);
  const [deleteToast, setDeleteToast] = useState<{ label: string } | null>(null);
  const [actionToast, setActionToast] = useState<{ label: string; onCancel?: () => void } | null>(null);
  const [downloadToast, setDownloadToast] = useState<{ name: string } | null>(null);
  const downloadToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => globalThis.matchMedia?.('(max-width: 700px)').matches
      || localStorage.getItem('mail-sidebar-collapsed') === 'true'
  );
  const getScreenKey = () => `${window.screen.width}x${window.screen.height}`;
  const screenKeyRef = useRef(getScreenKey());
  const [sidebarWidth, setSidebarWidth] = useState(() => Number(localStorage.getItem(`mail-sidebar-width-${getScreenKey()}`) || 240));
  const [threadListWidth, setThreadListWidth] = useState(() => Number(localStorage.getItem(`mail-threadlist-width-${getScreenKey()}`) || 390));
  const [snoozedMap, setSnoozedMap] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('mail-snoozed') ?? '{}'); } catch { return {}; }
  });
  const [attachmentPreview, setAttachmentPreview] = useState<{
    attachment: MailAttachment; loading: boolean; data: string | null;
  } | null>(null);
  const [loadingAttachmentId, setLoadingAttachmentId] = useState<string | null>(null);
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
    const toObj = (m: Map<string, DraftReplyEntry>) => {
      const obj: Record<string, DraftReplyEntry> = {};
      m.forEach((v, k) => { obj[k] = v; });
      return JSON.stringify(obj);
    };
    // If the write exceeds the quota, evict entries (oldest-first by insertion order)
    // one at a time until it fits or the map is empty.
    let current = new Map(map);
    while (current.size >= 0) {
      try {
        localStorage.setItem(DRAFT_MAP_KEY, toObj(current));
        return;
      } catch (e) {
        if (!(e instanceof DOMException) || current.size === 0) return;
        // Remove the first (oldest) entry and retry
        const firstKey = current.keys().next().value as string | undefined;
        if (firstKey === undefined) return;
        current.delete(firstKey);
      }
    }
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
  const isInSpamFolder = selectedFolder === 'spam';

  const resolveProvider = useCallback((accountId: string | undefined): MailProvider | null => {
    if (accountId) return allProviders.get(accountId) ?? null;
    if (!isAllMode) return allProviders.get(selectedAccountId) ?? null;
    return null;
  }, [allProviders, isAllMode, selectedAccountId]);

  const threadSupportsSnooze = useMemo(() => {
    const p = resolveProvider(selectedThread?.accountId);
    return p?.capabilities.snooze ?? false;
  }, [resolveProvider, selectedThread?.accountId]);

  const [mailCapabilitiesByAccount, setMailCapabilitiesByAccount] = useState(
    () => new Map([...allProviders].map(([accountId, mailProvider]) => [accountId, mailProvider.capabilities] as const)),
  );
  useEffect(() => {
    let cancelled = false;
    const baseline = new Map([...allProviders].map(([accountId, mailProvider]) => [accountId, mailProvider.capabilities] as const));
    setMailCapabilitiesByAccount(baseline);
    void Promise.all([...allProviders].map(async ([accountId, mailProvider]) => {
      if (!mailProvider.getCapabilities) return [accountId, mailProvider.capabilities] as const;
      try {
        return [accountId, await mailProvider.getCapabilities()] as const;
      } catch (error) {
        console.warn(`[mail:capabilities] ${accountId}`, error);
        return [accountId, mailProvider.capabilities] as const;
      }
    })).then(entries => {
      if (!cancelled) setMailCapabilitiesByAccount(new Map(entries));
    });
    return () => { cancelled = true; };
  }, [allProviders]);

  const selectAccount = useCallback((accountId: string) => {
    if (accountId === selectedAccountId) return;
    // Provider requests already in flight cannot always be killed at the transport
    // level, but cancelling their queries prevents their results from being
    // applied after the source switch.
    void queryClient.cancelQueries({ queryKey: MAIL_KEYS.all });
    setSelectedThread(null);
    setReplyingTo(null);
    setSelectedThreadIds(new Set());
    setPendingRemovalIds(new Set());
    setStableThreads([]);
    setThreadOffset(0);
    setSelectedFolderAccountId(undefined);
    setSelectedFolder('inbox');
    setSearchQuery(null);
    setComposing(false);
    setSelectedAccountId(accountId);
  }, [queryClient, selectedAccountId]);

  const selectFolder = useCallback((folder: Folder, accountId?: string) => {
    setSelectedFolderAccountId(accountId);
    setSelectedFolder(folder);
  }, []);

  // A notification already provides enough metadata to display a thread
  // immediately. Adopt its Inbox context without clearing that thread; the
  // regular Inbox query then fills its real index and neighbours in background.
  const adoptNotificationInboxContext = useCallback((accountId: string) => {
    if (selectedAccountId !== accountId) preserveThreadOnAccountChangeRef.current = true;
    setSelectedFolderAccountId(undefined);
    setSelectedFolder('inbox');
    setSearchQuery(null);
    setSelectedAccountId(accountId);
  }, [selectedAccountId]);

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
    setThreadOffset(0);
    if (selectedFolder === 'inbox' && offlineMail.enabled) {
      await synchronizeOfflineMail();
    }
    if (isAllModeRef.current) {
      await queryClient.invalidateQueries({ queryKey: MAIL_KEYS.all });
    } else {
      await queryClient.invalidateQueries({ queryKey: ['mail', selectedAccountId] });
    }
  }, [offlineMail.enabled, queryClient, selectedAccountId, selectedFolder, synchronizeOfflineMail]);

  const loadMoreThreads = useCallback(async () => {
    if (threadsFetching || !hasMoreThreads) return;
    setThreadOffset(prev => prev + THREAD_PAGE_SIZE);
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
    if (selectedThread?.conversation_id === threadId) {
        const nextThread = currentIndex === -1
          ? threads[0] ?? null
          : threads[currentIndex + 1] ?? threads[currentIndex - 1] ?? null;
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
      const threadRollback = optimisticallyRemoveThread(thread.conversation_id);

      let folderRollback: (() => void) | null = null;
      if (!isInTrash && thread.unread_count > 0) {
        const foldersKey = MAIL_KEYS.folders(accountId);
        const previousFolders = queryClient.getQueryData<MailFolder[]>(foldersKey);
        queryClient.setQueriesData<MailFolder[]>({ queryKey: foldersKey }, (old) => {
          if (!Array.isArray(old)) return old;
          return old.map(f => {
            const staticKey = DISPLAY_TO_STATIC[f.display_name.toLowerCase()] ?? f.folder_id;
            if (f.folder_id === selectedFolder || staticKey === selectedFolder) {
              return { ...f, unread_count: Math.max(0, f.unread_count - thread.unread_count) };
            }
            return f;
          });
        });
        folderRollback = () => {
          if (previousFolders !== undefined) queryClient.setQueryData(foldersKey, previousFolders);
        };
      }

      const rollback = () => {
        threadRollback();
        folderRollback?.();
      };

      const execute = () => {
        const isDraft = selectedFolder === 'drafts';
        const clearPendingRemoval = () => setPendingRemovalIds(prev => {
          const next = new Set(prev);
          next.delete(thread.conversation_id);
          return next;
        });
        if (isInTrash) {
          mutations.deletePermanently(
            { accountId, provider: p, conversationId: thread.conversation_id },
            { onSettled: clearPendingRemoval },
          );
        } else {
          mutations.moveToTrash(
            { accountId, provider: p, conversationId: thread.conversation_id, folderId: selectedFolder, threadUnreadCount: 0, isDraft },
            { onSettled: clearPendingRemoval },
          );
        }
        setDeleteToast(null);
      };

      const toastLabel = isInTrash
        ? t('mail.deletedPermanently', 'Conversation supprimée définitivement')
        : t('mail.movedToTrash', 'Conversation déplacée vers la corbeille');
      setDeleteToast({ label: toastLabel });
      pendingActionRef.current = { id: thread.conversation_id, timerId: setTimeout(execute, 5000), execute, rollback };
    }
  }, [mutations, selectedThread, threads, resolveProvider, selectedAccountId, selectedFolder, selectNextThread, t, flushPendingAction, optimisticallyRemoveThread, queryClient]);

  const handleToggleThreadRead = useCallback((thread: MailThread) => {
    const p = resolveProvider(thread.accountId);
    if (p) mutations.markRead({ accountId: thread.accountId ?? selectedAccountId, provider: p, conversationId: thread.conversation_id, read: thread.unread_count > 0, folderId: selectedFolder, threadUnreadCount: thread.unread_count });
  }, [mutations, resolveProvider, selectedAccountId, selectedFolder]);

  const handleDeleteThread = useCallback((thread: MailThread) => {
    moveToTrash(thread.conversation_id);
  }, [moveToTrash]);

  const handleDeleteMessage = useCallback(async (message: MailMessage) => {
    if (!selectedThread) return;
    const p = resolveProvider(selectedThread.accountId);
    if (!p) return;

    const accountId = selectedThread.accountId ?? selectedAccountId;
    const permanently = selectedFolder === 'deleteditems';
    try {
      if (permanently) await p.permanentlyDelete(message.item_id);
      else await p.moveToTrash(message.item_id);

      if (offlineMail.enabled && selectedFolder === 'inbox') {
        await removeOfflineInboxMessages(accountId, selectedThread.conversation_id, [message.item_id]);
        void synchronizeOfflineMail();
      }

      queryClient.setQueriesData<MailMessage[]>(
        { queryKey: MAIL_KEYS.thread(accountId, selectedThread.conversation_id) },
        old => Array.isArray(old) ? old.filter(item => item.item_id !== message.item_id) : old,
      );
      if (messages.filter(item => !item.is_draft).length <= 1) {
        selectNextThread(selectedThread.conversation_id);
      }
      await queryClient.invalidateQueries({ queryKey: ['mail', accountId] });
      await queryClient.invalidateQueries({ queryKey: ['mail', 'all'] });
      setActionToast({
        label: permanently
          ? t('mail.messageDeletedPermanently', 'Message supprimé définitivement')
          : t('mail.messageMovedToTrash', 'Message déplacé vers la corbeille'),
      });
      setTimeout(() => setActionToast(null), 3000);
    } catch (err) {
      setError(getErrorMessage(err));
      throw err;
    }
  }, [selectedThread, resolveProvider, selectedAccountId, selectedFolder, offlineMail.enabled, queryClient, messages, selectNextThread, t, setActionToast]);

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
          { onError: (error) => {
            clearSnooze(conversationId);
            const detail = getErrorMessage(error);
            setActionToast({ label: `${t('mail.snoozeFailed', 'Impossible de mettre ce message en attente')} — ${detail}` });
            setTimeout(() => setActionToast(null), 8000);
          } },
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
        if (p) {
          persistSnooze(id, until);
          mutations.snoozeThread(
            { accountId: thread.accountId ?? selectedAccountId, provider: p, conversationId: id, until },
            { onError: (error) => {
              clearSnooze(id);
              const detail = getErrorMessage(error);
              setActionToast({ label: `${t('mail.snoozeFailed', 'Impossible de mettre ce message en attente')} — ${detail}` });
              setTimeout(() => setActionToast(null), 8000);
            } },
          );
        }
      }
    }
    setSelectedThreadIds(new Set());
  }, [selectedThreadIds, threads, resolveProvider, selectedAccountId, mutations, persistSnooze, clearSnooze, t]);
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
        if (p) mutations.markRead({
          accountId: thread.accountId ?? selectedAccountId,
          provider: p,
          conversationId: id,
          read,
          folderId: selectedFolder,
          threadUnreadCount: thread.unread_count,
        });
      }
    }
    setSelectedThreadIds(new Set());
  }, [selectedThreadIds, threads, resolveProvider, selectedAccountId, selectedFolder, mutations]);

  const previewAttachment = useCallback(async (att: MailAttachment) => {
    const p = resolveProvider(selectedThread?.accountId);
    if (!p) return;
    const canPreviewInApp = att.content_type.startsWith('image/') || att.content_type.includes('pdf');
    if (att.local_data && canPreviewInApp) {
      setAttachmentPreview({ attachment: att, loading: false, data: att.local_data });
      return;
    }
    if (!canPreviewInApp) {
      setLoadingAttachmentId(`preview:${att.attachment_id}`);
      try { await p.openAttachment(att); } catch (e) { setError(String(e)); }
      setLoadingAttachmentId(null);
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
    setLoadingAttachmentId(`download:${att.attachment_id}`);
    try {
      const data = att.local_data ?? await p.getAttachmentData(att);
      fileService.downloadBase64(att.name, data, att.content_type);
      if (downloadToastTimerRef.current) clearTimeout(downloadToastTimerRef.current);
      setDownloadToast({ name: att.name });
      downloadToastTimerRef.current = setTimeout(() => setDownloadToast(null), 15000);
    } catch (e) { setError(String(e)); }
    setLoadingAttachmentId(null);
  }, [resolveProvider, selectedThread]);

  const getRawAttachmentData = useCallback(async (att: MailAttachment): Promise<string> => {
    if (att.local_data) return att.local_data;
    const p = resolveProvider(selectedThread?.accountId);
    if (!p) throw new Error('Provider introuvable');
    return p.getAttachmentData(att);
  }, [resolveProvider, selectedThread]);

  const scheduleSend = useCallback(async (
    to: string[], cc: string[], bcc: string[], subject: string, body: string,
    restoreData: ComposerRestoreData, attachments?: ComposerAttachment[], sendAt?: string,
  ) => {
    const { fromAccountId, fromIdentityId, draftItemId } = restoreData;
    const p = fromAccountId ? (allProviders.get(fromAccountId) ?? null) : resolveProvider(selectedThread?.accountId);
    if (!p) return;

    const accountId = fromAccountId ?? selectedThread?.accountId ?? selectedAccountId;
    const selectedConversationId = selectedThread?.conversation_id;
    const conversationId = restoreData.isNewMessage || selectedConversationId?.startsWith('__optimistic_thread__')
      ? undefined
      : selectedConversationId;
    const draftConversationId = draftItemId ? (selectedThread?.conversation_id ?? null) : null;

    const account = allMailAccounts.find(a => a.id === accountId);
    const optimisticId = '__optimistic__' + Date.now();
    const optimisticAttachments: MailAttachment[] = (attachments ?? []).map((attachment, index) => ({
      attachment_id: `${optimisticId}:attachment:${index}`,
      name: attachment.name,
      content_type: attachment.contentType,
      size: attachment.size,
      is_inline: attachment.isInline ?? false,
      local_data: attachment.data,
    }));
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
      has_attachments: optimisticAttachments.length > 0,
      attachments: optimisticAttachments,
    };

    const optimisticConversationId = restoreData.isNewMessage && !sendAt
      ? `__optimistic_thread__${optimisticId}`
      : conversationId;

    if (optimisticConversationId) {
      setPendingOptimisticMsgs(prev => {
        const next = new Map(prev);
        next.set(optimisticConversationId, [...(prev.get(optimisticConversationId) ?? []), optimisticMsg]);
        return next;
      });
    }

    if (restoreData.isNewMessage && optimisticConversationId) {
      setSelectedThread({
        conversation_id: optimisticConversationId,
        topic: subject,
        snippet: body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
        last_delivery_time: optimisticMsg.date_time_received,
        message_count: 1,
        unread_count: 0,
        from_name: optimisticMsg.from_name,
        from_email: optimisticMsg.from_email,
        has_attachments: optimisticMsg.has_attachments,
        to_recipients: optimisticMsg.to_recipients,
        cc_recipients: optimisticMsg.cc_recipients,
        accountId,
      });
    }

    const isDraftFolder = selectedFolder === 'drafts';
    const isTrashFolder = selectedFolder === 'deleteditems';
    const messagesKey = conversationId
      ? ([...MAIL_KEYS.thread(accountId, conversationId), isDraftFolder, isTrashFolder] as const)
      : null;
    const realCountBefore = messagesKey
      ? (queryClient.getQueryData<MailMessage[]>(messagesKey)?.length ?? 0)
      : 0;

    const removeOptimistic = () => {
      if (!optimisticConversationId) return;
      setPendingOptimisticMsgs(prev => {
        const next = new Map(prev);
        const remaining = (prev.get(optimisticConversationId) ?? []).filter(m => m.item_id !== optimisticId);
        if (remaining.length === 0) next.delete(optimisticConversationId);
        else next.set(optimisticConversationId, remaining);
        return next;
      });
    };

    // Extracted to keep nesting ≤ 4 levels inside the setTimeout
    const doPoll = async (attempt: number): Promise<void> => {
      if (!conversationId || !messagesKey) return;
      try {
        const fresh = await p.getThread(conversationId, isTrashFolder, isDraftFolder, !isDraftFolder);
        if (fresh.length > realCountBefore) {
          queryClient.setQueryData<MailMessage[]>(messagesKey, fresh);
          const bump = (old: MailThread[] | undefined) =>
            old?.map(t => t.conversation_id === conversationId
              ? { ...t, message_count: t.message_count + 1 }
              : t);
          queryClient.setQueriesData<MailThread[]>({ queryKey: ['mail', accountId, 'threads'] }, bump);
          queryClient.setQueriesData<MailThread[]>({ queryKey: ['mail', 'all', 'threads'] }, bump);
          if (selectedFolder === 'inbox' && offlineMail.enabled) {
            void synchronizeOfflineMail();
          }
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
          sendAt,
        });
        const sentAt = Math.floor(Date.now() / 1000);
        const recipientNames = new Map(
          [...restoreData.toRecipients, ...restoreData.ccRecipients, ...restoreData.bccRecipients]
            .map(recipient => [recipient.email.toLowerCase(), recipient.name] as const)
        );
        const sentObservations = [...to, ...cc, ...bcc].map(email => ({
          email,
          displayName: recipientNames.get(email.toLowerCase()),
          kind: 'sent' as const,
          occurredAt: sentAt,
          eventId: `send:${optimisticId}`,
        }));
        await recordContactObservations(accountId, sentObservations);
        if (sendAt) {
          void queryClient.invalidateQueries({ queryKey: MAIL_KEYS.threads(accountId, 'scheduled') });
          void queryClient.invalidateQueries({ queryKey: ['mail', 'all', 'threads', 'scheduled'] });
        }
        void queryClient.invalidateQueries({ queryKey: ['contact-index'] });
        void queryClient.invalidateQueries({ queryKey: ['contact-index-search'] });
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
          if (!optimisticConversationId) setSelectedThread(null);
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
  }, [allProviders, resolveProvider, selectedThread, selectedAccountId, allMailAccounts, mutations, t, queryClient, selectedFolder]);

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

  useEffect(() => {
    const handleScreenChange = () => {
      const newKey = `${window.screen.width}x${window.screen.height}`;
      if (newKey !== screenKeyRef.current) {
        screenKeyRef.current = newKey;
        setSidebarWidth(Number(localStorage.getItem(`mail-sidebar-width-${newKey}`) || 220));
        setThreadListWidth(Number(localStorage.getItem(`mail-threadlist-width-${newKey}`) || 350));
      }
    };
    window.addEventListener('resize', handleScreenChange);
    return () => window.removeEventListener('resize', handleScreenChange);
  }, []);

  const startResizingSidebar = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    let currentWidth = startWidth;
    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      currentWidth = Math.max(150, Math.min(300, startWidth + delta));
      setSidebarWidth(currentWidth);
    };
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      localStorage.setItem(`mail-sidebar-width-${screenKeyRef.current}`, String(currentWidth));
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [sidebarWidth]);

  const startResizingThreadList = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = threadListWidth;
    let currentWidth = startWidth;
    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      currentWidth = Math.max(200, Math.min(500, startWidth + delta));
      setThreadListWidth(currentWidth);
    };
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      localStorage.setItem(`mail-threadlist-width-${screenKeyRef.current}`, String(currentWidth));
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [threadListWidth]);

  return {
    t, preference, allMailAccounts, selectedAccountId, isAllMode, selectedFolder, selectedFolderAccountId,
    threads,
    threadsLoading: threadsInitialLoading && threadOffset === 0,
    threadsRefreshing: threadOffset === 0 && (threadsFetching || offlineMailSynchronizing),
    threadsLoadingMore, hasMoreThreads, threadTotalCount, selectedThread,
    messages, messagesLoading, replyingTo, replyMode, composing, composingAccountId,
    contacts, contactBackfillStatus, error, deleteToast, downloadToast, actionToast,
    selectedThreadIds, composerRestoreData, composingDraftItemId, sidebarCollapsed,
    sidebarWidth, threadListWidth, snoozedMap, isInSnoozedFolder, isInSpamFolder, allFolders,
    allAccountFolders, folderUnreadCounts, allAccountsUnreadCounts: allFoldersQuery.mergedCounts, sidebarDynamicFolders, attachmentPreview, loadingAttachmentId,
    selectAccount, selectFolder, adoptNotificationInboxContext, setComposing, setComposingAccountId,
    setError, setDownloadToast, cancelDeletion, cycleTheme, loadThreads, reloadThreads, loadMoreThreads,
    openThread, markRead, toggleRead, moveToTrash, handleToggleThreadRead,
    handleDeleteThread, handleDeleteMessage, handleSnooze, handleUnsnooze, handleMove, handleBulkDelete,
    handleBulkSnooze, handleBulkMove, handleBulkToggleRead, previewAttachment,
    downloadAttachment, getRawAttachmentData, scheduleSend, cancelSend, handleSaveDraft,
    startResizingSidebar, startResizingThreadList, setSidebarCollapsed,
    setSelectedThreadIds, setAttachmentPreview, provider, composerProvider, resolveProvider, setReplyingTo, setReplyMode, setActionToast,
    handleFoldersLoaded, setSelectedThread, threadSupportsSnooze, mailCapabilitiesByAccount,
    searchQuery, searchResults, searchLoading, handleSearch,
    isSending: mutations.isSending,
    accountIdentities,
    draftConversationIds,
    dismissDraftForConversation,
    allProviders,
  };
}
