import {
  AlarmClock,
  Archive,
  BellOff,
  Bold,
  Check,
  ChevronDown,
  Clock,
  Download,
  Eye,
  FolderInput,
  Forward,
  Highlighter,
  ImagePlus,
  Inbox,
  Italic,
  Layers,
  List,
  ListOrdered,
  Mail,
  MailOpen,
  Menu,
  Monitor,
  Moon,
  MoreHorizontal,
  Paperclip,
  RefreshCw,
  Send,
  Settings,
  ShieldAlert,
  Sun,
  Trash2,
  Type,
  Underline,
  X,
} from 'lucide-react';
import { ComposerAttachment, MailProvider } from './providers/MailProvider';
import { FileIcon, defaultStyles } from 'react-file-icon';
import { Folder, MailAttachment, MailMessage, MailThread } from './types';
import {
  FormEvent,
  MouseEvent,
  MouseEvent as ReactMouseEvent,
  RefObject,
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { RecipientEntry, RecipientInput } from './components/RecipientInput';
import { ThemePreference, useTheme } from '../../shared/store/ThemeStore';
import { avatarColor, decodeHtmlEntities, formatDate, formatFullDate, formatSize, initials } from './utils';

import { CachedMailProvider } from './providers/CachedMailProvider';
import type { OnInboxRefreshed } from './providers/CachedMailProvider';
import { EwsMailProvider } from './providers/EwsMailProvider';
import { FolderPickerPopover } from './components/FolderPickerPopover';
import { GmailMailProvider } from './providers/GmailMailProvider';
import { Link } from 'react-router-dom';
import { MailSidebar } from './components/MailSidebar';
import { MessageBlockHeader } from './components/MessageBlockHeader';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { useContactSuggestions } from './hooks/useContactSuggestions';
import { useExchangeAuth } from '../../shared/store/ExchangeAuthStore';
import { useGoogleAuth } from '../../shared/store/GoogleAuthStore';
import { useTranslation } from 'react-i18next';

const ALL_ACCOUNTS_ID = '__all__';

function ThemeIcon({ pref }: { readonly pref: ThemePreference }) {
  if (pref === 'light') return <Sun size={18} />;
  if (pref === 'dark') return <Moon size={18} />;
  return <Monitor size={18} />;
}
const THEME_CYCLE: ThemePreference[] = ['system', 'light', 'dark'];

function FileTypeIcon({ name, size = 20 }: { readonly name: string; readonly size?: number }) {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  return (
    <div style={{ width: size, height: size, flexShrink: 0 }}>
      <FileIcon extension={ext} {...(defaultStyles[ext as keyof typeof defaultStyles] ?? {})} />
    </div>
  );
}

// ── Folder unread count helpers ────────────────────────────────────────────────
// EWS returns real FolderIds (base64) for well-known folders, not the distinguished
// names ('inbox', 'sentitems', …) used as static sidebar keys. Map by display name.
const DISPLAY_TO_STATIC: Record<string, string> = {
  'inbox': 'inbox',
  'boîte de réception': 'inbox',
  'sent': 'sentitems',
  'sent items': 'sentitems',
  'éléments envoyés': 'sentitems',
  'trash': 'deleteditems',
  'deleted items': 'deleteditems',
  'éléments supprimés': 'deleteditems',
  'drafts': 'drafts',
  'brouillons': 'drafts',
};
function buildUnreadCounts(folders: import('./types').MailFolder[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of folders) {
    const key = DISPLAY_TO_STATIC[f.display_name.toLowerCase()] ?? f.folder_id;
    counts[key] = f.unread_count;
  }
  return counts;
}

// ── Main component ─────────────────────────────────────────────────────────────

const SIDEBAR_MIN = 150;
const SIDEBAR_MAX = 300;
const THREADLIST_MIN = 200;
const THREADLIST_MAX = 500;

export default function MailApp() {
  const { t } = useTranslation();
  const { accounts: ewsAccounts, getValidToken: getEwsToken } = useExchangeAuth();
  const { accounts: googleAccounts, getValidToken: getGoogleToken } = useGoogleAuth();
  const { preference, setPreference } = useTheme();

  /** Stable ref so CachedMailProvider background refreshes always see current state. */
  const onInboxRefreshedRef = useRef<OnInboxRefreshed | null>(null);

  // Unified account list across all providers
  const allMailAccounts = useMemo(() => [
    ...ewsAccounts.map(a => ({ id: a.id, email: a.email, name: a.displayName, providerType: 'ews' as const, color: a.color })),
    ...googleAccounts.map(a => ({ id: a.id, email: a.email, name: a.name, providerType: 'gmail' as const, color: a.color })),
  ], [ewsAccounts, googleAccounts]);

  // Map of accountId → MailProvider (stable — recreated only when accounts change)
  const allProviders = useMemo<Map<string, MailProvider>>(() => {
    const map = new Map<string, MailProvider>();
    for (const a of ewsAccounts) {
      map.set(a.id, new CachedMailProvider(
        new EwsMailProvider(a.id, getEwsToken),
        (aid, threads) => onInboxRefreshedRef.current?.(aid, threads),
      ));
    }
    for (const a of googleAccounts) {
      map.set(a.id, new CachedMailProvider(
        new GmailMailProvider(a.id, getGoogleToken),
        (aid, threads) => onInboxRefreshedRef.current?.(aid, threads),
      ));
    }
    return map;
  // getEwsToken / getGoogleToken are stable store refs — intentionally excluded
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ewsAccounts, googleAccounts]);

  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    () => allMailAccounts.length > 1 ? ALL_ACCOUNTS_ID : (allMailAccounts[0]?.id ?? ALL_ACCOUNTS_ID)
  );

  const isAllMode = selectedAccountId === ALL_ACCOUNTS_ID;

  // Resolve provider for an action — use thread's accountId in All mode, else single account
  const resolveProvider = useCallback((accountId: string | undefined): MailProvider | null => {
    if (accountId) return allProviders.get(accountId) ?? null;
    if (!isAllMode) return allProviders.get(selectedAccountId) ?? null;
    return null;
  }, [allProviders, isAllMode, selectedAccountId]);

  // Single-account provider for sidebar folder loading (null in All mode)
  const provider = isAllMode ? null : (allProviders.get(selectedAccountId) ?? null);
  const [selectedFolder, setSelectedFolder] = useState<Folder>('inbox');
  const [threads, setThreads] = useState<MailThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsLoadingMore, setThreadsLoadingMore] = useState(false);
  const [hasMoreThreads, setHasMoreThreads] = useState(true);
  const [selectedThread, setSelectedThread] = useState<MailThread | null>(null);
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [replyingTo, setReplyingTo] = useState<MailMessage | null>(null);
  const [replyMode, setReplyMode] = useState<'reply' | 'replyAll' | 'forward'>('reply');
  const [composing, setComposing] = useState(false);
  // Account used when composing a new message in All-accounts mode
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
  } | null>(null);

  const [sendToast, setSendToast] = useState<{ label: string } | null>(null);
  const [draftToast, setDraftToast] = useState<{ label: string } | null>(null);
  const draftToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [actionToast, setActionToast] = useState<{ label: string } | null>(null);
  const actionToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Multi-selection
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());
  const [composerRestoreData, setComposerRestoreData] = useState<ComposerRestoreData | null>(null);
  const [composingDraftItemId, setComposingDraftItemId] = useState<{ itemId: string; accountId: string } | null>(null);
  const pendingSendRef = useRef<{
    execute: () => Promise<void>;
    timerId: ReturnType<typeof setTimeout>;
    restoreData: ComposerRestoreData;
  } | null>(null);

  // Tracks conversation_ids whose unread count has already been subtracted from folderUnreadCounts.
  // Cleared when the folder or account changes.
  const folderAccountedRef = useRef(new Set<string>());

  // Panel resizing
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
  const mailBodyRef = useRef<HTMLDivElement>(null);
  const threadListRef = useRef<HTMLDivElement>(null);

  // Map of conversationId → snoozeUntil (for thread list badge, new records only)
  const [snoozedMap, setSnoozedMap] = useState<Record<string, string>>(() => {
    const stored: { itemId: string; accountId: string; snoozeUntil: string; conversationId?: string }[] =
      JSON.parse(localStorage.getItem('mail-snoozed-items') ?? '[]');
    const map: Record<string, string> = {};
    for (const item of stored) {
      if (item.conversationId) map[item.conversationId] = item.snoozeUntil;
    }
    return map;
  });
  // Map of itemId → snoozeUntil (works for both old and new records)
  const [snoozedByItemId, setSnoozedByItemId] = useState<Record<string, string>>(() => {
    const stored: { itemId: string; snoozeUntil: string }[] =
      JSON.parse(localStorage.getItem('mail-snoozed-items') ?? '[]');
    const map: Record<string, string> = {};
    for (const item of stored) map[item.itemId] = item.snoozeUntil;
    return map;
  });

  // Folders per account (used in All mode for sidebar override)
  const [allFolders, setAllFolders] = useState<import('./types').MailFolder[]>([]);
  // In All mode: all dynamic folders from every account, keyed by accountId
  const [allAccountFolders, setAllAccountFolders] = useState<Map<string, import('./types').MailFolder[]>>(new Map());
  const [folderUnreadCounts, setFolderUnreadCounts] = useState<Record<string, number>>({});
  const snoozedFolderId = allFolders.find(f => f.display_name === 'Snoozed')?.folder_id;
  const isInSnoozedFolder = snoozedFolderId !== undefined && selectedFolder === snoozedFolderId;

  const handleFoldersLoaded = useCallback((folders: import('./types').MailFolder[]) => {
    setAllFolders(folders);
    setFolderUnreadCounts(buildUnreadCounts(folders));
  }, []);

  // In All mode, build combined dynamic folders from all accounts for sidebar override
  const allModeDynamicFolders = useMemo(() => {
    if (!isAllMode) return null;
    const STATIC_IDS = new Set(['inbox', 'sentitems', 'deleteditems', 'INBOX', 'SENT', 'TRASH', 'SPAM', 'DRAFT']);
    const WELL_KNOWN_NAMES = new Set([
      'inbox', 'sent', 'sent items', 'deleted items', 'drafts', 'outbox', 'junk email',
      'spam', 'trash', 'boîte de réception', 'éléments envoyés', 'éléments supprimés',
      'courrier indésirable', 'brouillons',
    ]);
    const result: (import('./types').MailFolder & { accountId: string; accountColor?: string })[] = [];
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

  // Cleanup pending deletion and send on unmount
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
  ) => {
    // Flush any already-pending deletion immediately
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

    pendingDeletionRef.current = { revert, execute, timerId };
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
        // Load threads + folders from all accounts in parallel
        const [threadResults, folderResults] = await Promise.all([
          Promise.allSettled(
            Array.from(allProviders.entries()).map(async ([accountId, p]) => {
              const acc = allMailAccounts.find(a => a.id === accountId);
              const atIdx = (acc?.email ?? '').indexOf('@');
              const domain = atIdx >= 0 ? (acc?.email ?? '').slice(atIdx + 1) : (acc?.email ?? '');
              const accountLabel = domain.charAt(0).toUpperCase() + domain.slice(1);
              const accountColor = acc?.color;
              const threads = await p.listThreads(selectedFolder, 50, 0);
              return threads.map(t => ({ ...t, accountId, accountLabel, accountColor }));
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
        setHasMoreThreads(false); // no pagination in All mode
        // Populate allAccountFolders so the sidebar dynamic folder list is complete
        const mergedCounts: Record<string, number> = {};
        const newAccountFolders = new Map<string, import('./types').MailFolder[]>();
        for (const r of folderResults) {
          if (r.status !== 'fulfilled') continue;
          const { accountId, folders } = r.value;
          newAccountFolders.set(accountId, folders);
          const counts = buildUnreadCounts(folders);
          for (const [key, val] of Object.entries(counts)) {
            mergedCounts[key] = (mergedCounts[key] ?? 0) + val;
          }
        }
        setFolderUnreadCounts(mergedCounts);
        setAllAccountFolders(newAccountFolders);
      } else {
        if (!provider) return;
        const result = await provider.listThreads(selectedFolder, 50, 0);
        setThreads(result);
        setHasMoreThreads(result.length >= 50);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setThreadsLoading(false);
    }
  }, [isAllMode, allProviders, provider, selectedFolder]);

  const loadMoreThreads = useCallback(async () => {
    if (isAllMode || !provider || threadsLoadingMore || !hasMoreThreads) return;
    setThreadsLoadingMore(true);
    try {
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
    } catch (e) {
      console.error('[mail] loadMoreThreads error:', e);
    } finally {
      setThreadsLoadingMore(false);
    }
  }, [isAllMode, provider, threadsLoadingMore, hasMoreThreads, threads.length, selectedFolder]);

  useEffect(() => {
    setSelectedThread(null);
    setMessages([]);
    setReplyingTo(null);
    setHasMoreThreads(true);
    setSelectedThreadIds(new Set());
    loadThreads();
  }, [loadThreads]);

  // Infinite scroll detection
  useEffect(() => {
    const container = threadListRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      // Load more when within 100px of bottom
      if (scrollHeight - scrollTop - clientHeight < 100) {
        loadMoreThreads();
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [loadMoreThreads]);

  // Update the dock/taskbar badge with the inbox unread count.
  const updateBadge = useCallback(async () => {
    try {
      if (isAllMode) {
        const counts = await Promise.allSettled(
          Array.from(allProviders.values()).map(p => p.getInboxUnread())
        );
        const total = counts.reduce((sum, r) => sum + (r.status === 'fulfilled' ? r.value : 0), 0);
        invoke('set_badge_count', { count: total }).catch(() => {});
      } else if (provider) {
        const count = await provider.getInboxUnread();
        invoke('set_badge_count', { count }).catch(() => {});
      }
    } catch {
      // Non-critical
    }
  }, [isAllMode, allProviders, provider]);

  // Keep the onInboxRefreshed callback ref up to date with latest state each render.
  // This lets CachedMailProvider background refreshes update the UI without re-creating providers.
  onInboxRefreshedRef.current = (accountId: string, freshThreads: MailThread[]) => {
    if (selectedFolder !== 'inbox') return;
    if (isAllMode) {
      const acc = allMailAccounts.find(a => a.id === accountId);
      const atIdx = (acc?.email ?? '').indexOf('@');
      const domain = atIdx >= 0 ? (acc?.email ?? '').slice(atIdx + 1) : (acc?.email ?? '');
      const accountLabel = domain.charAt(0).toUpperCase() + domain.slice(1);
      const accountColor = acc?.color;
      const tagged = freshThreads.map(t => ({ ...t, accountId, accountLabel, accountColor }));
      setThreads(prev => {
        const others = prev.filter(t => t.accountId !== accountId);
        return [...others, ...tagged].sort((a, b) =>
          new Date(b.last_delivery_time).getTime() - new Date(a.last_delivery_time).getTime()
        );
      });
    } else if (selectedAccountId === accountId) {
      setThreads(freshThreads);
    }
  };

  // Silent thread refresh (no loading spinner) used by the polling interval.
  const silentRefresh = useCallback(async () => {
    try {
      if (isAllMode) {
        // Refresh threads + folders for all accounts
        const [threadResults, folderResults] = await Promise.all([
          Promise.allSettled(
            Array.from(allProviders.entries()).map(async ([accountId, p]) => {
              const acc = allMailAccounts.find(a => a.id === accountId);
              const atIdx = (acc?.email ?? '').indexOf('@');
              const domain = atIdx >= 0 ? (acc?.email ?? '').slice(atIdx + 1) : (acc?.email ?? '');
              const accountLabel = domain.charAt(0).toUpperCase() + domain.slice(1);
              const accountColor = acc?.color;
              // Force a network fetch for inbox to bypass the local cache
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
        const merged = threadResults
          .flatMap(r => r.status === 'fulfilled' ? r.value : [])
          .sort((a, b) => new Date(b.last_delivery_time).getTime() - new Date(a.last_delivery_time).getTime());
        setThreads(merged);
        // Build merged unread counts (sum for static folders, per-account for dynamic)
        const mergedCounts: Record<string, number> = {};
        const newAccountFolders = new Map<string, import('./types').MailFolder[]>();
        for (const r of folderResults) {
          if (r.status !== 'fulfilled') continue;
          const { accountId, folders } = r.value;
          newAccountFolders.set(accountId, folders);
          const counts = buildUnreadCounts(folders);
          for (const [key, val] of Object.entries(counts)) {
            mergedCounts[key] = (mergedCounts[key] ?? 0) + val;
          }
        }
        setFolderUnreadCounts(mergedCounts);
        setAllAccountFolders(newAccountFolders);
      } else if (provider) {
        // Force a network fetch for inbox to bypass the local cache
        const fetchThreads = selectedFolder === 'inbox'
          ? provider.forceRefreshInbox?.(50) ?? provider.listThreads(selectedFolder, 50, 0)
          : provider.listThreads(selectedFolder, 50, 0);
        const [result, folders] = await Promise.all([
          fetchThreads,
          provider.listFolders(),
        ]);
        setThreads(result);
        setHasMoreThreads(result.length >= 50);
        setFolderUnreadCounts(buildUnreadCounts(folders));
      }
    } catch {
      // Non-critical
    }
  }, [isAllMode, allProviders, provider, selectedFolder]);

  // Auto-refresh: poll every 60 s and update the badge on mount.
  useEffect(() => {
    updateBadge();
    const id = setInterval(() => {
      silentRefresh();
      updateBadge();
    }, 60_000);
    return () => clearInterval(id);
  }, [updateBadge, silentRefresh]);

  // Snooze wakeup: check every 60 s whether any snoozed item has expired and move it back to inbox.
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

      // Refresh thread list if we're viewing the inbox of an affected account
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

    // Drafts open directly in the composer instead of the thread view
    if (selectedFolder === 'drafts') {
      setMessagesLoading(true);
      try {
        const result = await p.getThread(thread.conversation_id, false, true);
        const msg = result[0];
        if (msg) {
          setComposerRestoreData({
            isNewMessage: true,
            recipients: msg.to_recipients.map(r => ({ email: r.email, name: r.name ?? undefined })),
            cc: msg.cc_recipients.map(r => ({ email: r.email, name: r.name ?? undefined })),
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
        th.conversation_id === thread.conversation_id ? { ...th, unread_count: 0 } : th
      ));
      if (thread.unread_count > 0 && !folderAccountedRef.current.has(thread.conversation_id)) {
        folderAccountedRef.current.add(thread.conversation_id);
        setFolderUnreadCounts(prev => ({
          ...prev,
          [selectedFolder]: Math.max(0, (prev[selectedFolder] ?? 0) - thread.unread_count),
        }));
      }
      // Accumulate contacts from message senders/recipients
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
        // Only decrement folder if openThread hasn't already done it for this conversation.
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
  }, [resolveProvider, selectedThread]);

  const moveToTrash = useCallback((itemId: string) => {
    const p = resolveProvider(selectedThread?.accountId);
    if (!p) return;
    const msgToDelete = messages.find(m => m.item_id === itemId);
    if (!msgToDelete) return;

    const remaining = messages.filter(m => m.item_id !== itemId);
    const removedThread = remaining.length === 0 ? selectedThread : null;
    const convId = selectedThread?.conversation_id;

    // Only decrement folder counter if openThread hasn't already done it for this conversation.
    const alreadyAccounted = folderAccountedRef.current.has(selectedThread?.conversation_id ?? '');
    const wasUnread = !msgToDelete.is_read && !alreadyAccounted;

    // Optimistic update
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
    );
  }, [resolveProvider, messages, selectedThread, selectedFolder, scheduleDeletion, t]);

  const handleToggleThreadRead = useCallback(async (thread: MailThread) => {
    const p = resolveProvider(thread.accountId);
    if (!p) return;
    const shouldMarkRead = thread.unread_count > 0;

    // Optimistic update
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

    // Background API call — revert on failure
    try {
      const msgs = await p.getThread(thread.conversation_id, selectedFolder === 'deleteditems');
      const items = msgs.map(m => ({ item_id: m.item_id, change_key: m.change_key }));
      if (shouldMarkRead) {
        await p.markRead(items);
      } else {
        await p.markUnread(items);
      }
    } catch (e) {
      // Revert
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

    // If openThread already decremented folderUnreadCounts for this conversation, don't do it again.
    // Otherwise use the original EWS unread_count from the thread argument.
    const alreadyAccounted = folderAccountedRef.current.has(thread.conversation_id);
    const unreadToDecrement = alreadyAccounted ? 0 : thread.unread_count;

    // Optimistic update
    setThreads(prev => prev.filter(th => th.conversation_id !== thread.conversation_id));
    if (wasSelected) {
      setSelectedThread(null);
      setMessages([]);
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
          // For drafts conversation_id IS the item_id — delete directly, no getThread needed
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
    );
  }, [resolveProvider, selectedThread, messages, selectedFolder, scheduleDeletion, t]);

  const handleSnooze = useCallback(async (snoozeUntil: string) => {
    const p = resolveProvider(selectedThread?.accountId);
    if (!p || messages.length === 0 || !selectedThread) return;
    const lastMsg = messages[messages.length - 1];
    try {
      const folderId = await p.snooze(lastMsg.item_id);
      const key = 'mail-snoozed-items';
      const stored: { itemId: string; accountId: string; snoozeUntil: string; conversationId?: string; providerType?: 'ews' | 'gmail' }[] =
        JSON.parse(localStorage.getItem(key) ?? '[]');
      stored.push({ itemId: lastMsg.item_id, accountId: p.accountId, snoozeUntil, conversationId: selectedThread.conversation_id, providerType: p.providerType });
      localStorage.setItem(key, JSON.stringify(stored));
      setSnoozedMap(prev => ({ ...prev, [selectedThread.conversation_id]: snoozeUntil }));
      setSnoozedByItemId(prev => ({ ...prev, [lastMsg.item_id]: snoozeUntil }));
      setThreads(prev => prev.filter(t => t.conversation_id !== selectedThread.conversation_id));
      (p as CachedMailProvider).evict?.(selectedThread.conversation_id).catch(() => {});
      setSelectedThread(null);
      setMessages([]);
      void folderId;
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
    // Optimistic: remove immediately
    setThreads(prev => prev.filter(t => t.conversation_id !== thread.conversation_id));
    setSelectedThread(null);
    setMessages([]);
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
      // Restore on failure
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
  }, [resolveProvider, messages, selectedThread, selectedFolder]);

  // ── Action toast helper ──────────────────────────────────────────────────────
  const showActionToast = useCallback((label: string) => {
    if (actionToastTimerRef.current) clearTimeout(actionToastTimerRef.current);
    setActionToast({ label });
    actionToastTimerRef.current = setTimeout(() => setActionToast(null), 4000);
  }, []);

  // ── Bulk action handlers ──────────────────────────────────────────────────────
  const handleBulkDelete = useCallback(async () => {
    const toDelete = threads.filter(t => selectedThreadIds.has(t.conversation_id));
    if (toDelete.length === 0) return;

    // Optimistic: remove from list immediately
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
        const stored: { itemId: string; accountId: string; snoozeUntil: string; conversationId?: string; providerType?: 'ews' | 'gmail' }[] =
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

    // Optimistic update
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
      // DOCX, Excel, others → open with system app
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

  const scheduleSend = useCallback(async (
    to: string[],
    cc: string[],
    bcc: string[],
    subject: string,
    bodyHtml: string,
    restoreData: typeof composerRestoreData,
    attachments?: ComposerAttachment[],
    fromAccountId?: string,
  ) => {
    const p = fromAccountId
      ? (allProviders.get(fromAccountId) ?? null)
      : resolveProvider(selectedThread?.accountId);
    if (!p) return;

    // Flush any already-pending send immediately
    if (pendingSendRef.current) {
      clearTimeout(pendingSendRef.current.timerId);
      await pendingSendRef.current.execute().catch(e => setError(String(e)));
    }

    const replyToItemId = restoreData?.replyingToMsg?.item_id ?? null;
    const replyToChangeKey = restoreData?.replyingToMsg?.change_key ?? null;

    const execute = async () => {
      await p.sendMail({ to, cc, bcc, subject, bodyHtml, replyToItemId, replyToChangeKey, attachments });
      if (!restoreData?.isNewMessage && selectedThread) openThread(selectedThread);
    };

    const timerId = setTimeout(async () => {
      pendingSendRef.current = null;
      setSendToast(null);
      setComposerRestoreData(null);
      execute().catch(e => setError(String(e)));
    }, 5_000);

    pendingSendRef.current = { execute, timerId, restoreData: restoreData! };
    setComposerRestoreData(restoreData);
    setSendToast({ label: t('mail.messageSent', 'Message envoyé') });
    setReplyingTo(null);
    setComposing(false);
  }, [allProviders, resolveProvider, selectedThread, openThread, t]);

  const cancelSend = useCallback(() => {
    if (!pendingSendRef.current) return;
    clearTimeout(pendingSendRef.current.timerId);
    const { restoreData } = pendingSendRef.current;
    pendingSendRef.current = null;
    setSendToast(null);
    setComposerRestoreData(restoreData);
    if (restoreData.isNewMessage) {
      setComposing(true);
    } else {
      setReplyingTo(restoreData.replyingToMsg);
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

  // Panel resizing handlers
  const startResizingSidebar = useCallback((e: MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, startWidth + delta));
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

  const startResizingThreadList = useCallback((e: MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = threadListWidth;

    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(THREADLIST_MIN, Math.min(THREADLIST_MAX, startWidth + delta));
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

  return (
    <div className="mail-app">
      <header className="header">
        <button
          className="btn-icon"
          onClick={() => setSidebarCollapsed(v => {
            const next = !v;
            localStorage.setItem('mail-sidebar-collapsed', String(next));
            return next;
          })}
          title={sidebarCollapsed ? t('mail.showSidebar', 'Show sidebar') : t('mail.hideSidebar', 'Hide sidebar')}
        >
          <Menu size={20} />
        </button>
        <span className="header-logo">
          <Mail size={22} strokeWidth={1.5} />
          <span>{t('tabs.mail', 'Mail')}</span>
        </span>

        <div className="header-spacer" />

        <button className="btn-icon" onClick={loadThreads} disabled={threadsLoading}
          title={t('header.refresh', 'Refresh')}>
          <RefreshCw size={18} className={threadsLoading ? 'spin' : ''} />
        </button>
        <button className="btn-icon" onClick={cycleTheme}>
          <ThemeIcon pref={preference} />
        </button>
        <Link to="/config" className="btn-config">
          <Settings size={17} />
          {t('header.calendarsBtn')}
        </Link>
      </header>

      {error && (
        <div className="mail-error-banner">
          {error}
          <button className="btn-icon" onClick={() => setError(null)}><X size={14} /></button>
        </div>
      )}

      {allMailAccounts.length === 0 ? (
        <div className="mail-placeholder">
          <Mail size={64} strokeWidth={1} style={{ opacity: 0.2 }} />
          <p style={{ opacity: 0.5 }}>
            {t('mail.noAccount', 'No mail account configured. Add an Exchange or Google account in Settings.')}
          </p>
          <Link to="/config" className="btn-primary">{t('header.calendarsBtn')}</Link>
        </div>
      ) : (
        <div className="mail-body" ref={mailBodyRef}>
          {allMailAccounts.length > 1 && (
            <nav className="mail-account-tabs">
              {/* All tab */}
              <button
                type="button"
                className={`mail-account-tab${isAllMode ? ' mail-account-tab--active' : ''}`}
                onClick={() => setSelectedAccountId(ALL_ACCOUNTS_ID)}
                title={t('mail.allAccounts', 'All accounts')}
              >
                <span className="mail-account-tab__stripe" style={{ background: 'var(--text-muted)' }} />
                <span className="mail-account-tab__label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Layers size={13} />
                </span>
              </button>
              <div className="mail-account-tab__divider" />
              {allMailAccounts.map(acc => {
                const label = (() => {
                  const atIdx = acc.email.indexOf('@');
                  const domain = atIdx >= 0 ? acc.email.slice(atIdx + 1) : acc.email;
                  return domain.charAt(0).toUpperCase() + domain.slice(1);
                })();
                const isSelected = acc.id === selectedAccountId;
                return (
                  <button
                    key={acc.id}
                    type="button"
                    className={`mail-account-tab${isSelected ? ' mail-account-tab--active' : ''}`}
                    onClick={() => setSelectedAccountId(acc.id)}
                    title={acc.email}
                  >
                    <span
                      className="mail-account-tab__stripe"
                      style={{ background: acc.color ?? 'var(--primary)' }}
                    />
                    <span className="mail-account-tab__label">{label}</span>
                  </button>
                );
              })}
            </nav>
          )}
          {!sidebarCollapsed && (
            <>
              <div style={{ width: sidebarWidth, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <MailSidebar
                  selectedFolder={selectedFolder}
                  onSelectFolder={setSelectedFolder}
                  onCompose={() => {
                    setComposing(true);
                    setSelectedThread(null);
                    // In All mode, default to first account; in single-account mode, use that account
                    setComposingAccountId(isAllMode ? (allMailAccounts[0]?.id ?? '') : selectedAccountId);
                  }}
                  provider={isAllMode ? null : provider}
                  onFoldersLoaded={handleFoldersLoaded}
                  folderUnreadCounts={folderUnreadCounts}
                  overrideDynamicFolders={allModeDynamicFolders ?? undefined}
                />
              </div>
              <div
                className="mail-resize-handle"
                onMouseDown={startResizingSidebar}
                style={{ cursor: 'col-resize' }}
              />
            </>
          )}

          <div style={{ width: threadListWidth, height: '100%', position: 'relative', zIndex: 1 }}>
            <ThreadList
              ref={threadListRef}
              threads={threads}
              loading={threadsLoading}
              loadingMore={threadsLoadingMore}
              selectedId={selectedThread?.conversation_id ?? null}
              snoozedMap={snoozedMap}
              isInSnoozedFolder={isInSnoozedFolder}
              onSelect={thread => {
                if (selectedThreadIds.size > 0) {
                  setSelectedThreadIds(prev => {
                    const next = new Set(prev);
                    if (next.has(thread.conversation_id)) next.delete(thread.conversation_id);
                    else next.add(thread.conversation_id);
                    return next;
                  });
                } else {
                  openThread(thread);
                }
              }}
              onToggleRead={handleToggleThreadRead}
              onDelete={handleDeleteThread}
              selectedThreadIds={selectedThreadIds}
              onToggleSelect={thread => {
                setSelectedThreadIds(prev => {
                  const next = new Set(prev);
                  if (next.has(thread.conversation_id)) next.delete(thread.conversation_id);
                  else next.add(thread.conversation_id);
                  return next;
                });
              }}
              onSelectAll={() => setSelectedThreadIds(new Set(threads.map(t => t.conversation_id)))}
              onClearSelection={() => setSelectedThreadIds(new Set())}
            />
          </div>
          <div
            className="mail-resize-handle"
            onMouseDown={startResizingThreadList}
            style={{ cursor: 'col-resize' }}
          />

          <div className="mail-detail-panel">
            {!composing && selectedThreadIds.size > 0 ? (
              <MultiSelectionPanel
                threads={threads}
                selectedIds={selectedThreadIds}
                onClearSelection={() => setSelectedThreadIds(new Set())}
                onBulkDelete={handleBulkDelete}
                onBulkSnooze={handleBulkSnooze}
                onBulkMove={handleBulkMove}
                onBulkToggleRead={handleBulkToggleRead}
                moveFolders={
                  isAllMode
                    ? (allAccountFolders.get(threads.find(t => selectedThreadIds.has(t.conversation_id))?.accountId ?? '') ?? allFolders)
                    : allFolders
                }
                supportsSnooze={true}
              />
            ) : composing ? (
              <NewMessageComposer
                contacts={contacts}
                restoreData={composerRestoreData?.isNewMessage ? composerRestoreData : null}
                onSend={(to, cc, bcc, subject, body, attachments) =>
                  scheduleSend(to, cc, bcc, subject, body, {
                    isNewMessage: true,
                    recipients: to.map(email => ({ email })),
                    cc: cc.map(email => ({ email })),
                    bcc: bcc.map(email => ({ email })),
                    subject,
                    bodyHtml: body,
                    replyingToMsg: null,
                  }, attachments, composingAccountId || undefined)
                }
                onCancel={() => { setComposing(false); setComposingDraftItemId(null); }}
                onSaveDraft={(to, cc, bcc, subject, bodyHtml) =>
                  handleSaveDraft(composingAccountId || selectedAccountId, to, cc, bcc, subject, bodyHtml)
                }
                onDeleteDraft={composingDraftItemId ? async () => {
                  const p = allProviders.get(composingDraftItemId.accountId);
                  if (p) await p.permanentlyDelete(composingDraftItemId.itemId).catch(() => {});
                  setComposing(false);
                  setComposingDraftItemId(null);
                  loadThreads();
                } : undefined}
                fromAccounts={isAllMode ? allMailAccounts : undefined}
                fromAccountId={composingAccountId}
                onFromAccountChange={setComposingAccountId}
              />
            ) : selectedThread === null ? (
              <div className="mail-detail-empty">
                <Inbox size={48} strokeWidth={1} style={{ opacity: 0.2 }} />
                <p style={{ opacity: 0.4 }}>{t('mail.selectThread', 'Select a conversation')}</p>
              </div>
            ) : messagesLoading ? (
              <div className="mail-detail-empty">
                <RefreshCw size={32} strokeWidth={1.5} className="spin" style={{ opacity: 0.4 }} />
              </div>
            ) : (
              <ThreadDetail
                thread={selectedThread}
                messages={messages}
                replyingTo={replyingTo}
                contacts={contacts}
                currentUserEmail={
                  isAllMode
                    ? allMailAccounts.find(a => a.id === selectedThread.accountId)?.email
                    : allMailAccounts.find(a => a.id === selectedAccountId)?.email
                }
                onMarkRead={markRead}
                onTrash={moveToTrash}
                onPreviewAttachment={previewAttachment}
                onDownloadAttachment={downloadAttachment}
                onReply={msg => { setReplyMode('reply'); setReplyingTo(msg); }}
                onReplyAll={msg => { setReplyMode('replyAll'); setReplyingTo(msg); }}
                onForward={msg => { setReplyMode('forward'); setReplyingTo(msg); }}
                onToggleRead={toggleRead}
                replyMode={replyMode}
                onCancelReply={() => setReplyingTo(null)}
                onSaveDraft={(to, cc, bcc, subject, bodyHtml) =>
                  handleSaveDraft(selectedThread.accountId, to, cc, bcc, subject, bodyHtml)
                }
                onDeleteThread={() => handleDeleteThread(selectedThread)}
                onToggleThreadRead={() => handleToggleThreadRead(selectedThread)}
                onSend={(to, cc, bcc, subject, body, attachments) =>
                  scheduleSend(to, cc, bcc, subject, body, {
                    isNewMessage: false,
                    recipients: to.map(email => ({ email })),
                    cc: cc.map(email => ({ email })),
                    bcc: bcc.map(email => ({ email })),
                    subject,
                    bodyHtml: body,
                    replyingToMsg: replyingTo,
                  }, attachments)
                }
                composerRestoreData={composerRestoreData?.isNewMessage === false ? composerRestoreData : null}
                supportsSnooze={true}
                onSnooze={handleSnooze}
                snoozeUntil={
                  (messages.length > 0 ? snoozedByItemId[messages[messages.length - 1].item_id] : undefined)
                  ?? (isInSnoozedFolder ? Object.values(snoozedByItemId).find(d => new Date(d) > new Date()) : undefined)
                  ?? (isInSnoozedFolder ? snoozedMap[selectedThread.conversation_id] : undefined)
                }
                onUnsnooze={handleUnsnooze}
                moveFolders={
                  isAllMode
                    ? (allAccountFolders.get(selectedThread.accountId ?? '') ?? [])
                    : allFolders
                }
                onMove={handleMove}
              />
            )}
          </div>
        </div>
      )}

      {deleteToast && createPortal(
        <div className="mail-delete-toast">
          <span>{deleteToast.label}</span>
          <button className="mail-delete-toast__undo" onClick={cancelDeletion}>
            {t('mail.undo', 'Annuler')}
          </button>
        </div>,
        document.body
      )}

      {downloadToast && createPortal(
        <div className="mail-download-toast">
          <Download size={13} />
          <span className="mail-download-toast__name">{downloadToast.name}</span>
          <button
            type="button"
            className="mail-download-toast__open"
            onClick={() => invoke('open_file_path', { path: downloadToast.path }).catch(e => setError(String(e)))}
          >
            Ouvrir
          </button>
          <button type="button" className="mail-download-toast__close" onClick={() => setDownloadToast(null)}>
            <X size={13} />
          </button>
        </div>,
        document.body
      )}

      {attachmentPreview && (
        <AttachmentPreviewModal
          attachment={attachmentPreview.attachment}
          loading={attachmentPreview.loading}
          data={attachmentPreview.data}
          onClose={() => setAttachmentPreview(null)}
        />
      )}

      {sendToast && createPortal(
        <div className="mail-delete-toast">
          <span>{sendToast.label}</span>
          <button className="mail-delete-toast__undo" onClick={cancelSend}>
            {t('mail.undo', 'Annuler')}
          </button>
        </div>,
        document.body
      )}

      {draftToast && createPortal(
        <div className="mail-delete-toast mail-draft-toast">
          <span>{draftToast.label}</span>
        </div>,
        document.body
      )}

      {actionToast && createPortal(
        <div className="mail-action-toast">
          <Check size={14} />
          <span>{actionToast.label}</span>
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Thread list ────────────────────────────────────────────────────────────────

interface ThreadListProps {
  readonly threads: MailThread[];
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly selectedId: string | null;
  readonly snoozedMap: Record<string, string>;
  readonly isInSnoozedFolder: boolean;
  readonly onSelect: (t: MailThread) => void;
  readonly onToggleRead: (t: MailThread) => void;
  readonly onDelete: (t: MailThread) => void;
  readonly selectedThreadIds: Set<string>;
  readonly onToggleSelect: (t: MailThread) => void;
  readonly onSelectAll: () => void;
  readonly onClearSelection: () => void;
}

type ThreadFilter = 'all' | 'unread';

const ThreadList = forwardRef<HTMLDivElement, ThreadListProps>(
  ({ threads, loading, loadingMore, selectedId, snoozedMap, isInSnoozedFolder, onSelect, onToggleRead, onDelete, selectedThreadIds, onToggleSelect, onSelectAll, onClearSelection }, ref) => {
    const { t } = useTranslation();
    const [filter, setFilter] = useState<ThreadFilter>('all');
    const [filterOpen, setFilterOpen] = useState(false);
    const checkboxRef = useRef<HTMLInputElement>(null);

    const visibleThreads = filter === 'unread' ? threads.filter(th => th.unread_count > 0) : threads;

    const allSelected = visibleThreads.length > 0 && visibleThreads.every(th => selectedThreadIds.has(th.conversation_id));
    const someSelected = !allSelected && visibleThreads.some(th => selectedThreadIds.has(th.conversation_id));

    useEffect(() => {
      if (checkboxRef.current) {
        checkboxRef.current.indeterminate = someSelected;
      }
    }, [someSelected]);

    const handleToolbarCheckbox = () => {
      if (allSelected || someSelected) {
        onClearSelection();
      } else {
        onSelectAll();
      }
    };

    const toolbar = (
      <div className="mail-thread-toolbar">
        <input
          ref={checkboxRef}
          type="checkbox"
          className="mail-thread-toolbar__checkbox"
          checked={allSelected}
          onChange={handleToolbarCheckbox}
          aria-label={t('mail.selectAll', 'Select all')}
        />
        <div className="mail-actions-dropdown">
          <button
            className="btn-icon--labeled mail-thread-toolbar__filter-btn"
            onClick={() => setFilterOpen(o => !o)}
          >
            {filter === 'unread' ? t('mail.filterUnread', 'Unread') : t('mail.filterAll', 'All mail')}
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ opacity: 0.5 }}>
              <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          {filterOpen && (
            <>
              <div className="mail-thread-toolbar__overlay" onClick={() => setFilterOpen(false)} />
              <div className="mail-actions-menu">
                <button
                  className={`mail-actions-menu__item${filter === 'all' ? ' mail-actions-menu__item--active' : ''}`}
                  onClick={() => { setFilter('all'); setFilterOpen(false); }}
                >
                  {t('mail.filterAll', 'All mail')}
                </button>
                <button
                  className={`mail-actions-menu__item${filter === 'unread' ? ' mail-actions-menu__item--active' : ''}`}
                  onClick={() => { setFilter('unread'); setFilterOpen(false); }}
                >
                  {t('mail.filterUnread', 'Unread')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );

    if (loading && threads.length === 0) {
      return (
        <div className="mail-thread-list mail-thread-list--empty">
          <RefreshCw size={24} className="spin" style={{ opacity: 0.4 }} />
        </div>
      );
    }
    if (!loading && threads.length === 0) {
      return (
        <div className="mail-thread-list" ref={ref} style={{ display: 'flex', flexDirection: 'column' }}>
          {toolbar}
          <div className="mail-thread-list--empty" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p style={{ opacity: 0.4 }}>{t('mail.empty', 'No messages')}</p>
          </div>
        </div>
      );
    }
    return (
      <div className="mail-thread-list" ref={ref}>
        {toolbar}
        {visibleThreads.map(thread => (
          <ThreadItem
            key={thread.conversation_id}
            thread={thread}
            isSelected={thread.conversation_id === selectedId}
            isChecked={selectedThreadIds.has(thread.conversation_id)}
            snoozeUntil={snoozedMap[thread.conversation_id]}
            isInSnoozedFolder={isInSnoozedFolder}
            onSelect={onSelect}
            onToggleRead={onToggleRead}
            onDelete={onDelete}
            onToggleCheck={onToggleSelect}
          />
        ))}
        {loadingMore && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '12px', opacity: 0.5 }}>
            <RefreshCw size={18} className="spin" />
          </div>
        )}
      </div>
    );
  }
);
ThreadList.displayName = 'ThreadList';

interface ThreadItemProps {
  readonly thread: MailThread;
  readonly isSelected: boolean;
  readonly isChecked: boolean;
  readonly snoozeUntil?: string;
  readonly isInSnoozedFolder: boolean;
  readonly onSelect: (t: MailThread) => void;
  readonly onToggleRead: (t: MailThread) => void;
  readonly onDelete: (t: MailThread) => void;
  readonly onToggleCheck: (t: MailThread) => void;
}

function ThreadItem({ thread, isSelected, isChecked, snoozeUntil, isInSnoozedFolder, onSelect, onToggleRead, onDelete, onToggleCheck }: ThreadItemProps) {
  const { t } = useTranslation();
  const isUnread = thread.unread_count > 0;
  const sender = thread.from_name ?? t('mail.unknown', 'Unknown');
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [avatarHovered, setAvatarHovered] = useState(false);

  const showTooltip = (e: ReactMouseEvent<HTMLButtonElement>, text: string) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({ text, x: rect.left + rect.width / 2, y: rect.top });
  };

  const showCheckbox = avatarHovered || isChecked;

  return (
    <div
      role="button"
      tabIndex={0}
      className={`mail-thread-item${isSelected ? ' selected' : ''}${isUnread ? ' unread' : ''}${isChecked ? ' checked' : ''}`}
      onClick={() => onSelect(thread)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onSelect(thread); }}
    >
      {/* Avatar / Checkbox */}
      <div
        className={`mail-thread-item__avatar${showCheckbox ? ' mail-thread-item__avatar--checkbox' : ''}`}
        style={showCheckbox ? {} : { background: avatarColor(sender) }}
        onClick={e => { e.stopPropagation(); onToggleCheck(thread); }}
        onMouseEnter={() => setAvatarHovered(true)}
        onMouseLeave={() => setAvatarHovered(false)}
        role="checkbox"
        aria-checked={isChecked}
        tabIndex={-1}
      >
        {showCheckbox ? (
          <div className={`mail-thread-item__checkbox-box${isChecked ? ' mail-thread-item__checkbox-box--checked' : ''}`}>
            {isChecked && <Check size={14} strokeWidth={3} />}
          </div>
        ) : (
          initials(sender)
        )}
      </div>

      {/* Content */}
      <div className="mail-thread-item__content">
        <div className="mail-thread-item__top">
          <span className="mail-thread-item__from">
            {sender}
            {thread.message_count > 1 && (
              <span className="mail-thread-item__count">{thread.message_count}</span>
            )}
          </span>
          <div className="mail-thread-item__top-right">
            {thread.has_attachments && <Paperclip size={11} className="mail-thread-item__clip" />}
            {(isInSnoozedFolder || snoozeUntil) && (
              <span className="mail-thread-item__snooze-badge" title={snoozeUntil ? new Date(snoozeUntil).toLocaleString('fr-FR') : ''}>
                <AlarmClock size={11} />
                {snoozeUntil && new Date(snoozeUntil).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
              </span>
            )}
            <span className="mail-thread-item__date">
              {formatDate(thread.last_delivery_time)}
            </span>
          </div>
        </div>

        <div className="mail-thread-item__subject">
          {thread.topic || t('mail.noSubject', '(no subject)')}
        </div>

        <div className="mail-thread-item__snippet">
          <span className="mail-thread-item__snippet-text">{decodeHtmlEntities(thread.snippet)}</span>
          {thread.accountLabel && (
            <span
              className="mail-thread-item__account-badge"
              style={{ color: thread.accountColor ?? 'var(--primary)', borderLeftColor: thread.accountColor ?? 'var(--primary)' }}
            >
              {thread.accountLabel}
            </span>
          )}
        </div>
      </div>

      {/* Hover actions */}
      <div className="mail-thread-item__actions" onClick={e => e.stopPropagation()}>
        <button
          className="mail-thread-item__action-btn"
          onClick={e => { e.stopPropagation(); onToggleRead(thread); }}
          onMouseEnter={e => showTooltip(e, isUnread
            ? t('mail.markRead', 'Marquer comme lu')
            : t('mail.markUnread', 'Marquer comme non lu'))}
          onMouseLeave={() => setTooltip(null)}
        >
          {isUnread ? <MailOpen size={14} /> : <Mail size={14} />}
        </button>
        <button
          className="mail-thread-item__action-btn mail-thread-item__action-btn--danger"
          onClick={e => { e.stopPropagation(); onDelete(thread); }}
          onMouseEnter={e => showTooltip(e, t('mail.deleteThread', 'Supprimer'))}
          onMouseLeave={() => setTooltip(null)}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {tooltip && createPortal(
        <div className="mail-action-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          {tooltip.text}
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Thread detail ──────────────────────────────────────────────────────────────

interface ThreadDetailProps {
  readonly thread: MailThread;
  readonly messages: MailMessage[];
  readonly replyingTo: MailMessage | null;
  readonly contacts: { email: string; name?: string }[];
  readonly currentUserEmail?: string;
  readonly onMarkRead: (msgs: MailMessage[]) => void;
  readonly onTrash: (id: string) => void;
  readonly onPreviewAttachment: (att: MailAttachment) => void;
  readonly onDownloadAttachment: (att: MailAttachment) => void;
  readonly onReply: (msg: MailMessage) => void;
  readonly onReplyAll: (msg: MailMessage) => void;
  readonly onForward: (msg: MailMessage) => void;
  readonly onToggleRead: (msg: MailMessage) => void;
  readonly replyMode: 'reply' | 'replyAll' | 'forward';
  readonly onCancelReply: () => void;
  readonly onSaveDraft?: (to: string[], cc: string[], bcc: string[], subject: string, bodyHtml: string) => void;
  readonly onSend: (to: string[], cc: string[], bcc: string[], subject: string, body: string, attachments: ComposerAttachment[]) => Promise<void>;
  readonly composerRestoreData?: ComposerRestoreData | null;
  readonly onDeleteThread: () => void;
  readonly onToggleThreadRead: () => void;
  readonly supportsSnooze: boolean;
  readonly onSnooze: (snoozeUntil: string) => void;
  readonly snoozeUntil?: string;
  readonly onUnsnooze: () => void;
  readonly moveFolders: import('./types').MailFolder[];
  readonly onMove: (folderId: string) => void;
}

const FR_DAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

function computeSnoozeOptions() {
  const now = new Date();

  const laterToday = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  if (laterToday.getMinutes() >= 30) laterToday.setHours(laterToday.getHours() + 1);
  laterToday.setMinutes(0, 0, 0);

  const tomorrowMorning = new Date(now);
  tomorrowMorning.setDate(tomorrowMorning.getDate() + 1);
  tomorrowMorning.setHours(9, 0, 0, 0);

  const tomorrowAfternoon = new Date(now);
  tomorrowAfternoon.setDate(tomorrowAfternoon.getDate() + 1);
  tomorrowAfternoon.setHours(14, 0, 0, 0);

  const nextWeek = new Date(now);
  nextWeek.setDate(nextWeek.getDate() + 7);
  nextWeek.setHours(9, 0, 0, 0);

  return { laterToday, tomorrowMorning, tomorrowAfternoon, nextWeek };
}

function ThreadDetail({
  thread, messages, replyingTo, replyMode, contacts, currentUserEmail,
  onMarkRead, onTrash, onPreviewAttachment, onDownloadAttachment,
  onReply, onReplyAll, onForward, onToggleRead,
  onCancelReply, onSaveDraft, onSend, composerRestoreData,
  onDeleteThread, onToggleThreadRead,
  supportsSnooze, onSnooze, snoozeUntil, onUnsnooze,
  moveFolders, onMove,
}: ThreadDetailProps) {
  const { t } = useTranslation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const composerBlockRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!replyingTo || !composerBlockRef.current || !messagesContainerRef.current) return;
    const container = messagesContainerRef.current;
    const block = composerBlockRef.current;
    container.scrollTop = block.offsetTop - container.offsetTop;
  }, [replyingTo]);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [customDate, setCustomDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10);
  });
  const [customTime, setCustomTime] = useState('09:00');

  // thread.topic can be empty if EWS didn't return it — fall back to any message subject
  const subject = thread.topic
    || messages.find(m => m.subject)?.subject
    || t('mail.noSubject', '(no subject)');

  const isUnread = thread.unread_count > 0;
  const lastMsg = messages[messages.length - 1];

  function handleSnoozeOption(date: Date) {
    onSnooze(date.toISOString());
    setSnoozeOpen(false);
    setShowCustomPicker(false);
  }

  function handleCustomSnooze() {
    if (!customDate || !customTime) return;
    const [year, month, day] = customDate.split('-').map(Number);
    const [hour, minute] = customTime.split(':').map(Number);
    const date = new Date(year, month - 1, day, hour, minute, 0, 0);
    onSnooze(date.toISOString());
    setSnoozeOpen(false);
    setShowCustomPicker(false);
  }

  const { laterToday, tomorrowMorning, tomorrowAfternoon, nextWeek } = computeSnoozeOptions();
  const laterTodayLabel = laterToday.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const nextWeekDayName = FR_DAYS[nextWeek.getDay()];
  const todayMin = new Date().toISOString().slice(0, 10);

  return (
    <div className="mail-thread-detail">
      <div className="mail-thread-detail__toolbar">
        <button className="mail-detail-action-btn" onClick={() => {}} title={t('mail.archive', 'Archive')}>
          <Archive size={15} />
          <span>{t('mail.archive', 'Archive')}</span>
        </button>
        <button className="mail-detail-action-btn mail-detail-action-btn--danger" onClick={onDeleteThread} title={t('mail.delete', 'Delete')}>
          <Trash2 size={15} />
          <span>{t('mail.delete', 'Delete')}</span>
        </button>
        <div className="mail-actions-dropdown">
          <button
            className="mail-detail-action-btn"
            disabled={!supportsSnooze}
            onClick={() => { if (supportsSnooze) setSnoozeOpen(o => !o); }}
            title={t('mail.snooze', 'Snooze')}
          >
            <Clock size={15} />
            <span>{t('mail.snooze', 'Snooze')}</span>
          </button>
          {snoozeOpen && supportsSnooze && (
            <>
              <div role="button" tabIndex={-1} className="mail-thread-toolbar__overlay" onClick={() => { setSnoozeOpen(false); setShowCustomPicker(false); }} onKeyDown={e => { if (e.key === 'Escape') { setSnoozeOpen(false); setShowCustomPicker(false); } }} />
              <div className="mail-actions-menu mail-snooze-menu">
                <button className="mail-actions-menu__item" onClick={() => handleSnoozeOption(laterToday)}>
                  Plus tard aujourd'hui · {laterTodayLabel}
                </button>
                <button className="mail-actions-menu__item" onClick={() => handleSnoozeOption(tomorrowMorning)}>
                  Demain matin · 9:00
                </button>
                <button className="mail-actions-menu__item" onClick={() => handleSnoozeOption(tomorrowAfternoon)}>
                  Demain après-midi · 14:00
                </button>
                <button className="mail-actions-menu__item" onClick={() => handleSnoozeOption(nextWeek)}>
                  La semaine prochaine {nextWeekDayName} · 9:00
                </button>
                <div className="mail-actions-menu__separator" />
                <button className="mail-actions-menu__item" onClick={() => setShowCustomPicker(o => !o)}>
                  Choisir date et heure
                </button>
                {showCustomPicker && (
                  <div className="mail-snooze-custom">
                    <div className="mail-snooze-custom__fields">
                      <input
                        type="date"
                        value={customDate}
                        min={todayMin}
                        onChange={e => setCustomDate(e.target.value)}
                      />
                      <input
                        type="time"
                        value={customTime}
                        onChange={e => setCustomTime(e.target.value)}
                      />
                    </div>
                    <div className="mail-snooze-custom__actions">
                      <button onClick={() => setShowCustomPicker(false)}>Annuler</button>
                      <button className="mail-snooze-custom__ok" onClick={handleCustomSnooze}>OK</button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <div className="mail-actions-dropdown">
          <button
            className="mail-detail-action-btn"
            onClick={() => setMoveOpen(o => !o)}
            title={t('mail.move', 'Move to folder')}
          >
            <FolderInput size={15} />
            <span>{t('mail.move', 'Move')}</span>
          </button>
          {moveOpen && (
            <>
              <div role="button" tabIndex={-1} className="mail-thread-toolbar__overlay" onClick={() => setMoveOpen(false)} onKeyDown={e => { if (e.key === 'Escape') setMoveOpen(false); }} />
              <FolderPickerPopover
                folders={moveFolders}
                currentFolderId={thread.accountId ? undefined : undefined}
                onSelect={folderId => { onMove(folderId); setMoveOpen(false); }}
                onClose={() => setMoveOpen(false)}
              />
            </>
          )}
        </div>
        <div className="mail-actions-dropdown" style={{ marginLeft: 'auto' }}>
          <button
            className="mail-detail-action-btn"
            onClick={() => setMoreOpen(o => !o)}
            title={t('mail.more', 'More')}
          >
            <MoreHorizontal size={15} />
            <span>{t('mail.more', 'More')}</span>
          </button>
          {moreOpen && (
            <>
              <div className="mail-thread-toolbar__overlay" onClick={() => setMoreOpen(false)} />
              <div className="mail-actions-menu" style={{ right: 0, left: 'auto' }}>
                <button className="mail-actions-menu__item" onClick={() => { onToggleThreadRead(); setMoreOpen(false); }}>
                  {isUnread ? t('mail.markRead', 'Mark as read') : t('mail.markUnread', 'Mark as unread')}
                </button>
                <div className="mail-actions-menu__separator" />
                <button className="mail-actions-menu__item" onClick={() => { if (lastMsg) onForward(lastMsg); setMoreOpen(false); }}>
                  <Forward size={13} />
                  {t('mail.forward', 'Forward')}
                </button>
                <div className="mail-actions-menu__separator" />
                <button className="mail-actions-menu__item mail-actions-menu__item--danger" onClick={() => setMoreOpen(false)}>
                  <ShieldAlert size={13} />
                  {t('mail.reportSpam', 'Report spam')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="mail-thread-detail__header">
        <h2 className="mail-thread-detail__subject">{subject}</h2>
        {snoozeUntil && (
          <div className="mail-snooze-banner">
            <AlarmClock size={22} className="mail-snooze-banner__icon" />
            <span className="mail-snooze-banner__text">
              Snoozé jusqu'au{' '}
              <strong>
                {new Date(snoozeUntil).toLocaleString('fr-FR', {
                  weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
                })}
              </strong>
            </span>
            <button className="mail-snooze-banner__btn" onClick={onUnsnooze}>
              <BellOff size={14} />
              Unsnooze
            </button>
          </div>
        )}
      </div>

      <div className="mail-thread-detail__messages" ref={messagesContainerRef}>
        {messages.map((msg, idx) => (
          <MessageBlock
            key={msg.item_id}
            message={msg}
            defaultExpanded={idx === messages.length - 1}
            onMarkRead={onMarkRead}
            onTrash={onTrash}
            onPreviewAttachment={onPreviewAttachment}
            onDownloadAttachment={onDownloadAttachment}
            onReply={onReply}
            onReplyAll={onReplyAll}
            onForward={onForward}
            onToggleRead={onToggleRead}
          />
        ))}
        {replyingTo && (
          <div className="mail-composer-block" ref={composerBlockRef}>
            <MailComposer
              replyTo={replyingTo}
              mode={replyMode}
              contacts={contacts}
              currentUserEmail={currentUserEmail}
              restoreData={composerRestoreData}
              onSend={onSend}
              onCancel={onCancelReply}
              onSaveDraft={onSaveDraft}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Multi-selection panel ─────────────────────────────────────────────────────

interface MultiSelectionPanelProps {
  readonly threads: MailThread[];
  readonly selectedIds: Set<string>;
  readonly onClearSelection: () => void;
  readonly onBulkDelete: () => void;
  readonly onBulkArchive?: () => void;
  readonly onBulkSnooze: (until: string) => void;
  readonly onBulkMove: (folderId: string) => void;
  readonly onBulkToggleRead: (markAsRead: boolean) => void;
  readonly moveFolders: import('./types').MailFolder[];
  readonly supportsSnooze: boolean;
}

function MultiSelectionPanel({
  threads, selectedIds, onClearSelection,
  onBulkDelete, onBulkSnooze, onBulkMove, onBulkToggleRead,
  moveFolders, supportsSnooze,
}: MultiSelectionPanelProps) {
  const { t } = useTranslation();
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [customDate, setCustomDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10);
  });
  const [customTime, setCustomTime] = useState('09:00');

  const selectedThreads = threads.filter(t => selectedIds.has(t.conversation_id));
  const count = selectedIds.size;
  const allUnread = selectedThreads.every(t => t.unread_count > 0);
  const { laterToday, tomorrowMorning, tomorrowAfternoon, nextWeek } = computeSnoozeOptions();
  const laterTodayLabel = laterToday.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const nextWeekDayName = FR_DAYS[nextWeek.getDay()];
  const todayMin = new Date().toISOString().slice(0, 10);

  function handleSnoozeOption(date: Date) {
    onBulkSnooze(date.toISOString());
    setSnoozeOpen(false);
    setShowCustomPicker(false);
  }

  function handleCustomSnooze() {
    if (!customDate || !customTime) return;
    const [year, month, day] = customDate.split('-').map(Number);
    const [hour, minute] = customTime.split(':').map(Number);
    const date = new Date(year, month - 1, day, hour, minute, 0, 0);
    onBulkSnooze(date.toISOString());
    setSnoozeOpen(false);
    setShowCustomPicker(false);
  }

  return (
    <div className="mail-thread-detail">
      {/* Toolbar — same layout as single-thread toolbar */}
      <div className="mail-thread-detail__toolbar">
        <button className="mail-detail-action-btn" onClick={() => {}} title={t('mail.archive', 'Archive')}>
          <Archive size={15} />
          <span>{t('mail.archive', 'Archive')}</span>
        </button>
        <button
          className="mail-detail-action-btn mail-detail-action-btn--danger"
          onClick={onBulkDelete}
          title={t('mail.delete', 'Delete')}
        >
          <Trash2 size={15} />
          <span>{t('mail.delete', 'Delete')}</span>
        </button>

        {/* Snooze */}
        <div className="mail-actions-dropdown">
          <button
            className="mail-detail-action-btn"
            disabled={!supportsSnooze}
            onClick={() => { if (supportsSnooze) setSnoozeOpen(o => !o); }}
            title={t('mail.snooze', 'Snooze')}
          >
            <Clock size={15} />
            <span>{t('mail.snooze', 'Snooze')}</span>
          </button>
          {snoozeOpen && supportsSnooze && (
            <>
              <div role="button" tabIndex={-1} className="mail-thread-toolbar__overlay"
                onClick={() => { setSnoozeOpen(false); setShowCustomPicker(false); }}
                onKeyDown={e => { if (e.key === 'Escape') { setSnoozeOpen(false); setShowCustomPicker(false); } }} />
              <div className="mail-actions-menu mail-snooze-menu">
                <button className="mail-actions-menu__item" onClick={() => handleSnoozeOption(laterToday)}>
                  Plus tard aujourd'hui · {laterTodayLabel}
                </button>
                <button className="mail-actions-menu__item" onClick={() => handleSnoozeOption(tomorrowMorning)}>
                  Demain matin · 9:00
                </button>
                <button className="mail-actions-menu__item" onClick={() => handleSnoozeOption(tomorrowAfternoon)}>
                  Demain après-midi · 14:00
                </button>
                <button className="mail-actions-menu__item" onClick={() => handleSnoozeOption(nextWeek)}>
                  La semaine prochaine {nextWeekDayName} · 9:00
                </button>
                <div className="mail-actions-menu__separator" />
                <button className="mail-actions-menu__item" onClick={() => setShowCustomPicker(o => !o)}>
                  Choisir date et heure
                </button>
                {showCustomPicker && (
                  <div className="mail-snooze-custom">
                    <div className="mail-snooze-custom__fields">
                      <input type="date" value={customDate} min={todayMin} onChange={e => setCustomDate(e.target.value)} />
                      <input type="time" value={customTime} onChange={e => setCustomTime(e.target.value)} />
                    </div>
                    <div className="mail-snooze-custom__actions">
                      <button onClick={() => setShowCustomPicker(false)}>Annuler</button>
                      <button className="mail-snooze-custom__ok" onClick={handleCustomSnooze}>OK</button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Move */}
        <div className="mail-actions-dropdown">
          <button
            className="mail-detail-action-btn"
            onClick={() => setMoveOpen(o => !o)}
            title={t('mail.move', 'Move to folder')}
          >
            <FolderInput size={15} />
            <span>{t('mail.move', 'Move')}</span>
          </button>
          {moveOpen && (
            <>
              <div role="button" tabIndex={-1} className="mail-thread-toolbar__overlay"
                onClick={() => setMoveOpen(false)}
                onKeyDown={e => { if (e.key === 'Escape') setMoveOpen(false); }} />
              <FolderPickerPopover
                folders={moveFolders}
                onSelect={folderId => { onBulkMove(folderId); setMoveOpen(false); }}
                onClose={() => setMoveOpen(false)}
              />
            </>
          )}
        </div>

        {/* More */}
        <div className="mail-actions-dropdown" style={{ marginLeft: 'auto' }}>
          <button
            className="mail-detail-action-btn"
            onClick={() => setMoreOpen(o => !o)}
            title={t('mail.more', 'More')}
          >
            <MoreHorizontal size={15} />
            <span>{t('mail.more', 'More')}</span>
          </button>
          {moreOpen && (
            <>
              <div className="mail-thread-toolbar__overlay" onClick={() => setMoreOpen(false)} />
              <div className="mail-actions-menu" style={{ right: 0, left: 'auto' }}>
                <button className="mail-actions-menu__item" onClick={() => { onBulkToggleRead(allUnread); setMoreOpen(false); }}>
                  {allUnread ? t('mail.markRead', 'Mark as read') : t('mail.markUnread', 'Mark as unread')}
                </button>
                <div className="mail-actions-menu__separator" />
                <button className="mail-actions-menu__item mail-actions-menu__item--danger" onClick={() => setMoreOpen(false)}>
                  <ShieldAlert size={13} />
                  {t('mail.reportSpam', 'Report spam')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Selection header */}
      <div className="mail-multiselect-header">
        <div className="mail-multiselect-header__count">
          <div className="mail-multiselect-header__count-badge">{count}</div>
          <span>
            conversation{count > 1 ? 's' : ''} sélectionnée{count > 1 ? 's' : ''}
          </span>
        </div>
        <button
          className="mail-multiselect-header__clear btn-icon"
          onClick={onClearSelection}
          title="Effacer la sélection"
        >
          <X size={16} />
        </button>
      </div>

      {/* Thread cards */}
      <div className="mail-multiselect-list">
        {selectedThreads.map(thread => {
          const sender = thread.from_name ?? t('mail.unknown', 'Unknown');
          return (
            <div key={thread.conversation_id} className={`mail-multiselect-card${thread.unread_count > 0 ? ' unread' : ''}`}>
              <div className="mail-multiselect-card__avatar" style={{ background: avatarColor(sender) }}>
                {initials(sender)}
              </div>
              <div className="mail-multiselect-card__body">
                <div className="mail-multiselect-card__top">
                  <span className="mail-multiselect-card__from">
                    {sender}
                    {thread.message_count > 1 && (
                      <span className="mail-multiselect-card__count">{thread.message_count}</span>
                    )}
                  </span>
                  <div className="mail-multiselect-card__meta">
                    {thread.has_attachments && <Paperclip size={11} style={{ opacity: 0.5 }} />}
                    <span className="mail-multiselect-card__date">{formatDate(thread.last_delivery_time)}</span>
                  </div>
                </div>
                <div className="mail-multiselect-card__subject">
                  {thread.topic || t('mail.noSubject', '(no subject)')}
                </div>
                <div className="mail-multiselect-card__snippet">
                  {decodeHtmlEntities(thread.snippet)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Message block ──────────────────────────────────────────────────────────────

interface MessageBlockProps {
  readonly message: MailMessage;
  readonly defaultExpanded: boolean;
  readonly onMarkRead: (msgs: MailMessage[]) => void;
  readonly onTrash: (id: string) => void;
  readonly onPreviewAttachment: (att: MailAttachment) => void;
  readonly onDownloadAttachment: (att: MailAttachment) => void;
  readonly onReply: (msg: MailMessage) => void;
  readonly onReplyAll: (msg: MailMessage) => void;
  readonly onForward: (msg: MailMessage) => void;
  readonly onToggleRead: (msg: MailMessage) => void;
}

function MessageBlock({
  message, defaultExpanded,
  onMarkRead, onTrash, onPreviewAttachment, onDownloadAttachment,
  onReply, onReplyAll, onForward, onToggleRead,
}: MessageBlockProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const markedRef = useRef(false);

  useEffect(() => {
    if (message.is_read || markedRef.current || !expanded) return;
    markedRef.current = true;
    onMarkRead([message]);
  }, [expanded, message, onMarkRead]);

  return (
    <div
      className={`mail-message-block${expanded ? ' expanded' : ''}${message.is_read ? '' : ' unread'}`}>

      <MessageBlockHeader
        message={message}
        expanded={expanded}
        onToggleExpand={() => setExpanded(v => !v)}
        onReply={onReply}
        onReplyAll={onReplyAll}
        onForward={onForward}
        onTrash={onTrash}
        onToggleRead={onToggleRead}
      />

      {expanded && (
        <div className="mail-message-block__body">
          {message.attachments.length > 0 && (
            <AttachmentList
              attachments={message.attachments}
              onPreview={onPreviewAttachment}
              onDownload={onDownloadAttachment}
            />
          )}
          <EmailHtmlBody html={message.body_html} />
        </div>
      )}
    </div>
  );
}

// ── Email HTML viewer (sandboxed iframe) ───────────────────────────────────────

// Parse a hex CSS color (#rrggbb) into [r, g, b] (0-255).
// Returns null for unrecognised formats.
function parseHexColor(raw: string): [number, number, number] | null {
  const m = raw.trim().match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

function EmailHtmlBody({ html }: { readonly html: string }) {
  const { t } = useTranslation();
  const { resolved } = useTheme();
  const isDark = resolved === 'dark';
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeHeight, setIframeHeight] = useState(200);

  // Read --bg from the host document so the iframe matches the current theme.
  // CSS custom properties are not inherited by iframes, so we pass the value explicitly.
  const bgRaw = getComputedStyle(document.documentElement).getPropertyValue('--bg');
  const bgParsed = parseHexColor(bgRaw) ?? [28, 30, 32]; // fallback: dark default
  const [bgR, bgG, bgB] = bgParsed;
  const bgCss = `rgb(${bgR}, ${bgG}, ${bgB})`;

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.data?.type === 'open-url' && typeof e.data.url === 'string') {
        invoke('open_url', { url: e.data.url }).catch(console.error);
      }
      if (e.data?.type === 'resize' && typeof e.data.height === 'number') {
        setIframeHeight(e.data.height + 4);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // feColorMatrix: f(x) = -x + k maps white → bg color and black → white.
  // f is self-inverse, so images get the filter twice and return to original colors.
  // k = (255 + channel) / 255
  const kr = ((255 + bgR) / 255).toFixed(4);
  const kg = ((255 + bgG) / 255).toFixed(4);
  const kb = ((255 + bgB) / 255).toFixed(4);
  const darkModeSvg = isDark
    ? `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">
        <filter id="dm" color-interpolation-filters="sRGB">
          <feColorMatrix type="matrix"
            values="-1 0 0 0 ${kr}  0 -1 0 0 ${kg}  0 0 -1 0 ${kb}  0 0 0 1 0"/>
        </filter>
       </svg>`
    : '';
  const darkModeStyle = isDark ? `
  html, body { background: ${bgCss}; }
  .ew { filter: url(#dm); }
  .ew img, .ew video, .ew canvas, .ew iframe, .ew svg, .ew .qt-toggle { filter: url(#dm); }` : '';

  const prevMsgLabel = t('mail.previousMessage', 'Previous message');

  // Strip CID inline-image references — they can't be resolved in the sandbox and
  // produce console errors. Replace with an empty src so the <img> tag is kept
  // (preserving layout) but no network request is made.
  const safeHtml = html.replace(/\bsrc=["']cid:[^"']*["']/gi, 'src=""');

  const srcdoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; overflow: hidden; }
  .ew {
    padding: 4px 0;
    font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
    font-size: 14px; line-height: 1.6;
    color: #202124; background: #fff;
    word-break: break-word; overflow-wrap: anywhere;
  }
  img { max-width: 100%; height: auto; }
  a { color: #1a73e8; cursor: pointer; }
  pre, code { white-space: pre-wrap; word-break: break-all; font-size: 13px; }
  table { max-width: 100%; }
  blockquote {
    border-left: 3px solid #dadce0;
    margin: 8px 0; padding-left: 12px; color: #70757a;
  }
  .qt { margin-top: 12px; border-radius: 4px; overflow: hidden; }
  .qt-toggle {
    display: flex; align-items: center; gap: 6px;
    background: none; border: none;
    padding: 5px 10px; width: 100%;
    text-align: left; cursor: pointer;
    font-size: 12px; font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
  }
  .qt-toggle:hover { opacity: 0.75; }
  .qt-chevron { font-size: 10px; }
  .qt-inner { padding: 0 12px 10px; }${darkModeStyle}
</style>
</head>
<body>${darkModeSvg}<div class="ew">${safeHtml}</div>
<script>
  document.addEventListener('click', function(e) {
    var a = e.target.closest('a');
    if (a && a.href && !a.href.startsWith('javascript:')) {
      e.preventDefault();
      window.parent.postMessage({ type: 'open-url', url: a.href }, '*');
    }
  });
  (function() {
    var COLORS = ['hsl(210,70%,55%)', 'hsl(145,55%,45%)', 'hsl(35,80%,50%)', 'hsl(300,45%,55%)'];
    var BG_RGBS = [[100,160,220], [60,180,100], [220,150,50], [180,80,200]];
    function isQuote(el) {
      if (!el || el.nodeType !== 1) return false;
      var cls = typeof el.className === 'string' ? el.className : '';
      return el.tagName === 'BLOCKQUOTE' || cls.indexOf('mail-quoted') >= 0;
    }
    function wrap(el, depth) {
      var d = depth % 4;
      var color = COLORS[d];
      var rgb = BG_RGBS[d];
      var w = document.createElement('div');
      w.className = 'qt';
      w.style.borderLeft = '3px solid ' + color;
      w.style.background = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0.06)';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'qt-toggle';
      btn.style.color = color;
      var chev = document.createElement('span');
      chev.className = 'qt-chevron';
      chev.textContent = '▶';
      var lbl = document.createElement('span');
      lbl.textContent = ${JSON.stringify(prevMsgLabel)};
      btn.appendChild(chev);
      btn.appendChild(lbl);
      var inner = document.createElement('div');
      inner.className = 'qt-inner';
      inner.style.display = 'none';
      while (el.firstChild) inner.appendChild(el.firstChild);
      w.appendChild(btn);
      w.appendChild(inner);
      if (el.parentNode) el.parentNode.replaceChild(w, el);
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var open = inner.style.display !== 'none';
        inner.style.display = open ? 'none' : '';
        chev.textContent = open ? '▶' : '▼';
        window.parent.postMessage({ type: 'resize', height: document.body.scrollHeight }, '*');
      });
      processEl(inner, depth + 1);
    }
    function processEl(node, depth) {
      Array.from(node.children).forEach(function(child) {
        if (isQuote(child)) wrap(child, depth);
        else processEl(child, depth);
      });
    }
    processEl(document.querySelector('.ew') || document.body, 0);
  })();
  var ro = new ResizeObserver(function() {
    window.parent.postMessage({ type: 'resize', height: document.body.scrollHeight }, '*');
  });
  ro.observe(document.body);
  window.parent.postMessage({ type: 'resize', height: document.body.scrollHeight }, '*');
</script>
</body>
</html>`;

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcdoc}
      sandbox="allow-scripts"
      className="mail-email-iframe"
      title="email-body"
      style={{ height: iframeHeight }}
    />
  );
}

// ── Attachment list ────────────────────────────────────────────────────────────

interface AttachmentListProps {
  readonly attachments: MailAttachment[];
  readonly onPreview: (att: MailAttachment) => void;
  readonly onDownload: (att: MailAttachment) => void;
}

function AttachmentList({ attachments, onPreview, onDownload }: AttachmentListProps) {
  return (
    <div className="mail-attachments">
      {attachments.map(att => (
        <div key={att.attachment_id} className="mail-view-att-card" title={att.name}>
          <div className="mail-view-att-card__icon">
            <FileTypeIcon name={att.name} size={20} />
          </div>
          <div className="mail-view-att-card__info">
            <span className="mail-view-att-card__name">{att.name}</span>
            <span className="mail-view-att-card__size">{formatSize(att.size)}</span>
          </div>
          <div className="mail-view-att-card__actions">
            <button type="button" className="mail-view-att-card__btn" onClick={() => onPreview(att)} title="Aperçu">
              <Eye size={14} />
            </button>
            <button type="button" className="mail-view-att-card__btn" onClick={() => onDownload(att)} title="Télécharger">
              <Download size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Attachment preview modal ───────────────────────────────────────────────────

interface AttachmentPreviewModalProps {
  readonly attachment: MailAttachment;
  readonly loading: boolean;
  readonly data: string | null;
  readonly onClose: () => void;
}

function AttachmentPreviewModal({ attachment, loading, data, onClose }: AttachmentPreviewModalProps) {
  const isImage = attachment.content_type.startsWith('image/');
  const isPdf = attachment.content_type.includes('pdf');
  const dataUrl = data ? `data:${attachment.content_type};base64,${data}` : null;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return createPortal(
    <div className="mail-preview-overlay" onClick={onClose}>
      <div className="mail-preview-modal" onClick={e => e.stopPropagation()}>
        <div className="mail-preview-modal__header">
          <FileTypeIcon name={attachment.name} size={16} />
          <span className="mail-preview-modal__title">{attachment.name}</span>
          <button type="button" className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mail-preview-modal__body">
          {loading && (
            <div className="mail-preview-modal__loading">
              <RefreshCw size={32} className="spin" style={{ opacity: 0.4 }} />
            </div>
          )}
          {!loading && dataUrl && isImage && (
            <img src={dataUrl} alt={attachment.name} className="mail-preview-modal__img" />
          )}
          {!loading && dataUrl && isPdf && (
            <iframe src={dataUrl} title={attachment.name} className="mail-preview-modal__iframe" />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Composer attachment helpers ────────────────────────────────────────────────

function readFilesAsBase64(files: FileList): Promise<ComposerAttachment[]> {
  return Promise.all(
    Array.from(files).map(
      file =>
        new Promise<ComposerAttachment>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            // Strip "data:<type>;base64," prefix
            const base64 = dataUrl.split(',')[1] ?? '';
            resolve({ name: file.name, contentType: file.type || 'application/octet-stream', size: file.size, data: base64 });
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        })
    )
  );
}


interface ComposerAttachmentPanelProps {
  readonly attachments: ComposerAttachment[];
  readonly onRemove: (index: number) => void;
}

function ComposerAttachmentPanel({ attachments, onRemove }: ComposerAttachmentPanelProps) {
  if (attachments.length === 0) return null;
  return (
    <div className="mail-composer-attachments">
      {attachments.map((att, i) => (
        <div key={i} className="mail-composer-att-card">
          <button
            type="button"
            className="mail-composer-att-card__remove"
            onClick={() => onRemove(i)}
            title="Supprimer"
          >
            <X size={12} />
          </button>
          <div className="mail-composer-att-card__icon">
            <FileTypeIcon name={att.name} size={28} />
          </div>
          <span className="mail-composer-att-card__name" title={att.name}>{att.name}</span>
          <span className="mail-composer-att-card__size">{formatSize(att.size)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Formatting toolbar ─────────────────────────────────────────────────────────

const FONT_FAMILIES = [
  { label: 'Défaut', value: 'system-ui, sans-serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times', value: 'Times New Roman, serif' },
  { label: 'Mono', value: 'Courier New, monospace' },
];

const FONT_SIZES = ['10', '12', '14', '16', '18', '20', '24', '28', '36'];

function FormattingToolbar({ bodyRef }: { readonly bodyRef: RefObject<HTMLDivElement> }) {
  const savedRangeRef = useRef<Range | null>(null);
  const [textColor, setTextColor] = useState('#000000');
  const [bgColor, setBgColor] = useState('#ffff00');

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  };

  const restoreSelection = () => {
    const sel = window.getSelection();
    if (sel && savedRangeRef.current) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }
  };

  // For buttons: preventDefault prevents focus steal, selection stays in body
  const fmt = (cmd: string, value?: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.execCommand(cmd, false, value ?? undefined);
  };

  const handleFontFamily = (e: React.ChangeEvent<HTMLSelectElement>) => {
    restoreSelection();
    document.execCommand('fontName', false, e.target.value);
    bodyRef.current?.focus();
  };

  const handleFontSize = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const px = e.target.value;
    if (!bodyRef.current) return;
    restoreSelection();
    // Tag pre-existing font[size="7"] to avoid touching them
    const preExisting = bodyRef.current.querySelectorAll('font[size="7"]');
    preExisting.forEach(el => el.setAttribute('data-pre', '1'));
    document.execCommand('fontSize', false, '7');
    const newFonts = bodyRef.current.querySelectorAll('font[size="7"]:not([data-pre])');
    newFonts.forEach(el => {
      (el as HTMLElement).style.fontSize = `${px}px`;
      el.removeAttribute('size');
    });
    preExisting.forEach(el => el.removeAttribute('data-pre'));
    bodyRef.current.focus();
  };

  const handleTextColor = (e: React.ChangeEvent<HTMLInputElement>) => {
    const color = e.target.value;
    setTextColor(color);
    restoreSelection();
    document.execCommand('foreColor', false, color);
    bodyRef.current?.focus();
  };

  const handleBgColor = (e: React.ChangeEvent<HTMLInputElement>) => {
    const color = e.target.value;
    setBgColor(color);
    restoreSelection();
    document.execCommand('hiliteColor', false, color);
    bodyRef.current?.focus();
  };

  const insertImageFromClipboard = async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find(t => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const reader = new FileReader();
          reader.onload = () => {
            restoreSelection();
            document.execCommand('insertImage', false, reader.result as string);
            bodyRef.current?.focus();
          };
          reader.readAsDataURL(blob);
          return;
        }
      }
    } catch {
      bodyRef.current?.focus();
    }
  };

  return (
    <div className="mail-format-toolbar">
      <button type="button" className="mail-format-btn" onMouseDown={fmt('bold')} title="Gras">
        <Bold size={13} />
      </button>
      <button type="button" className="mail-format-btn" onMouseDown={fmt('italic')} title="Italique">
        <Italic size={13} />
      </button>
      <button type="button" className="mail-format-btn" onMouseDown={fmt('underline')} title="Souligné">
        <Underline size={13} />
      </button>
      <div className="mail-format-sep" />
      <button type="button" className="mail-format-btn" onMouseDown={fmt('insertUnorderedList')} title="Puces">
        <List size={13} />
      </button>
      <button type="button" className="mail-format-btn" onMouseDown={fmt('insertOrderedList')} title="Puces numérotées">
        <ListOrdered size={13} />
      </button>
      <div className="mail-format-sep" />
      <select
        className="mail-format-select"
        defaultValue=""
        onMouseDown={saveSelection}
        onChange={handleFontFamily}
        title="Police"
      >
        <option value="" disabled>Police</option>
        {FONT_FAMILIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
      </select>
      <select
        className="mail-format-select mail-format-select--size"
        defaultValue=""
        onMouseDown={saveSelection}
        onChange={handleFontSize}
        title="Taille"
      >
        <option value="" disabled>Taille</option>
        {FONT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <div className="mail-format-sep" />
      <label className="mail-format-btn mail-format-color-label" title="Couleur du texte">
        <Type size={12} />
        <span className="mail-format-color-swatch" style={{ background: textColor }} />
        <input
          type="color"
          className="mail-format-color-input"
          value={textColor}
          onMouseDown={saveSelection}
          onChange={handleTextColor}
        />
      </label>
      <label className="mail-format-btn mail-format-color-label" title="Couleur du fond">
        <Highlighter size={12} />
        <span className="mail-format-color-swatch" style={{ background: bgColor }} />
        <input
          type="color"
          className="mail-format-color-input"
          value={bgColor}
          onMouseDown={saveSelection}
          onChange={handleBgColor}
        />
      </label>
      <div className="mail-format-sep" />
      <button
        type="button"
        className="mail-format-btn"
        onMouseDown={saveSelection}
        onClick={insertImageFromClipboard}
        title="Coller une image depuis le presse-papier"
      >
        <ImagePlus size={13} />
      </button>
    </div>
  );
}

// Helper: intercept image paste in contentEditable body
function handleImagePaste(e: React.ClipboardEvent<HTMLDivElement>) {
  const imageItem = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'));
  if (!imageItem) return;
  e.preventDefault();
  const file = imageItem.getAsFile();
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    document.execCommand('insertImage', false, reader.result as string);
  };
  reader.readAsDataURL(file);
}

// ── Composer ───────────────────────────────────────────────────────────────────

interface MailComposerProps {
  readonly replyTo: MailMessage;
  readonly mode: 'reply' | 'replyAll' | 'forward';
  readonly contacts: { email: string; name?: string }[];
  readonly currentUserEmail?: string;
  readonly restoreData?: ComposerRestoreData | null;
  readonly onSend: (to: string[], cc: string[], bcc: string[], subject: string, body: string, attachments: ComposerAttachment[]) => Promise<void>;
  readonly onCancel: () => void;
  readonly onSaveDraft?: (to: string[], cc: string[], bcc: string[], subject: string, bodyHtml: string) => void;
}

function MailComposer({ replyTo, mode, contacts, currentUserEmail, restoreData, onSend, onCancel, onSaveDraft }: MailComposerProps) {
  const { t } = useTranslation();
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const isForward = mode === 'forward';

  const initialRecipient: RecipientEntry = {
    email: replyTo.from_email ?? '',
    name: replyTo.from_name ?? undefined,
  };
  const userEmailLower = currentUserEmail?.toLowerCase() ?? '';
  const initialReplyAllTo: RecipientEntry[] = [
    initialRecipient,
    ...replyTo.to_recipients.map(r => ({ email: r.email, name: r.name ?? undefined })),
  ].filter(r => r.email.toLowerCase() !== userEmailLower);
  const initialReplyAllCc: RecipientEntry[] = replyTo.cc_recipients
    .map(r => ({ email: r.email, name: r.name ?? undefined }))
    .filter(r => r.email.toLowerCase() !== userEmailLower);
  const [recipients, setRecipients] = useState<RecipientEntry[]>(
    restoreData?.recipients ?? (isForward ? [] : mode === 'replyAll' ? initialReplyAllTo : [initialRecipient])
  );
  const [ccRecipients, setCcRecipients] = useState<RecipientEntry[]>(
    restoreData?.cc ?? (mode === 'replyAll' ? initialReplyAllCc : [])
  );
  const [bccRecipients, setBccRecipients] = useState<RecipientEntry[]>(restoreData?.bcc ?? []);
  const [showCc, setShowCc] = useState(mode === 'replyAll' || (restoreData?.cc?.length ?? 0) > 0);
  const [showBcc, setShowBcc] = useState((restoreData?.bcc?.length ?? 0) > 0);

  const baseSubject = replyTo.subject.replace(/^(Re|Fwd):\s*/i, '');
  const [subject, setSubject] = useState(
    restoreData?.subject ?? (isForward ? `Fwd: ${baseSubject}` : `Re: ${baseSubject}`)
  );

  useEffect(() => {
    if (!bodyRef.current) return;
    if (restoreData?.bodyHtml) {
      bodyRef.current.innerHTML = restoreData.bodyHtml;
      return;
    }
    // Build quoted original message
    const sep    = t('mail.originalMessage', '----- Message d\'origine -----');
    const fLabel = t('mail.from', 'From');
    const tLabel = t('mail.to', 'To');
    const dLabel = t('mail.date', 'Date');
    const sLabel = t('mail.subject', 'Subject');
    const from = replyTo.from_name
      ? `${replyTo.from_name} &lt;${replyTo.from_email}&gt;`
      : (replyTo.from_email ?? '');
    const to = replyTo.to_recipients
      .map(r => (r.name ? `${r.name} &lt;${r.email}&gt;` : r.email))
      .join(', ');
    const date = formatFullDate(replyTo.date_time_received);
    const quoted =
      `<br><br><div class="mail-quoted mail-quoted--level-1">` +
      `<div class="mail-quoted__separator">${sep}</div>` +
      `<div class="mail-quoted__headers">` +
      `<div><span class="mail-quoted__hdr-key">${fLabel} :</span> ${from}</div>` +
      `<div><span class="mail-quoted__hdr-key">${tLabel} :</span> ${to}</div>` +
      `<div><span class="mail-quoted__hdr-key">${dLabel} :</span> ${date}</div>` +
      `<div><span class="mail-quoted__hdr-key">${sLabel} :</span> ${replyTo.subject}</div>` +
      `</div><div class="mail-quoted__body">${replyTo.body_html}</div></div>`;
    bodyRef.current.innerHTML = quoted;
    // Place cursor at the top (before the quoted block)
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.setStart(bodyRef.current, 0);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAttachFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    const newAtts = await readFilesAsBase64(e.target.files);
    setAttachments(prev => [...prev, ...newAtts]);
    e.target.value = '';
  };

  const handleTransferRecipient = (entry: RecipientEntry, fromField: string, toField: string) => {
    const remove = (set: RecipientEntry[], setter: React.Dispatch<React.SetStateAction<RecipientEntry[]>>) =>
      setter(set.filter(r => r.email.toLowerCase() !== entry.email.toLowerCase()));
    const add = (set: RecipientEntry[], setter: React.Dispatch<React.SetStateAction<RecipientEntry[]>>) => {
      if (!set.some(r => r.email.toLowerCase() === entry.email.toLowerCase()))
        setter([...set, entry]);
    };
    if (fromField === 'to') remove(recipients, setRecipients);
    if (fromField === 'cc') remove(ccRecipients, setCcRecipients);
    if (fromField === 'bcc') remove(bccRecipients, setBccRecipients);
    if (toField === 'to') add(recipients, setRecipients);
    if (toField === 'cc') { setShowCc(true); add(ccRecipients, setCcRecipients); }
    if (toField === 'bcc') { setShowBcc(true); add(bccRecipients, setBccRecipients); }
  };

  const doSend = async () => {
    if (recipients.length === 0) return;
    const bodyHtml = bodyRef.current?.innerHTML ?? '';
    setSending(true);
    try { await onSend(recipients.map(r => r.email), ccRecipients.map(r => r.email), bccRecipients.map(r => r.email), subject, bodyHtml, attachments); }
    finally { setSending(false); }
  };
  const handleSubmit = async (e: FormEvent) => { e.preventDefault(); doSend(); };

  const handleClose = () => {
    if (onSaveDraft) {
      const bodyHtml = bodyRef.current?.innerHTML ?? '';
      if (bodyHtml.trim().length > 0) {
        onSaveDraft(
          recipients.map(r => r.email),
          ccRecipients.map(r => r.email),
          bccRecipients.map(r => r.email),
          subject,
          bodyHtml,
        );
      }
    }
    onCancel();
  };

  const modeLabel = isForward
    ? t('mail.forward', 'Forward')
    : mode === 'replyAll'
      ? t('mail.replyAll', 'Reply to all')
      : t('mail.reply', 'Reply');

  return (
    <div className="mail-reply-composer">
      <div className="mail-reply-composer__label">{modeLabel}</div>
      <form className="mail-reply-composer__form" onSubmit={handleSubmit}
        onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) { e.preventDefault(); doSend(); } }}>
        <div className="mail-reply-composer__toolbar">
          <button type="submit" className="btn-primary" disabled={sending || recipients.length === 0}>
            <Send size={15} />
            {sending ? t('mail.sending', 'Sending…') : t('mail.send', 'Send')}
          </button>
          <button type="button" className="btn-secondary" onClick={() => fileInputRef.current?.click()}>
            <Paperclip size={15} />
            {t('mail.attach', 'Joindre')}
          </button>
          <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleAttachFiles} />
          <div style={{ flex: 1 }} />
          <CloseComposerPopover onSaveDraft={handleClose} onDiscard={onCancel} />
        </div>
        <div className="mail-composer__field">
          <span className="mail-composer__label">{t('mail.to', 'To')}:</span>
          <RecipientInput
            value={recipients}
            onChange={setRecipients}
            contacts={contacts}
            autoFocus
            fieldId="to"
            onDropFromOtherField={(entry, from) => handleTransferRecipient(entry, from, 'to')}
          />
          {!showCc && (
            <button type="button" className="mail-composer__cc-btn" onClick={() => setShowCc(true)}>Cc</button>
          )}
          {!showBcc && (
            <button type="button" className="mail-composer__cc-btn" onClick={() => setShowBcc(true)}>Bcc</button>
          )}
        </div>
        {showCc && (
          <div className="mail-composer__field">
            <span className="mail-composer__label">{t('mail.cc', 'Cc')}:</span>
            <RecipientInput
              value={ccRecipients}
              onChange={setCcRecipients}
              contacts={contacts}
              fieldId="cc"
              onDropFromOtherField={(entry, from) => handleTransferRecipient(entry, from, 'cc')}
            />
          </div>
        )}
        {showBcc && (
          <div className="mail-composer__field">
            <span className="mail-composer__label">Bcc:</span>
            <RecipientInput
              value={bccRecipients}
              onChange={setBccRecipients}
              contacts={contacts}
              fieldId="bcc"
              onDropFromOtherField={(entry, from) => handleTransferRecipient(entry, from, 'bcc')}
            />
          </div>
        )}
        <div className="mail-composer__field">
          <span className="mail-composer__label">{t('mail.subject', 'Subject')}:</span>
          <input
            className="mail-composer__input"
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder={t('mail.subjectPlaceholder', 'Objet')}
            spellCheck={false}
          />
        </div>
        <FormattingToolbar bodyRef={bodyRef} />
        <ComposerAttachmentPanel
          attachments={attachments}
          onRemove={i => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
        />
        <div
          ref={bodyRef}
          className="mail-composer__body mail-reply-composer__body"
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          data-placeholder={t('mail.bodyPlaceholder', 'Écrivez votre réponse…')}
          onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) { e.preventDefault(); doSend(); } }}
          onPaste={handleImagePaste}
        />
      </form>
    </div>
  );
}

// ── New message composer (full panel) ─────────────────────────────────────────

interface ComposerRestoreData {
  readonly isNewMessage: boolean;
  readonly recipients: RecipientEntry[];
  readonly cc: RecipientEntry[];
  readonly bcc: RecipientEntry[];
  readonly subject: string;
  readonly bodyHtml: string;
  readonly replyingToMsg: MailMessage | null;
}

// ── Close composer popover ────────────────────────────────────────────────────

function CloseComposerPopover({ onSaveDraft, onDiscard }: {
  readonly onSaveDraft: () => void;
  readonly onDiscard: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="btn-icon" onClick={() => setOpen(o => !o)}>
        <X size={16} />
      </button>
      {open && (
        <div className="close-composer-popover">
          <button
            type="button"
            className="close-composer-popover__option"
            onClick={() => { setOpen(false); onSaveDraft(); }}
          >
            {t('mail.saveDraft', 'Enregistrer le brouillon')}
          </button>
          <button
            type="button"
            className="close-composer-popover__option close-composer-popover__option--danger"
            onClick={() => { setOpen(false); onDiscard(); }}
          >
            {t('mail.discard', 'Supprimer')}
          </button>
        </div>
      )}
    </div>
  );
}

// ── From account selector ──────────────────────────────────────────────────────

interface FromAccount { id: string; email: string; name?: string; color?: string }

function FromAccountSelector({ accounts, selectedId, onChange, label }: {
  readonly accounts: FromAccount[];
  readonly selectedId: string;
  readonly onChange: (id: string) => void;
  readonly label: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = accounts.find(a => a.id === selectedId) ?? accounts[0];

  useEffect(() => {
    const handler = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="mail-composer__field" ref={ref} style={{ position: 'relative' }}>
      <span className="mail-composer__label">{label}:</span>
      <button
        type="button"
        className="from-account-btn"
        onClick={() => setOpen(o => !o)}
      >
        <span className="from-account-name" style={{ color: selected?.color ?? 'var(--primary)' }}>{selected?.name ?? selected?.email}</span>
        <span className="from-account-email">{selected?.name ? `<${selected.email}>` : ''}</span>
        <ChevronDown size={12} style={{ marginLeft: 'auto', opacity: 0.5 }} />
      </button>
      {open && (
        <ul className="from-account-dropdown">
          {accounts.map(a => (
            <li
              key={a.id}
              className={`from-account-option${a.id === selectedId ? ' from-account-option--active' : ''}`}
              onClick={() => { onChange(a.id); setOpen(false); }}
            >
              <span className="from-account-name" style={{ color: a.color ?? 'var(--primary)' }}>{a.name ?? a.email}</span>
              <span className="from-account-email">{a.name ? `<${a.email}>` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface NewMessageComposerProps {
  readonly contacts: { email: string; name?: string }[];
  readonly restoreData?: ComposerRestoreData | null;
  readonly onSend: (to: string[], cc: string[], bcc: string[], subject: string, body: string, attachments: ComposerAttachment[]) => Promise<void>;
  readonly onCancel: () => void;
  readonly onSaveDraft?: (to: string[], cc: string[], bcc: string[], subject: string, bodyHtml: string) => void;
  readonly onDeleteDraft?: () => Promise<void>;
  /** Shown only in All-accounts mode to let the user pick the sender. */
  readonly fromAccounts?: { id: string; email: string; name?: string; color?: string }[];
  readonly fromAccountId?: string;
  readonly onFromAccountChange?: (id: string) => void;
}

function NewMessageComposer({ contacts, restoreData, onSend, onCancel, onSaveDraft, onDeleteDraft, fromAccounts, fromAccountId, onFromAccountChange }: NewMessageComposerProps) {
  const { t } = useTranslation();
  const [recipients, setRecipients] = useState<RecipientEntry[]>(restoreData?.recipients ?? []);
  const [ccRecipients, setCcRecipients] = useState<RecipientEntry[]>(restoreData?.cc ?? []);
  const [bccRecipients, setBccRecipients] = useState<RecipientEntry[]>(restoreData?.bcc ?? []);
  const [showCc, setShowCc] = useState((restoreData?.cc?.length ?? 0) > 0);
  const [showBcc, setShowBcc] = useState((restoreData?.bcc?.length ?? 0) > 0);
  const [subject, setSubject] = useState(restoreData?.subject ?? '');
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (restoreData?.bodyHtml && bodyRef.current) {
      bodyRef.current.innerHTML = restoreData.bodyHtml;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAttachFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    const newAtts = await readFilesAsBase64(e.target.files);
    setAttachments(prev => [...prev, ...newAtts]);
    e.target.value = '';
  };

  const handleTransferRecipient = (entry: RecipientEntry, fromField: string, toField: string) => {
    const remove = (set: RecipientEntry[], setter: React.Dispatch<React.SetStateAction<RecipientEntry[]>>) =>
      setter(set.filter(r => r.email.toLowerCase() !== entry.email.toLowerCase()));
    const add = (set: RecipientEntry[], setter: React.Dispatch<React.SetStateAction<RecipientEntry[]>>) => {
      if (!set.some(r => r.email.toLowerCase() === entry.email.toLowerCase()))
        setter([...set, entry]);
    };
    if (fromField === 'to') remove(recipients, setRecipients);
    if (fromField === 'cc') remove(ccRecipients, setCcRecipients);
    if (fromField === 'bcc') remove(bccRecipients, setBccRecipients);
    if (toField === 'to') add(recipients, setRecipients);
    if (toField === 'cc') { setShowCc(true); add(ccRecipients, setCcRecipients); }
    if (toField === 'bcc') { setShowBcc(true); add(bccRecipients, setBccRecipients); }
  };

  const doSend = async () => {
    if (recipients.length === 0) return;
    const bodyHtml = bodyRef.current?.innerHTML ?? '';
    setSending(true);
    try { await onSend(recipients.map(r => r.email), ccRecipients.map(r => r.email), bccRecipients.map(r => r.email), subject, bodyHtml, attachments); }
    finally { setSending(false); }
  };
  const handleSubmit = async (e: FormEvent) => { e.preventDefault(); doSend(); };

  const handleClose = () => {
    if (onSaveDraft) {
      const bodyHtml = bodyRef.current?.innerHTML ?? '';
      const hasContent = recipients.length > 0 || subject.trim().length > 0 || bodyHtml.trim().length > 0;
      if (hasContent) {
        onSaveDraft(
          recipients.map(r => r.email),
          ccRecipients.map(r => r.email),
          bccRecipients.map(r => r.email),
          subject,
          bodyHtml,
        );
      }
    }
    onCancel();
  };

  return (
    <div className="mail-new-composer">
      <form className="mail-new-composer__form" onSubmit={handleSubmit}
        onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) { e.preventDefault(); doSend(); } }}>
        <div className="mail-new-composer__toolbar">
          <button type="submit" className="btn-primary" disabled={sending || recipients.length === 0}>
            <Send size={15} />
            {sending ? t('mail.sending', 'Sending…') : t('mail.send', 'Send')}
          </button>
          <button type="button" className="btn-secondary" onClick={() => fileInputRef.current?.click()}>
            <Paperclip size={15} />
            {t('mail.attach', 'Joindre')}
          </button>
          <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleAttachFiles} />
          <div style={{ flex: 1 }} />
          <CloseComposerPopover onSaveDraft={handleClose} onDiscard={onDeleteDraft ?? onCancel} />
        </div>
        {fromAccounts && fromAccounts.length > 1 && (
          <FromAccountSelector
            accounts={fromAccounts}
            selectedId={fromAccountId ?? ''}
            onChange={id => onFromAccountChange?.(id)}
            label={t('mail.from', 'From')}
          />
        )}
        <div className="mail-composer__field">
          <span className="mail-composer__label">{t('mail.to', 'To')}</span>
          <RecipientInput
            value={recipients}
            onChange={setRecipients}
            contacts={contacts}
            autoFocus
            fieldId="to"
            onDropFromOtherField={(entry, from) => handleTransferRecipient(entry, from, 'to')}
          />
          {!showCc && (
            <button type="button" className="mail-composer__cc-btn" onClick={() => setShowCc(true)}>Cc</button>
          )}
          {!showBcc && (
            <button type="button" className="mail-composer__cc-btn" onClick={() => setShowBcc(true)}>Bcc</button>
          )}
        </div>
        {showCc && (
          <div className="mail-composer__field">
            <span className="mail-composer__label">{t('mail.cc', 'Cc')}</span>
            <RecipientInput
              value={ccRecipients}
              onChange={setCcRecipients}
              contacts={contacts}
              fieldId="cc"
              onDropFromOtherField={(entry, from) => handleTransferRecipient(entry, from, 'cc')}
            />
          </div>
        )}
        {showBcc && (
          <div className="mail-composer__field">
            <span className="mail-composer__label">Bcc:</span>
            <RecipientInput
              value={bccRecipients}
              onChange={setBccRecipients}
              contacts={contacts}
              fieldId="bcc"
              onDropFromOtherField={(entry, from) => handleTransferRecipient(entry, from, 'bcc')}
            />
          </div>
        )}
        <div className="mail-composer__field">
          <span className="mail-composer__label">{t('mail.subject', 'Subject')}</span>
          <input
            className="mail-composer__input"
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder={t('mail.subjectPlaceholder', 'Objet')}
            spellCheck={false}
          />
        </div>
        <FormattingToolbar bodyRef={bodyRef} />
        <ComposerAttachmentPanel
          attachments={attachments}
          onRemove={i => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
        />
        <div
          ref={bodyRef}
          className="mail-composer__body mail-new-composer__body"
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          data-placeholder={t('mail.bodyPlaceholder', 'Écrivez votre message…')}
          onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) { e.preventDefault(); doSend(); } }}
          onPaste={handleImagePaste}
        />
      </form>
    </div>
  );
}
