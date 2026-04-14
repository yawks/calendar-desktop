import { useState } from 'react';
import { MailThread } from '../types';
import { Archive, BellOff, Check, Clock, Mail as MailIcon, MailOpen, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { useTheme } from '../../../shared/store/ThemeStore';
import { avatarColor, formatDate, initials, senderColor } from '../utils';

export interface ThreadItemProps {
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

export function ThreadItem({ thread, isSelected, isChecked, snoozeUntil, isInSnoozedFolder, onSelect, onToggleRead, onDelete, onToggleCheck }: ThreadItemProps) {
  const { t } = useTranslation();
  const { preference } = useTheme();
  const isDark = preference === 'dark';
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);

  const showTooltip = (e: React.MouseEvent, text: string) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({ text, x: rect.left + rect.width / 2, y: rect.top - 30 });
  };

  const isUnread = thread.unread_count > 0;
  const isSnoozed = !!snoozeUntil && new Date(snoozeUntil) > new Date();

  return (
    <div
      className={`mail-thread-item ${isSelected ? 'selected' : ''} ${isUnread ? 'unread' : ''} ${isChecked ? 'checked' : ''}`}
      onClick={() => onSelect(thread)}
    >
      <div
        className="mail-thread-item__checkbox-area"
        onClick={e => { e.stopPropagation(); onToggleCheck(thread); }}
      >
        <div className={`mail-thread-item__checkbox ${isChecked ? 'checked' : ''}`}>
          {isChecked && <Check size={12} />}
        </div>
      </div>

      <div className="mail-thread-item__avatar" style={{ backgroundColor: avatarColor(thread.from_name || '') }}>
        {initials(thread.from_name || '')}
      </div>

      <div className="mail-thread-item__content">
        <div className="mail-thread-item__top-row">
          <span className="mail-thread-item__sender" style={{ color: senderColor(thread.from_name || '', isDark) }}>
            {thread.from_name}
          </span>
          <span className="mail-thread-item__date">{formatDate(thread.last_delivery_time)}</span>
        </div>
        <div className="mail-thread-item__subject">{thread.topic || t('mail.noSubject', '(Pas d’objet)')}</div>
        <div className="mail-thread-item__snippet">{thread.snippet}</div>

        <div className="mail-thread-item__badges">
          {isSnoozed && (
            <div className="mail-thread-item__badge mail-thread-item__badge--snooze" title={`${t('mail.snoozedUntil', 'Mis en attente jusqu’au')} ${formatDate(snoozeUntil!)}`}>
              <Clock size={12} />
              <span>{formatDate(snoozeUntil!)}</span>
            </div>
          )}
          {isInSnoozedFolder && isSnoozed && (
             <div className="mail-thread-item__badge mail-thread-item__badge--snooze-folder">
                <BellOff size={12} />
             </div>
          )}
        </div>
      </div>

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
          onClick={e => { e.stopPropagation(); /* TODO: Archive */ }}
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
