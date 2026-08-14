import { Archive, BellOff, CalendarClock, Check, Clock, Mail as MailIcon, MailOpen, Paperclip, Trash2 } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { decodeHtmlEntities, formatDate, formatMailPreview, formatSnoozeDate, senderColor } from '../utils';

import { MailRecipient, MailThread } from '../types';
import type { MailProvider } from '../providers/MailProvider';
import { ContactAvatar } from './ContactAvatar';
import { createPortal } from 'react-dom';
import { useTheme } from '../../../shared/store/ThemeStore';
import { useTranslation } from 'react-i18next';

// Loading every visible row at once is especially expensive in the unified
// view (JMAP needs Thread/get + Email/get). Limit work independently per
// account so one provider cannot reject a whole burst of previews.
const snippetQueues = new Map<string, {
  active: number;
  limit: number;
  pending: Array<() => void>;
}>();

function scheduleSnippet<T>(accountId: string, limit: number, task: () => Promise<T>): Promise<T> {
  const queue = snippetQueues.get(accountId) ?? { active: 0, limit, pending: [] };
  snippetQueues.set(accountId, queue);

  return new Promise<T>((resolve, reject) => {
    const run = () => {
      queue.active += 1;
      void task().then(resolve, reject).finally(() => {
        queue.active -= 1;
        queue.pending.shift()?.();
        if (queue.active === 0 && queue.pending.length === 0) {
          snippetQueues.delete(accountId);
        }
      });
    };

    if (queue.active < queue.limit) run();
    else queue.pending.push(run);
  });
}

// ── Stacked recipient avatars ───────────────────────────────────────────────

interface RecipientAvatarsProps {
  readonly recipients: MailRecipient[];
  readonly provider?: MailProvider | null;
}

function RecipientAvatars({ recipients, provider }: RecipientAvatarsProps) {
  const total = recipients.length;

  // 1 recipient — single normal-sized avatar
  if (total === 1) {
    return (
      <ContactAvatar
        email={recipients[0].email}
        name={recipients[0].name ?? undefined}
        provider={provider}
        size={36}
      />
    );
  }

  // 2 recipients — diagonal: top-left and bottom-right (22px each)
  // (0,0) and (14,14) → right/bottom edges = 36 ✓
  if (total === 2) {
    const positions = [{ l: 0, t: 0 }, { l: 14, t: 14 }];
    return (
      <div className="mail-thread-item__recipient-stack">
        {recipients.map((r, i) => (
          <div key={r.email} style={{ position: 'absolute', left: positions[i].l, top: positions[i].t, zIndex: 2 - i }}>
            <ContactAvatar email={r.email} name={r.name ?? undefined} provider={provider} size={22} />
          </div>
        ))}
      </div>
    );
  }

  // 3 recipients — triangle of 20px avatars (fits exactly in 36×36)
  // top-left (0,0), top-right (16,0), bottom-center (8,16) → all edges ≤ 36 ✓
  if (total === 3) {
    const positions = [{ l: 0, t: 0 }, { l: 16, t: 0 }, { l: 8, t: 16 }];
    return (
      <div className="mail-thread-item__recipient-stack">
        {recipients.map((r, i) => (
          <div key={r.email} style={{ position: 'absolute', left: positions[i].l, top: positions[i].t, zIndex: 3 - i }}>
            <ContactAvatar email={r.email} name={r.name ?? undefined} provider={provider} size={20} />
          </div>
        ))}
      </div>
    );
  }

  // 4+ recipients — triangle like the 3-avatar case, 3rd position is the "+N" badge
  // top-left (0,0), top-right (16,0), bottom-center (8,16) → all edges ≤ 36 ✓
  const twoShown = recipients.slice(0, 2);
  const pairPositions = [{ l: 0, t: 0 }, { l: 16, t: 0 }];
  return (
    <div className="mail-thread-item__recipient-stack">
      {twoShown.map((r, i) => (
        <div key={r.email} style={{ position: 'absolute', left: pairPositions[i].l, top: pairPositions[i].t, zIndex: 2 - i }}>
          <ContactAvatar email={r.email} name={r.name ?? undefined} provider={provider} size={20} />
        </div>
      ))}
      <div
        className="mail-thread-item__recipient-more"
        style={{ position: 'absolute', left: 8, top: 16, width: 20, height: 20 }}
      >
        +{total - 2}
      </div>
    </div>
  );
}

// ── ThreadItem ──────────────────────────────────────────────────────────────

export interface ThreadItemProps {
  readonly thread: MailThread;
  readonly isSelected: boolean;
  readonly isChecked: boolean;
  readonly snoozeUntil?: string;
  readonly isInSnoozedFolder: boolean;
  readonly isSentFolder?: boolean;
  readonly isInScheduledFolder?: boolean;
  readonly hasDraft?: boolean;
  readonly sourceColor?: string;
  readonly provider?: MailProvider | null;
  readonly onSelect: (t: MailThread) => void;
  readonly onToggleRead: (t: MailThread) => void;
  readonly onDelete: (t: MailThread) => void;
  readonly onToggleCheck: (t: MailThread, shiftKey: boolean) => void;
}

