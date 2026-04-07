import {
  File,
  FileArchive,
  FileImage,
  FileText,
  Inbox,
  Mail,
  MailOpen,
  Monitor,
  Moon,
  Paperclip,
  RefreshCw,
  Send,
  Settings,
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
import { ThemePreference, useTheme } from '../../shared/store/ThemeStore';
import { avatarColor, formatDate, formatSize, initials } from './utils';

import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { MailSidebar } from './components/MailSidebar';
import { RecipientEntry, RecipientInput } from './components/RecipientInput';
import { MessageBlockHeader } from './components/MessageBlockHeader';
import { useContactSuggestions } from './hooks/useContactSuggestions';
import { invoke } from '@tauri-apps/api/core';
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

  // Cleanup pending deletion on unmount
  useEffect(() => () => {
    if (pendingDeletionRef.current) clearTimeout(pendingDeletionRef.current.timerId);
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

  const handleSend = useCallback(async (to: string[], subject: string, bodyHtml: string) => {
    if (!selectedAccountId) return;
    const token = await getValidToken(selectedAccountId);
    if (!token) return;
    try {
      await invoke('mail_send', {
        accessToken: token, to, subject, bodyHtml,
        replyToItemId: replyingTo?.item_id ?? null,
        replyToChangeKey: replyingTo?.change_key ?? null,
      });
      setReplyingTo(null);
      if (selectedThread) openThread(selectedThread);
    } catch (e) { setError(String(e)); }
  }, [selectedAccountId, getValidToken, replyingTo, selectedThread, openThread]);

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
        <Link to="/config" className="btn-config" title={t('header.configCalendars')}>
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
                onSend={async (to, subject, body) => {
                  await handleSend(to, subject, body);
                  setComposing(false);
                }}
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
                onSend={handleSend}
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
    </div>
  );
}

// ── Thread list ────────────────────────────────────────────────────────────────

interface ThreadListProps {
  readonly threads: MailThread[];
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly selectedId: string | null;
  readonly onSelect: (t: MailThread) => void;
  readonly onToggleRead: (t: MailThread) => void;
  readonly onDelete: (t: MailThread) => void;
}

const ThreadList = forwardRef<HTMLDivElement, ThreadListProps>(
  ({ threads, loading, loadingMore, selectedId, onSelect, onToggleRead, onDelete }, ref) => {
    const { t } = useTranslation();
    if (loading && threads.length === 0) {
      return (
        <div className="mail-thread-list mail-thread-list--empty">
          <RefreshCw size={24} className="spin" style={{ opacity: 0.4 }} />
        </div>
      );
    }
    if (!loading && threads.length === 0) {
      return (
        <div className="mail-thread-list mail-thread-list--empty">
          <p style={{ opacity: 0.4 }}>{t('mail.empty', 'No messages')}</p>
        </div>
      );
    }
    return (
      <div className="mail-thread-list" ref={ref}>
        {threads.map(thread => (
          <ThreadItem
            key={thread.conversation_id}
            thread={thread}
            isSelected={thread.conversation_id === selectedId}
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
  readonly onSelect: (t: MailThread) => void;
  readonly onToggleRead: (t: MailThread) => void;
  readonly onDelete: (t: MailThread) => void;
}

function ThreadItem({ thread, isSelected, onSelect, onToggleRead, onDelete }: ThreadItemProps) {
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
}

function ThreadDetail({
  thread, messages, replyingTo, contacts,
  onMarkRead, onTrash, onOpenAttachment,
  onReply, onReplyAll, onForward, onToggleRead,
  onCancelReply, onSend,
}: ThreadDetailProps) {
  const { t } = useTranslation();
  // thread.topic can be empty if EWS didn't return it — fall back to any message subject
  const subject = thread.topic
    || messages.find(m => m.subject)?.subject
    || t('mail.noSubject', '(no subject)');

  return (
    <div className="mail-thread-detail">
      <div className="mail-thread-detail__header">
        <h2 className="mail-thread-detail__subject">{subject}</h2>
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
        <MailComposer replyTo={replyingTo} contacts={contacts} onSend={onSend} onCancel={onCancelReply} />
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

  const updateHeight = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (doc?.documentElement) {
      setIframeHeight(doc.documentElement.scrollHeight + 4);
    }
  }, []);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    let observer: ResizeObserver | null = null;
    const onLoad = () => {
      updateHeight();
      const body = iframe.contentDocument?.body;
      if (body) {
        observer = new ResizeObserver(updateHeight);
        observer.observe(body);
      }
    };
    iframe.addEventListener('load', onLoad);
    return () => {
      iframe.removeEventListener('load', onLoad);
      observer?.disconnect();
    };
  }, [updateHeight]);

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

  // Wrap email HTML in a minimal document with reset styles.
  // The iframe scrolls internally — no JS resize needed (avoids WKWebView sandbox issues).
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
  a { color: #1a73e8; }
  pre, code { white-space: pre-wrap; word-break: break-all; font-size: 13px; }
  table { max-width: 100%; }
  blockquote {
    border-left: 3px solid #dadce0;
    margin: 8px 0; padding-left: 12px; color: #70757a;
  }${darkModeStyle}
</style>
</head>
<body>${darkModeSvg}<div class="ew">${html}</div></body>
</html>`;

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcdoc}
      sandbox="allow-same-origin allow-popups"
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
  readonly onSend: (to: string[], subject: string, body: string) => Promise<void>;
  readonly onCancel: () => void;
}

function MailComposer({ replyTo, contacts, onSend, onCancel }: MailComposerProps) {
  const { t } = useTranslation();
  const [sending, setSending] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const initialRecipient: RecipientEntry = {
    email: replyTo.from_email ?? '',
    name: replyTo.from_name ?? undefined,
  };
  const [recipients, setRecipients] = useState<RecipientEntry[]>([initialRecipient]);
  const [subject, setSubject] = useState(
    replyTo.subject.startsWith('Re:') ? replyTo.subject : `Re: ${replyTo.subject}`
  );

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

interface NewMessageComposerProps {
  readonly contacts: { email: string; name?: string }[];
  readonly onSend: (to: string[], subject: string, body: string) => Promise<void>;
  readonly onCancel: () => void;
}

function NewMessageComposer({ contacts, onSend, onCancel }: NewMessageComposerProps) {
  const { t } = useTranslation();
  const [recipients, setRecipients] = useState<RecipientEntry[]>([]);
  const [subject, setSubject] = useState('');
  const [sending, setSending] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

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
