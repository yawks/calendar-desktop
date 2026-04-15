import { useState } from 'react';
import { MailThread } from '../types';
import {
  Archive, Clock, FolderInput, MoreHorizontal, Paperclip, ShieldAlert, Trash2, X
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FolderPickerPopover } from './FolderPickerPopover';
import { avatarColor, decodeHtmlEntities, formatDate, initials } from '../utils';

export interface MultiSelectionPanelProps {
  readonly threads: MailThread[];
  readonly selectedIds: Set<string>;
  readonly onClearSelection: () => void;
  readonly onBulkDelete: () => void;
  readonly onBulkArchive?: () => void;
  readonly onBulkSnooze: (until: string) => void;
  readonly onBulkMove: (folderId: string) => void;
  readonly onBulkToggleRead: (markAsRead: boolean) => void;
  readonly moveFolders: import('../types').MailFolder[];
  readonly supportsSnooze: boolean;
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

export function MultiSelectionPanel({
  threads, selectedIds, onClearSelection, onBulkDelete, onBulkArchive,
  onBulkSnooze, onBulkMove, onBulkToggleRead, moveFolders, supportsSnooze
}: MultiSelectionPanelProps) {
  const { t } = useTranslation();
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const selectedThreads = threads.filter(t => selectedIds.has(t.conversation_id));
  const count = selectedIds.size;
  const allUnread = selectedThreads.every(t => t.unread_count > 0);

  const { laterToday, tomorrowMorning, tomorrowAfternoon, nextWeek } = computeSnoozeOptions();
  const laterTodayLabel = laterToday.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const nextWeekDayName = FR_DAYS[nextWeek.getDay()];

  return (
    <div className="mail-thread-detail">
      {/* Toolbar */}
      <div className="mail-thread-detail__toolbar">
        <button className="mail-detail-action-btn" onClick={onBulkArchive} title={t('mail.archive', 'Archive')}>
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
              <button type="button" aria-label="Close" className="mail-thread-toolbar__overlay" onClick={() => setSnoozeOpen(false)} />
              <div className="mail-actions-menu mail-snooze-menu">
                <button className="mail-actions-menu__item" onClick={() => { onBulkSnooze(laterToday.toISOString()); setSnoozeOpen(false); }}>
                  Plus tard aujourd'hui · {laterTodayLabel}
                </button>
                <button className="mail-actions-menu__item" onClick={() => { onBulkSnooze(tomorrowMorning.toISOString()); setSnoozeOpen(false); }}>
                  Demain matin · 9:00
                </button>
                <button className="mail-actions-menu__item" onClick={() => { onBulkSnooze(tomorrowAfternoon.toISOString()); setSnoozeOpen(false); }}>
                  Demain après-midi · 14:00
                </button>
                <button className="mail-actions-menu__item" onClick={() => { onBulkSnooze(nextWeek.toISOString()); setSnoozeOpen(false); }}>
                  La semaine prochaine {nextWeekDayName} · 9:00
                </button>
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
              <button type="button" aria-label="Close" className="mail-thread-toolbar__overlay" onClick={() => setMoveOpen(false)} />
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
              <button type="button" aria-label="Close" className="mail-thread-toolbar__overlay" onClick={() => setMoreOpen(false)} />
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