export function ThreadItem({ thread, isSelected, isChecked, snoozeUntil, isInSnoozedFolder, isSentFolder = false, isInScheduledFolder = false, hasDraft, sourceColor, provider, onSelect, onToggleRead, onDelete, onToggleCheck }: ThreadItemProps) {
  const { t } = useTranslation();
  const { preference } = useTheme();
  const isDark = preference === 'dark';
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const itemRef = useRef<HTMLDivElement>(null);
  const avatarLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const avatarLongPressHandledRef = useRef(false);
  const [snippetNearViewport, setSnippetNearViewport] = useState(false);

  const isMobile = () => globalThis.matchMedia?.("(max-width: 700px)").matches ?? false;
  const clearAvatarLongPress = () => {
    if (avatarLongPressTimerRef.current !== null) {
      clearTimeout(avatarLongPressTimerRef.current);
      avatarLongPressTimerRef.current = null;
    }
  };

  useEffect(() => clearAvatarLongPress, []);
  useEffect(() => {
    if (thread.snippet || !provider?.getThreadSnippet) return;
    const element = itemRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setSnippetNearViewport(true); observer.disconnect(); }
    }, { rootMargin: '300px 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [thread.conversation_id, thread.snippet, provider]);
  // In unified mode the provider map may be rebuilt briefly while switching
  // source tabs. The thread keeps its account id throughout that transition,
  // so use it to keep observing the same cached preview instead of switching
  // temporarily to a query key containing `undefined`.
  const snippetAccountId = thread.accountId ?? provider?.accountId;
  const snippetQuery = useQuery({
    // Keep previews separate from the `mail` namespace: list refreshes and
    // account switches invalidate/cancel that namespace. The delivery date
    // versions the cache so a new message still causes a fresh preview.
    queryKey: ['mail-thread-snippet', snippetAccountId, thread.conversation_id, thread.last_delivery_time],
    queryFn: () => scheduleSnippet(
      provider!.accountId,
      provider!.providerType === 'jmap' ? 1 : 3,
      () => provider!.getThreadSnippet!(thread.conversation_id),
    ),
    enabled: snippetNearViewport && !thread.snippet && !!provider?.getThreadSnippet,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 2,
    retryDelay: attempt => Math.min(500 * 2 ** attempt, 2_000),
  });
  const snippet = thread.snippet || snippetQuery.data || '';

  const showTooltip = (e: React.MouseEvent, text: string) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({ text, x: rect.left + rect.width / 2, y: rect.top - 30 });
  };

  const isUnread = thread.unread_count > 0;
  const isSnoozed = isInSnoozedFolder || (!!snoozeUntil && new Date(snoozeUntil) > new Date());

  const toRecipients = thread.to_recipients ?? [];
  const ccRecipients = thread.cc_recipients ?? [];
  const totalRecipients = toRecipients.length + ccRecipients.length;
  const showRecipients = isSentFolder && totalRecipients > 0;
  const recipientsLabel = toRecipients.map(r => r.name || r.email).join(', ');

  let avatarContent: React.ReactNode;
  if (isHovered || isChecked) {
    avatarContent = (
      <div className={`mail-thread-item__checkbox-box ${isChecked ? 'mail-thread-item__checkbox-box--checked' : ''}`}>
        {isChecked && <Check size={14} strokeWidth={3} />}
      </div>
    );
  } else if (showRecipients) {
    avatarContent = <RecipientAvatars recipients={toRecipients} provider={provider} />;
  } else {
    const sender = thread.from_name ?? thread.from_email ?? '?';
    const matchingSender = thread.unique_senders?.find(candidate =>
      candidate.name?.trim().toLowerCase() === thread.from_name?.trim().toLowerCase()
    );
    avatarContent = (
      <ContactAvatar
        email={thread.from_email ?? matchingSender?.email ?? sender}
        name={thread.from_name ?? undefined}
        provider={provider}
        size={36}
      />
    );
  }

  return (
    <div
      ref={itemRef}
      className={`mail-thread-item ${isSelected ? "selected" : ""} ${isUnread ? "unread" : ""} ${isChecked ? "checked" : ""}`}
      onClick={() => {
        if (avatarLongPressHandledRef.current) {
          avatarLongPressHandledRef.current = false;
          return;
        }
        onSelect(thread);
      }}
      onPointerDown={e => {
        if (!isMobile() || e.pointerType === "mouse") return;
        avatarLongPressHandledRef.current = false;
        clearAvatarLongPress();
        avatarLongPressTimerRef.current = setTimeout(() => {
          avatarLongPressHandledRef.current = true;
          onToggleCheck(thread, false);
        }, 450);
      }}
      onPointerUp={clearAvatarLongPress}
      onPointerCancel={clearAvatarLongPress}
      onContextMenu={e => {
        if (isMobile()) e.preventDefault();
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => { setIsHovered(false); setTooltip(null); }}
    >
      <div
        className={`mail-thread-item__avatar ${(isHovered || isChecked) ? 'mail-thread-item__avatar--checkbox' : ''}`}
        onClick={e => {
          if (isMobile()) {
            e.stopPropagation();
            if (avatarLongPressHandledRef.current) {
              avatarLongPressHandledRef.current = false;
              return;
            }
            onToggleCheck(thread, false);
            return;
          }
          if (isHovered || isChecked) {
            e.stopPropagation();
            onToggleCheck(thread, e.shiftKey);
          }
        }}
      >
        {avatarContent}
      </div>

      <div className="mail-thread-item__content">
        <div className="mail-thread-item__top">
          <div className="mail-thread-item__from">
            {showRecipients ? (
              <>
                <span
                  className="mail-thread-item__recipients"
                  style={{ color: thread.accountColor ?? sourceColor }}
                  title={[...toRecipients, ...ccRecipients].map(r => r.name ? `${r.name} <${r.email}>` : r.email).join(', ')}
                >
                  {recipientsLabel}
                </span>
                {totalRecipients > 1 && (
                  <span className="mail-thread-item__count mail-thread-item__count--recipients">{totalRecipients}</span>
                )}
              </>
            ) : (
              <>
                <span style={{ color: senderColor(thread.from_name || '', isDark) }}>
                  {thread.from_name}
                </span>
                {thread.message_count > 1 && (
                  <span className="mail-thread-item__count">{thread.message_count}</span>
                )}
              </>
            )}
          </div>
          <div className="mail-thread-item__top-right">
            {thread.has_attachments && <Paperclip size={12} className="mail-thread-item__clip" />}
            {isSnoozed && (
              <span className="mail-thread-item__snooze-badge" title={snoozeUntil ? `${t('mail.snoozedUntil', "Mis en attente jusqu'au")} ${new Date(snoozeUntil).toLocaleString()}` : t('mail.snoozed', 'Mis en attente')}>
                <Clock size={10} />
                {snoozeUntil && <span>{formatSnoozeDate(snoozeUntil, t)}</span>}
              </span>
            )}
            {isInScheduledFolder && (
              <span className="mail-thread-item__scheduled-badge" title={new Date(thread.last_delivery_time).toLocaleString()}>
                <CalendarClock size={12} />
                <span>{formatSnoozeDate(thread.last_delivery_time, t)}</span>
              </span>
            )}
            {isUnread && <span className="mail-thread-item__unread-dot" aria-hidden="true" />}
            {!isInScheduledFolder && <span className="mail-thread-item__date">{formatDate(thread.last_delivery_time)}</span>}
          </div>
        </div>

        <div className="mail-thread-item__subject">{decodeHtmlEntities(thread.topic) || t('mail.noSubject', "(Pas d'objet)")}</div>
        <div className="mail-thread-item__snippet">
          {hasDraft && (
            <span className="mail-thread-item__draft-badge">{t('mail.draftBadge', 'Brouillon')}</span>
          )}
          {snippet ? (
            <span className="mail-thread-item__snippet-text">{formatMailPreview(snippet)}</span>
          ) : provider?.getThreadSnippet && snippetQuery.isPending ? (
            <span className="mail-thread-item__snippet-skeleton" aria-hidden="true" />
          ) : null}
        </div>

        {isInSnoozedFolder && isSnoozed && (
          <div className="mail-thread-item__badges">
            <div className="mail-thread-item__badge mail-thread-item__badge--snooze-folder">
              <BellOff size={12} />
            </div>
          </div>
        )}
      </div>

      {thread.accountLabel && (
        <span
          className="mail-thread-item__account-tag"
          style={thread.accountColor ? {
            color: thread.accountColor,
            borderLeftColor: thread.accountColor,
            ['--tag-color' as string]: thread.accountColor,
          } : undefined}
        >
          {thread.accountLabel}
        </span>
      )}

      <div className="mail-thread-item__actions">
        <button
          className="mail-thread-item__action-btn"
          onClick={e => { e.stopPropagation(); onToggleRead(thread); }}
          onMouseEnter={e => showTooltip(e, isUnread ? t('mail.markAsRead', 'Marquer comme lu') : t('mail.markAsUnread', 'Marquer comme non lu'))}
          onMouseLeave={() => setTooltip(null)}
        >
          {isUnread ? <MailOpen size={14} /> : <MailIcon size={14} />}
        </button>
        <button
          className="mail-thread-item__action-btn"
          onClick={e => { e.stopPropagation(); }}
          onMouseEnter={e => showTooltip(e, t('mail.archiveThread', 'Archiver'))}
          onMouseLeave={() => setTooltip(null)}
        >
          <Archive size={14} />
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
