import {
  AlarmClock,
  Archive,
  BellOff,
  Clock,
  File,
  FileArchive,
  FileImage,
  FileText,
  Forward,
  Inbox,
  Mail,
  MailOpen,
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
  X,
} from 'lucide-react';
import { Folder, MailAttachment, MailMessage, MailThread } from './types';
import {
  FormEvent,
  MouseEvent,
  MouseEvent as ReactMouseEvent,
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { RecipientEntry, RecipientInput } from './components/RecipientInput';
import { ThemePreference, useTheme } from '../../shared/store/ThemeStore';
import { avatarColor, formatDate, formatSize, initials } from './utils';

import { Link } from 'react-router-dom';
import { MailSidebar } from './components/MailSidebar';
import { MessageBlockHeader } from './components/MessageBlockHeader';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { useContactSuggestions } from './hooks/useContactSuggestions';
import { useExchangeAuth } from '../../shared/store/ExchangeAuthStore';
import { useTranslation } from 'react-i18next';

function ThemeIcon({ pref }: { readonly pref: ThemePreference }) {
  if (pref === 'light') return <Sun size={18} />;
  if (pref === 'dark') return <Moon size={18} />;
  return <Monitor size={18} />;
}
const THEME_CYCLE: ThemePreference[] = ['system', 'light', 'dark'];

function AttachmentIcon({ contentType }: { readonly contentType: string }) {
  if (contentType.startsWith('image/')) return <FileImage size={14} />;
  if (contentType.includes('pdf') || contentType.includes('word') || contentType.includes('text'))
    return <FileText size={14} />;
  if (contentType.includes('zip') || contentType.includes('compressed'))
    return <FileArchive size={14} />;
  return <File size={14} />;
}

// ── Main component ─────────────────────────────────────────────────────────────

const SIDEBAR_MIN = 150;
const SIDEBAR_MAX = 300;
const THREADLIST_MIN = 200;
const THREADLIST_MAX = 500;

export default function MailApp() {
  const { t } = useTranslation();
  const { accounts, getValidToken } = useExchangeAuth();
  const { preference, setPreference } = useTheme();

  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    () => accounts[0]?.id ?? null
  );
  const [selectedFolder, setSelectedFolder] = useState<Folder>('inbox');
  const [threads, setThreads] = useState<MailThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsLoadingMore, setThreadsLoadingMore] = useState(false);
  const [hasMoreThreads, setHasMoreThreads] = useState(true);
  const [selectedThread, setSelectedThread] = useState<MailThread | null>(null);
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [replyingTo, setReplyingTo] = useState<MailMessage | null>(null);
  const [composing, setComposing] = useState(false);
  const [mailContacts, setMailContacts] = useState<RecipientEntry[]>([]);
  const contacts = useContactSuggestions(mailContacts);
  const [error, setError] = useState<string | null>(null);
  const [deleteToast, setDeleteToast] = useState<{ label: string } | null>(null);
  const pendingDeletionRef = useRef<{
    revert: () => void;
    execute: () => Promise<void>;
    timerId: ReturnType<typeof setTimeout>;
  } | null>(null);

  const [sendToast, setSendToast] = useState<{ label: string } | null>(null);
  const [composerRestoreData, setComposerRestoreData] = useState<{
    isNewMessage: boolean;
    recipients: RecipientEntry[];
    subject: string;
    bodyHtml: string;
    replyingToMsg: MailMessage | null;
  } | null>(null);
  const pendingSendRef = useRef<{
    execute: () => Promise<void>;
    timerId: ReturnType<typeof setTimeout>;
    restoreData: {
      isNewMessage: boolean;
      recipients: RecipientEntry[];
      subject: string;
      bodyHtml: string;
      replyingToMsg: MailMessage | null;
    };
  } | null>(null);

  // Panel resizing
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

  // All Exchange folders, populated by MailSidebar once loaded
  const [allFolders, setAllFolders] = useState<import('./types').MailFolder[]>([]);
  const snoozedFolderId = allFolders.find(f => f.display_name === 'Snoozed')?.folder_id;
  const isInSnoozedFolder = snoozedFolderId !== undefined && selectedFolder === snoozedFolderId;

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
    if (!selectedAccountId && accounts.length > 0) setSelectedAccountId(accounts[0].id);
  }, [accounts, selectedAccountId]);

  const loadThreads = useCallback(async () => {
    if (!selectedAccountId) return;
    const token = await getValidToken(selectedAccountId);
    if (!token) { setError('No valid token — please reconnect your Exchange account.'); return; }
    setThreadsLoading(true);
    setError(null);
    try {
      const result = await invoke<MailThread[]>('mail_list_threads', {
        accessToken: token, folder: selectedFolder, maxCount: 50, offset: 0,
      });
      setThreads(result);
      setHasMoreThreads(result.length >= 50);
    } catch (e) {
      setError(String(e));
    } finally {
      setThreadsLoading(false);
    }
  }, [selectedAccountId, selectedFolder, getValidToken]);

  const loadMoreThreads = useCallback(async () => {
    if (!selectedAccountId || threadsLoadingMore || !hasMoreThreads) return;
    const token = await getValidToken(selectedAccountId);
    if (!token) return;
    setThreadsLoadingMore(true);
    try {
      const result = await invoke<MailThread[]>('mail_list_threads', {
        accessToken: token, folder: selectedFolder, maxCount: 50, offset: threads.length,
      });
      if (result.length > 0) {
        setThreads(prev => [...prev, ...result]);
        setHasMoreThreads(result.length >= 50);
      } else {
        setHasMoreThreads(false);
      }
    } catch (e) {
      console.error('[mail] loadMoreThreads error:', e);
    } finally {
      setThreadsLoadingMore(false);
    }
  }, [selectedAccountId, threadsLoadingMore, hasMoreThreads, threads.length, selectedFolder, getValidToken]);

  useEffect(() => {
    setSelectedThread(null);
    setMessages([]);
    setReplyingTo(null);
    setHasMoreThreads(true);
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
    if (!selectedAccountId) return;
    const token = await getValidToken(selectedAccountId);
    if (!token) return;
    try {
      const count = await invoke<number>('mail_get_inbox_unread', { accessToken: token });
      invoke('set_badge_count', { count }).catch(() => {});
    } catch {
      // Non-critical — ignore badge errors silently
    }
  }, [selectedAccountId, getValidToken]);

  // Silent thread refresh (no loading spinner) used by the polling interval.
  const silentRefresh = useCallback(async () => {
    if (!selectedAccountId) return;
    const token = await getValidToken(selectedAccountId);
    if (!token) return;
    try {
      const result = await invoke<MailThread[]>('mail_list_threads', {
        accessToken: token, folder: selectedFolder, maxCount: 50, offset: 0,
      });
      setThreads(result);
      setHasMoreThreads(result.length >= 50);
    } catch {
      // Non-critical — ignore silent refresh errors
    }
  }, [selectedAccountId, selectedFolder, getValidToken]);

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
      const stored: { itemId: string; accountId: string; snoozeUntil: string }[] =
        JSON.parse(localStorage.getItem(key) ?? '[]');
      const now = new Date();
      const expired = stored.filter(item => new Date(item.snoozeUntil) <= now);
      if (expired.length === 0) return;

      for (const item of expired) {
        const token = await getValidToken(item.accountId);
        if (!token) continue;
        try {
          await invoke('mail_move_to_folder', { accessToken: token, itemId: item.itemId, folderId: 'inbox' });
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
  }, [getValidToken, selectedFolder, selectedAccountId, silentRefresh]);

  const openThread = useCallback(async (thread: MailThread) => {
    if (!selectedAccountId) return;
    setSelectedThread(thread);
    setReplyingTo(null);
    const token = await getValidToken(selectedAccountId);
    if (!token) return;
    setMessagesLoading(true);
    try {
      const result = await invoke<MailMessage[]>('mail_get_thread', {
        accessToken: token, conversationId: thread.conversation_id,
      });
      setMessages(result);
      setThreads(prev => prev.map(th =>
        th.conversation_id === thread.conversation_id ? { ...th, unread_count: 0 } : th
      ));
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
  }, [selectedAccountId, getValidToken]);

  const markRead = useCallback(async (msgs: MailMessage[]) => {
    if (!selectedAccountId || msgs.length === 0) return;
    const token = await getValidToken(selectedAccountId);
    if (!token) return;
    const items = msgs.map(m => ({ item_id: m.item_id, change_key: m.change_key }));
    const ids = msgs.map(m => m.item_id);
    try {
      await invoke('mail_mark_read', { accessToken: token, items });
      setMessages(prev => prev.map(m =>
        ids.includes(m.item_id) ? { ...m, is_read: true } : m
      ));
    } catch (e) {
      console.error('[mail] markRead error:', e);
      setError(String(e));
    }
  }, [selectedAccountId, getValidToken]);

  const toggleRead = useCallback(async (msg: MailMessage) => {
    if (!selectedAccountId) return;
    const token = await getValidToken(selectedAccountId);
    if (!token) return;
    try {
      const items = [{ item_id: msg.item_id, change_key: msg.change_key }];
      if (msg.is_read) {
        await invoke('mail_mark_unread', { accessToken: token, items });
      } else {
        await invoke('mail_mark_read', { accessToken: token, items });
      }
      setMessages(prev => prev.map(m =>
        m.item_id === msg.item_id ? { ...m, is_read: !m.is_read } : m
      ));
      setThreads(prev => prev.map(th =>
        th.conversation_id === selectedThread?.conversation_id
          ? { ...th, unread_count: msg.is_read ? th.unread_count + 1 : Math.max(0, th.unread_count - 1) }
          : th
      ));
    } catch (e) {
      console.error('[mail] toggleRead error:', e);
      setError(String(e));
    }
  }, [selectedAccountId, getValidToken, selectedThread]);

  const moveToTrash = useCallback((itemId: string) => {
    if (!selectedAccountId) return;
    const msgToDelete = messages.find(m => m.item_id === itemId);
    if (!msgToDelete) return;

    const remaining = messages.filter(m => m.item_id !== itemId);
    const removedThread = remaining.length === 0 ? selectedThread : null;
    const convId = selectedThread?.conversation_id;

    // Optimistic update
    setMessages(remaining);
    if (removedThread) {
      setSelectedThread(null);
      setThreads(prev => prev.filter(th => th.conversation_id !== convId));
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
      },
      async () => {
        const token = await getValidToken(selectedAccountId);
        if (!token) throw new Error('No token');
        await invoke('mail_move_to_trash', { accessToken: token, itemId });
      },
    );
  }, [selectedAccountId, getValidToken, messages, selectedThread, scheduleDeletion, t]);

  const handleToggleThreadRead = useCallback(async (thread: MailThread) => {
    if (!selectedAccountId) return;
    const shouldMarkRead = thread.unread_count > 0;

    // Optimistic update
    setThreads(prev => prev.map(th =>
      th.conversation_id === thread.conversation_id
        ? { ...th, unread_count: shouldMarkRead ? 0 : thread.message_count }
        : th
    ));
    if (selectedThread?.conversation_id === thread.conversation_id) {
      setMessages(prev => prev.map(m => ({ ...m, is_read: shouldMarkRead })));
    }

    // Background API call — revert on failure
    try {
      const token = await getValidToken(selectedAccountId);
      if (!token) throw new Error('No token');
      const msgs = await invoke<MailMessage[]>('mail_get_thread', {
        accessToken: token, conversationId: thread.conversation_id,
      });
      const items = msgs.map(m => ({ item_id: m.item_id, change_key: m.change_key }));
      if (shouldMarkRead) {
        await invoke('mail_mark_read', { accessToken: token, items });
      } else {
        await invoke('mail_mark_unread', { accessToken: token, items });
      }
    } catch (e) {
      // Revert
      setThreads(prev => prev.map(th =>
        th.conversation_id === thread.conversation_id
          ? { ...th, unread_count: thread.unread_count }
          : th
      ));
      if (selectedThread?.conversation_id === thread.conversation_id) {
        setMessages(prev => prev.map(m => ({ ...m, is_read: !shouldMarkRead })));
      }
      setError(String(e));
    }
  }, [selectedAccountId, getValidToken, selectedThread]);

  const handleDeleteThread = useCallback((thread: MailThread) => {
    if (!selectedAccountId) return;

    const wasSelected = selectedThread?.conversation_id === thread.conversation_id;
    const savedMessages = wasSelected ? messages : [];

    // Optimistic update
    setThreads(prev => prev.filter(th => th.conversation_id !== thread.conversation_id));
    if (wasSelected) {
      setSelectedThread(null);
      setMessages([]);
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
      },
      async () => {
        const token = await getValidToken(selectedAccountId);
        if (!token) throw new Error('No token');
        const msgs = await invoke<MailMessage[]>('mail_get_thread', {
          accessToken: token, conversationId: thread.conversation_id,
        });
        for (const msg of msgs) {
          await invoke('mail_move_to_trash', { accessToken: token, itemId: msg.item_id });
        }
      },
    );
  }, [selectedAccountId, getValidToken, selectedThread, messages, scheduleDeletion, t]);

  const handleSnooze = useCallback(async (snoozeUntil: string) => {
    if (!selectedAccountId || messages.length === 0 || !selectedThread) return;
    const token = await getValidToken(selectedAccountId);
    if (!token) return;
    const lastMsg = messages[messages.length - 1];
    try {
      const folderId = await invoke<string>('mail_snooze', {
        accessToken: token,
        itemId: lastMsg.item_id,
      });
      // Store snooze expiry locally so the periodic check can restore it
      const key = 'mail-snoozed-items';
      const stored: { itemId: string; accountId: string; snoozeUntil: string; conversationId?: string }[] =
        JSON.parse(localStorage.getItem(key) ?? '[]');
      stored.push({ itemId: lastMsg.item_id, accountId: selectedAccountId, snoozeUntil, conversationId: selectedThread.conversation_id });
      localStorage.setItem(key, JSON.stringify(stored));
      setSnoozedMap(prev => ({ ...prev, [selectedThread.conversation_id]: snoozeUntil }));
      setSnoozedByItemId(prev => ({ ...prev, [lastMsg.item_id]: snoozeUntil }));
      // Optimistic UI: hide the thread immediately
      setThreads(prev => prev.filter(t => t.conversation_id !== selectedThread.conversation_id));
      setSelectedThread(null);
      setMessages([]);
      void folderId; // folder stored server-side; only item_id needed for restore
    } catch (e) { setError(String(e)); }
  }, [selectedAccountId, getValidToken, messages, selectedThread]);

  const handleUnsnooze = useCallback(async () => {
    if (!selectedAccountId || messages.length === 0 || !selectedThread) return;
    const token = await getValidToken(selectedAccountId);
    if (!token) return;
    const lastMsg = messages[messages.length - 1];
    try {
      await invoke('mail_move_to_folder', {
        accessToken: token,
        itemId: lastMsg.item_id,
        folderId: 'inbox',
      });
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
  }, [selectedAccountId, getValidToken, messages, selectedThread]);

  const openAttachment = useCallback(async (att: MailAttachment) => {
    if (!selectedAccountId) return;
    const token = await getValidToken(selectedAccountId);
    if (!token) return;
    try {
      await invoke('mail_open_attachment', {
        accessToken: token,
        attachmentId: att.attachment_id,
        filename: att.name,
      });
    } catch (e) { setError(String(e)); }
  }, [selectedAccountId, getValidToken]);

  const scheduleSend = useCallback(async (
    to: string[],
    subject: string,
    bodyHtml: string,
    restoreData: typeof composerRestoreData,
  ) => {
    if (!selectedAccountId) return;
    const token = await getValidToken(selectedAccountId);
    if (!token) return;

    // Flush any already-pending send immediately
    if (pendingSendRef.current) {
      clearTimeout(pendingSendRef.current.timerId);
      await pendingSendRef.current.execute().catch(e => setError(String(e)));
    }

    const replyToItemId = restoreData?.replyingToMsg?.item_id ?? null;
    const replyToChangeKey = restoreData?.replyingToMsg?.change_key ?? null;

    const execute = async () => {
      const freshToken = await getValidToken(selectedAccountId);
      if (!freshToken) return;
      await invoke('mail_send', {
        accessToken: freshToken, to, subject, bodyHtml,
        replyToItemId,
        replyToChangeKey,
      });
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
  }, [selectedAccountId, getValidToken, selectedThread, openThread, t]);

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
        <span className="header-logo">
          <Mail size={22} strokeWidth={1.5} />
          <span>{t('tabs.mail', 'Mail')}</span>
        </span>

        {accounts.length > 1 && (
          <select
            className="mail-account-select"
            value={selectedAccountId ?? ''}
            onChange={e => setSelectedAccountId(e.target.value)}
          >
            {accounts.map(acc => (
              <option key={acc.id} value={acc.id}>{acc.email}</option>
            ))}
          </select>
        )}

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

      {accounts.length === 0 ? (
        <div className="mail-placeholder">
          <Mail size={64} strokeWidth={1} style={{ opacity: 0.2 }} />
          <p style={{ opacity: 0.5 }}>
            {t('mail.noAccount', 'No Exchange account configured. Add one in Settings.')}
          </p>
          <Link to="/config" className="btn-primary">{t('header.calendarsBtn')}</Link>
        </div>
      ) : (
        <div className="mail-body" ref={mailBodyRef}>
          <div style={{ width: sidebarWidth, overflow: 'hidden' }}>
            <MailSidebar
              selectedFolder={selectedFolder}
              onSelectFolder={setSelectedFolder}
              onCompose={() => { setComposing(true); setSelectedThread(null); }}
              accountId={selectedAccountId}
              getValidToken={getValidToken}
              onFoldersLoaded={setAllFolders}
            />
          </div>
          <div
            className="mail-resize-handle"
            onMouseDown={startResizingSidebar}
            style={{ cursor: 'col-resize' }}
          />

          <div style={{ width: threadListWidth, height: '100%', position: 'relative', zIndex: 1 }}>
            <ThreadList
              ref={threadListRef}
              threads={threads}
              loading={threadsLoading}
              loadingMore={threadsLoadingMore}
              selectedId={selectedThread?.conversation_id ?? null}
              snoozedMap={snoozedMap}
              isInSnoozedFolder={isInSnoozedFolder}
              onSelect={openThread}
              onToggleRead={handleToggleThreadRead}
              onDelete={handleDeleteThread}
            />
          </div>
          <div
            className="mail-resize-handle"
            onMouseDown={startResizingThreadList}
            style={{ cursor: 'col-resize' }}
          />

          <div className="mail-detail-panel">
            {composing ? (
              <NewMessageComposer
                contacts={contacts}
                restoreData={composerRestoreData?.isNewMessage ? composerRestoreData : null}
                onSend={(to, subject, body) =>
                  scheduleSend(to, subject, body, {
                    isNewMessage: true,
                    recipients: to.map(email => ({ email })),
                    subject,
                    bodyHtml: body,
                    replyingToMsg: null,
                  })
                }
                onCancel={() => setComposing(false)}
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
                onMarkRead={markRead}
                onTrash={moveToTrash}
                onOpenAttachment={openAttachment}
                onReply={msg => setReplyingTo(msg)}
                onReplyAll={msg => setReplyingTo(msg)}
                onForward={msg => setReplyingTo(msg)}
                onToggleRead={toggleRead}
                onCancelReply={() => setReplyingTo(null)}
                onDeleteThread={() => handleDeleteThread(selectedThread)}
                onToggleThreadRead={() => handleToggleThreadRead(selectedThread)}
                onSend={(to, subject, body) =>
                  scheduleSend(to, subject, body, {
                    isNewMessage: false,
                    recipients: to.map(email => ({ email })),
                    subject,
                    bodyHtml: body,
                    replyingToMsg: replyingTo,
                  })
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

      {sendToast && createPortal(
        <div className="mail-delete-toast">
          <span>{sendToast.label}</span>
          <button className="mail-delete-toast__undo" onClick={cancelSend}>
            {t('mail.undo', 'Annuler')}
          </button>
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
}

type ThreadFilter = 'all' | 'unread';

const ThreadList = forwardRef<HTMLDivElement, ThreadListProps>(
  ({ threads, loading, loadingMore, selectedId, snoozedMap, isInSnoozedFolder, onSelect, onToggleRead, onDelete }, ref) => {
    const { t } = useTranslation();
    const [filter, setFilter] = useState<ThreadFilter>('all');
    const [allChecked, setAllChecked] = useState(false);
    const [filterOpen, setFilterOpen] = useState(false);

    const visibleThreads = filter === 'unread' ? threads.filter(th => th.unread_count > 0) : threads;

    const toolbar = (
      <div className="mail-thread-toolbar">
        <input
          type="checkbox"
          className="mail-thread-toolbar__checkbox"
          checked={allChecked}
          onChange={e => setAllChecked(e.target.checked)}
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
            snoozeUntil={snoozedMap[thread.conversation_id]}
            isInSnoozedFolder={isInSnoozedFolder}
            onSelect={onSelect}
            onToggleRead={onToggleRead}
            onDelete={onDelete}
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
  readonly snoozeUntil?: string;
  readonly isInSnoozedFolder: boolean;
  readonly onSelect: (t: MailThread) => void;
  readonly onToggleRead: (t: MailThread) => void;
  readonly onDelete: (t: MailThread) => void;
}

function ThreadItem({ thread, isSelected, snoozeUntil, isInSnoozedFolder, onSelect, onToggleRead, onDelete }: ThreadItemProps) {
  const { t } = useTranslation();
  const isUnread = thread.unread_count > 0;
  const sender = thread.from_name ?? t('mail.unknown', 'Unknown');
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);

  const showTooltip = (e: ReactMouseEvent<HTMLButtonElement>, text: string) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({ text, x: rect.left + rect.width / 2, y: rect.top });
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={`mail-thread-item${isSelected ? ' selected' : ''}${isUnread ? ' unread' : ''}`}
      onClick={() => onSelect(thread)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onSelect(thread); }}
    >
      {/* Avatar */}
      <div className="mail-thread-item__avatar"
        style={{ background: avatarColor(sender) }}>
        {initials(sender)}
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
          <span className="mail-thread-item__snippet-text">{thread.snippet}</span>
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
  readonly onMarkRead: (msgs: MailMessage[]) => void;
  readonly onTrash: (id: string) => void;
  readonly onOpenAttachment: (att: MailAttachment) => void;
  readonly onReply: (msg: MailMessage) => void;
  readonly onReplyAll: (msg: MailMessage) => void;
  readonly onForward: (msg: MailMessage) => void;
  readonly onToggleRead: (msg: MailMessage) => void;
  readonly onCancelReply: () => void;
  readonly onSend: (to: string[], subject: string, body: string) => Promise<void>;
  readonly composerRestoreData?: ComposerRestoreData | null;
  readonly onDeleteThread: () => void;
  readonly onToggleThreadRead: () => void;
  readonly supportsSnooze: boolean;
  readonly onSnooze: (snoozeUntil: string) => void;
  readonly snoozeUntil?: string;
  readonly onUnsnooze: () => void;
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
  thread, messages, replyingTo, contacts,
  onMarkRead, onTrash, onOpenAttachment,
  onReply, onReplyAll, onForward, onToggleRead,
  onCancelReply, onSend, composerRestoreData,
  onDeleteThread, onToggleThreadRead,
  supportsSnooze, onSnooze, snoozeUntil, onUnsnooze,
}: ThreadDetailProps) {
  const { t } = useTranslation();
  const [moreOpen, setMoreOpen] = useState(false);
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

      <div className="mail-thread-detail__messages">
        {messages.map((msg, idx) => (
          <MessageBlock
            key={msg.item_id}
            message={msg}
            defaultExpanded={idx === messages.length - 1}
            onMarkRead={onMarkRead}
            onTrash={onTrash}
            onOpenAttachment={onOpenAttachment}
            onReply={onReply}
            onReplyAll={onReplyAll}
            onForward={onForward}
            onToggleRead={onToggleRead}
          />
        ))}
      </div>

      {replyingTo && (
        <MailComposer replyTo={replyingTo} contacts={contacts} restoreData={composerRestoreData} onSend={onSend} onCancel={onCancelReply} />
      )}
    </div>
  );
}

// ── Message block ──────────────────────────────────────────────────────────────

interface MessageBlockProps {
  readonly message: MailMessage;
  readonly defaultExpanded: boolean;
  readonly onMarkRead: (msgs: MailMessage[]) => void;
  readonly onTrash: (id: string) => void;
  readonly onOpenAttachment: (att: MailAttachment) => void;
  readonly onReply: (msg: MailMessage) => void;
  readonly onReplyAll: (msg: MailMessage) => void;
  readonly onForward: (msg: MailMessage) => void;
  readonly onToggleRead: (msg: MailMessage) => void;
}

function MessageBlock({
  message, defaultExpanded,
  onMarkRead, onTrash, onOpenAttachment,
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
          <EmailHtmlBody html={message.body_html} />
          {message.attachments.length > 0 && (
            <AttachmentList attachments={message.attachments} onOpen={onOpenAttachment} />
          )}
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
  .ew img, .ew video, .ew canvas, .ew iframe, .ew svg { filter: url(#dm); }` : '';

  const srcdoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
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
  }${darkModeStyle}
</style>
</head>
<body>${darkModeSvg}<div class="ew">${html}</div>
<script>
  document.addEventListener('click', function(e) {
    var a = e.target.closest('a');
    if (a && a.href && !a.href.startsWith('javascript:')) {
      e.preventDefault();
      window.parent.postMessage({ type: 'open-url', url: a.href }, '*');
    }
  });
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
  readonly onOpen: (att: MailAttachment) => void;
}

function AttachmentList({ attachments, onOpen }: AttachmentListProps) {
  return (
    <div className="mail-attachments">
      {attachments.map(att => (
        <button key={att.attachment_id} className="mail-attachment-item"
          onClick={() => onOpen(att)} title={att.name}>
          <AttachmentIcon contentType={att.content_type} />
          <span className="mail-attachment-name">{att.name}</span>
          <span className="mail-attachment-size">{formatSize(att.size)}</span>
        </button>
      ))}
    </div>
  );
}

// ── Composer ───────────────────────────────────────────────────────────────────

interface MailComposerProps {
  readonly replyTo: MailMessage;
  readonly contacts: { email: string; name?: string }[];
  readonly restoreData?: ComposerRestoreData | null;
  readonly onSend: (to: string[], subject: string, body: string) => Promise<void>;
  readonly onCancel: () => void;
}

function MailComposer({ replyTo, contacts, restoreData, onSend, onCancel }: MailComposerProps) {
  const { t } = useTranslation();
  const [sending, setSending] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const initialRecipient: RecipientEntry = {
    email: replyTo.from_email ?? '',
    name: replyTo.from_name ?? undefined,
  };
  const [recipients, setRecipients] = useState<RecipientEntry[]>(
    restoreData?.recipients ?? [initialRecipient]
  );
  const [subject, setSubject] = useState(
    restoreData?.subject ?? (replyTo.subject.startsWith('Re:') ? replyTo.subject : `Re: ${replyTo.subject}`)
  );

  useEffect(() => {
    if (restoreData?.bodyHtml && bodyRef.current) {
      bodyRef.current.innerHTML = restoreData.bodyHtml;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (recipients.length === 0) return;
    const bodyHtml = bodyRef.current?.innerHTML ?? '';
    setSending(true);
    try { await onSend(recipients.map(r => r.email), subject, bodyHtml); }
    finally { setSending(false); }
  };

  return (
    <div className="mail-new-composer">
      <form className="mail-new-composer__form" onSubmit={handleSubmit}>
        <div className="mail-new-composer__toolbar">
          <button type="submit" className="btn-primary" disabled={sending || recipients.length === 0}>
            <Send size={15} />
            {sending ? t('mail.sending', 'Sending…') : t('mail.send', 'Send')}
          </button>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn-icon" onClick={onCancel}><X size={16} /></button>
        </div>
        <div className="mail-composer__field">
          <span className="mail-composer__label">{t('mail.to', 'To')}:</span>
          <RecipientInput
            value={recipients}
            onChange={setRecipients}
            contacts={contacts}
            autoFocus
          />
        </div>
        <div className="mail-composer__field">
          <span className="mail-composer__label">{t('mail.subject', 'Subject')}:</span>
          <input
            className="mail-composer__input"
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder={t('mail.subjectPlaceholder', 'Objet')}
          />
        </div>
        <div
          ref={bodyRef}
          className="mail-composer__body mail-new-composer__body"
          contentEditable
          suppressContentEditableWarning
          data-placeholder={t('mail.bodyPlaceholder', 'Écrivez votre réponse…')}
        />
      </form>
    </div>
  );
}

// ── New message composer (full panel) ─────────────────────────────────────────

interface ComposerRestoreData {
  readonly isNewMessage: boolean;
  readonly recipients: RecipientEntry[];
  readonly subject: string;
  readonly bodyHtml: string;
  readonly replyingToMsg: MailMessage | null;
}

interface NewMessageComposerProps {
  readonly contacts: { email: string; name?: string }[];
  readonly restoreData?: ComposerRestoreData | null;
  readonly onSend: (to: string[], subject: string, body: string) => Promise<void>;
  readonly onCancel: () => void;
}

function NewMessageComposer({ contacts, restoreData, onSend, onCancel }: NewMessageComposerProps) {
  const { t } = useTranslation();
  const [recipients, setRecipients] = useState<RecipientEntry[]>(restoreData?.recipients ?? []);
  const [subject, setSubject] = useState(restoreData?.subject ?? '');
  const [sending, setSending] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (restoreData?.bodyHtml && bodyRef.current) {
      bodyRef.current.innerHTML = restoreData.bodyHtml;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (recipients.length === 0) return;
    const bodyHtml = bodyRef.current?.innerHTML ?? '';
    setSending(true);
    try { await onSend(recipients.map(r => r.email), subject, bodyHtml); }
    finally { setSending(false); }
  };

  return (
    <div className="mail-new-composer">
      <form className="mail-new-composer__form" onSubmit={handleSubmit}>
        <div className="mail-new-composer__toolbar">
          <button type="submit" className="btn-primary" disabled={sending || recipients.length === 0}>
            <Send size={15} />
            {sending ? t('mail.sending', 'Sending…') : t('mail.send', 'Send')}
          </button>
          <button type="button" className="btn-secondary mail-new-composer__attach" disabled>
            <Paperclip size={15} />
            {t('mail.attach', 'Attach')}
          </button>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn-icon" onClick={onCancel}><X size={16} /></button>
        </div>
        <div className="mail-composer__field">
          <span className="mail-composer__label">{t('mail.to', 'To')}:</span>
          <RecipientInput
            value={recipients}
            onChange={setRecipients}
            contacts={contacts}
            autoFocus
          />
        </div>
        <div className="mail-composer__field">
          <span className="mail-composer__label">{t('mail.subject', 'Subject')}:</span>
          <input
            className="mail-composer__input"
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder={t('mail.subjectPlaceholder', 'Objet')}
          />
        </div>
        <div
          ref={bodyRef}
          className="mail-composer__body mail-new-composer__body"
          contentEditable
          suppressContentEditableWarning
          data-placeholder={t('mail.bodyPlaceholder', 'Écrivez votre message…')}
        />
      </form>
    </div>
  );
}
