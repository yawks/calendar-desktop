import React, { useState } from 'react';
import { MailThread } from '../types';
import { Archive, BellOff, Check, Clock, Mail as MailIcon, MailOpen, Paperclip, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { useTheme } from '../../../shared/store/ThemeStore';
import { avatarColor, formatDate, initials, senderColor, decodeHtmlEntities } from '../utils';

export interface ThreadItemProps {
  readonly thread: MailThread;
  readonly isSelected: boolean;
  readonly isChecked: boolean;
  readonly snoozeUntil?: string;
  readonly isInSnoozedFolder: boolean;
  readonly hasDraft?: boolean;
  readonly onSelect: (t: MailThread) => void;
  readonly onToggleRead: (t: MailThread) => void;
  readonly onDelete: (t: MailThread) => void;
  readonly onToggleCheck: (t: MailThread) => void;
}

export function ThreadItem({ thread, isSelected, isChecked, snoozeUntil, isInSnoozedFolder, hasDraft, onSelect, onToggleRead, onDelete, onToggleCheck }: ThreadItemProps) {
  const { t } = useTranslation();
  const { preference } = useTheme();
  const isDark = preference === 'dark';
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [isHovered, setIsHovered] = useState(false);

  const showTooltip = (e: React.MouseEvent, text: string) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({ text, x: rect.left + rect.width / 2, y: rect.top - 30 });
  };

  const isUnread = thread.unread_count > 0;
  const isSnoozed = isInSnoozedFolder || (!!snoozeUntil && new Date(snoozeUntil) > new Date());

  return (
    <div
      className={`mail-thread-item ${isSelected ? 'selected' : ''} ${isUnread ? 'unread' : ''} ${isChecked ? 'checked' : ''}`}
      onClick={() => onSelect(thread)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => { setIsHovered(false); setTooltip(null); }}
    >
      <div
        className={`mail-thread-item__avatar ${(isHovered || isChecked) ? 'mail-thread-item__avatar--checkbox' : ''}`}
        style={{ backgroundColor: (isHovered || isChecked) ? 'transparent' : avatarColor(thread.from_name || '') }}
        onClick={e => {
          if (isHovered || isChecked) {
            e.stopPropagation();
            onToggleCheck(thread);
          }
        }}
      >
        {(isHovered || isChecked) ? (
          <div className={`mail-thread-item__checkbox-box ${isChecked ? 'mail-thread-item__checkbox-box--checked' : ''}`}>
            {isChecked && <Check size={14} strokeWidth={3} />}
          </div>
        ) : (
          initials(thread.from_name || '')
        )}
      </div>

      <div className="mail-thread-item__content">
        <div className="mail-thread-item__top">
          <div className="mail-thread-item__from">
            <span style={{ color: senderColor(thread.from_name || '', isDark) }}>
              {thread.from_name}
            </span>
            {thread.message_count > 1 && (
              <span className="mail-thread-item__count">{thread.message_count}</span>
            )}
          </div>
          <div className="mail-thread-item__top-right">
            {thread.has_attachments && <Paperclip size={12} className="mail-thread-item__clip" />}
            {isSnoozed && (
              <span className="mail-thread-item__snooze-badge" title={snoozeUntil ? `${t('mail.snoozedUntil', "Mis en attente jusqu'au")} ${formatDate(snoozeUntil)}` : t('mail.snoozed', 'Mis en attente')}>
                <Clock size={10} />
              </span>
            )}
            <span className="mail-thread-item__date">{formatDate(thread.last_delivery_time)}</span>
          </div>
        </div>

        <div className="mail-thread-item__subject">{thread.topic || t('mail.noSubject', "(Pas d'objet)")}</div>
        <div className="mail-thread-item__snippet">
          {hasDraft && (
            <span className="mail-thread-item__draft-badge">{t('mail.draftBadge', 'Brouillon')}</span>
          )}
          <span className="mail-thread-item__snippet-text">{decodeHtmlEntities(thread.snippet)}</span>
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
