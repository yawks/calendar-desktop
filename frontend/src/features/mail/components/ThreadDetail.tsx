import { useEffect, useState } from 'react';
import { MailThread, MailMessage, MailAttachment, ComposerRestoreData } from '../types';
import {
  Archive, Clock, FolderInput, Mail as MailIcon, MailOpen, Trash2
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ComposerAttachment } from '../providers/MailProvider';
import { formatFullDate } from '../utils';
import { MessageBlock } from './MessageBlock';
import { CollapsedMessagesBar } from './CollapsedMessagesBar';
import { MailComposer } from './MailComposer';
import { FolderPickerPopover } from './FolderPickerPopover';
import React from 'react';

export interface ThreadDetailProps {
  readonly thread: MailThread;
  readonly messages: MailMessage[];
  readonly replyingTo: MailMessage | null;
  readonly contacts: { email: string; name?: string }[];
  readonly currentUserEmail?: string;
  readonly mailProviderType?: 'gmail' | 'ews';
  readonly onMarkRead: (msgs: MailMessage[]) => void;
  readonly onTrash: (id: string) => void;
  readonly onPreviewAttachment: (att: MailAttachment) => void;
  readonly onDownloadAttachment: (att: MailAttachment) => void;
  readonly onGetAttachmentData: (att: MailAttachment) => Promise<string>;
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
  readonly moveFolders: import('../types').MailFolder[];
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

export function ThreadDetail({
  thread, messages, replyingTo, contacts, currentUserEmail, onMarkRead, onTrash,
  onPreviewAttachment, onDownloadAttachment, onGetAttachmentData,
  onReply, onReplyAll, onForward, onToggleRead,
  replyMode, onCancelReply, onSaveDraft, onSend, composerRestoreData,
  onDeleteThread, onToggleThreadRead,
  supportsSnooze, onSnooze, snoozeUntil, onUnsnooze,
  moveFolders, onMove,
}: ThreadDetailProps) {
  const { t } = useTranslation();
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false);
  const [showMoveMenu, setShowMoveMenu] = useState(false);

  useEffect(() => {
    const unread = messages.filter(m => !m.is_read);
    if (unread.length > 0) onMarkRead(unread);
  }, [messages, onMarkRead]);

  const displayCount = messages.length;
  const isCollapsed = displayCount > 3;
  const [expanded, setExpanded] = useState(false);

  const visibleMessages = (isCollapsed && !expanded)
    ? [messages[0], ...messages.slice(-2)]
    : messages;

  const { laterToday, tomorrowMorning, tomorrowAfternoon, nextWeek } = computeSnoozeOptions();

  const isThreadUnread = thread.unread_count > 0;
  const isSnoozed = !!snoozeUntil && new Date(snoozeUntil) > new Date();

  return (
    <div className="mail-thread-detail">
      <div className="mail-thread-detail__toolbar">
        <div className="mail-thread-detail__actions">
          <div style={{ position: 'relative' }}>
            <button
              className="mail-thread-detail__action-btn"
              onClick={() => setShowMoveMenu(!showMoveMenu)}
              title={t('mail.moveToFolder', 'Déplacer vers un dossier')}
            >
              <FolderInput size={18} />
              <span>{t('mail.move', 'Déplacer')}</span>
            </button>
            {showMoveMenu && (
              <FolderPickerPopover
                folders={moveFolders}
                onSelect={(fid) => { onMove(fid); setShowMoveMenu(false); }}
                onClose={() => setShowMoveMenu(false)}
              />
            )}
          </div>

          <button className="mail-thread-detail__action-btn" onClick={onDeleteThread} title={t('mail.deleteThread', 'Supprimer la conversation')}>
            <Trash2 size={18} />
            <span>{t('mail.delete', 'Supprimer')}</span>
          </button>
          <button className="mail-thread-detail__action-btn" onClick={() => {/* TODO */}} title={t('mail.archiveThread', 'Archiver')}>
            <Archive size={18} />
            <span>{t('mail.archive', 'Archiver')}</span>
          </button>
          <button className="mail-thread-detail__action-btn" onClick={onToggleThreadRead} title={isThreadUnread ? t('mail.markAsRead', 'Marquer comme lu') : t('mail.markAsUnread', 'Marquer comme non lu')}>
            {isThreadUnread ? <MailOpen size={18} /> : <MailIcon size={18} />}
            <span>{isThreadUnread ? t('mail.markAsRead', 'Marquer comme lu') : t('mail.markAsUnread', 'Marquer comme non lu')}</span>
          </button>

          {supportsSnooze && (
            <div style={{ position: 'relative' }}>
              <button
                className={`mail-thread-detail__action-btn ${isSnoozed ? 'active' : ''}`}
                onClick={() => setShowSnoozeMenu(!showSnoozeMenu)}
                title={t('mail.snooze', 'Mettre en attente')}
              >
                <Clock size={18} />
                <span>{t('mail.snooze', 'En attente')}</span>
              </button>
              {showSnoozeMenu && (
                <div className="mail-snooze-menu">
                  <div className="mail-snooze-menu__item" onClick={() => { onSnooze(laterToday.toISOString()); setShowSnoozeMenu(false); }}>
                    <span>{t('mail.laterToday', 'Plus tard aujourd’hui')}</span>
                    <span className="mail-snooze-menu__date">{FR_DAYS[laterToday.getDay()]} {laterToday.getHours()}h</span>
                  </div>
                  <div className="mail-snooze-menu__item" onClick={() => { onSnooze(tomorrowMorning.toISOString()); setShowSnoozeMenu(false); }}>
                    <span>{t('mail.tomorrowMorning', 'Demain matin')}</span>
                    <span className="mail-snooze-menu__date">{FR_DAYS[tomorrowMorning.getDay()]} 09:00</span>
                  </div>
                  <div className="mail-snooze-menu__item" onClick={() => { onSnooze(tomorrowAfternoon.toISOString()); setShowSnoozeMenu(false); }}>
                    <span>{t('mail.tomorrowAfternoon', 'Demain après-midi')}</span>
                    <span className="mail-snooze-menu__date">{FR_DAYS[tomorrowAfternoon.getDay()]} {tomorrowAfternoon.getHours()}:00</span>
                  </div>
                  <div className="mail-snooze-menu__item" onClick={() => { onSnooze(nextWeek.toISOString()); setShowSnoozeMenu(false); }}>
                    <span>{t('mail.nextWeek', 'La semaine prochaine')}</span>
                    <span className="mail-snooze-menu__date">{FR_DAYS[nextWeek.getDay()]} 09:00</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mail-thread-detail__header">
        <h2 className="mail-thread-detail__subject">{thread.topic || t('mail.noSubject', '(Pas d’objet)')}</h2>
        {isSnoozed && (
          <div className="mail-thread-detail__snooze-badge" onClick={onUnsnooze} title={t('mail.clickToUnsnooze', 'Cliquer pour annuler l’attente')}>
            <Clock size={12} />
            <span>{t('mail.snoozedUntil', 'En attente jusqu’au')} {formatFullDate(snoozeUntil!)}</span>
          </div>
        )}
      </div>

      <div className="mail-thread-detail__messages">
        {visibleMessages.map((msg, idx) => (
          <React.Fragment key={msg.item_id}>
            {idx === 1 && isCollapsed && !expanded && (
              <CollapsedMessagesBar
                messages={messages.slice(1, -2)}
                onExpand={() => setExpanded(true)}
              />
            )}
            <MessageBlock
              message={msg}
              onReply={onReply}
              onReplyAll={onReplyAll}
              onForward={onForward}
              onTrash={onTrash}
              onToggleRead={onToggleRead}
              onPreviewAttachment={onPreviewAttachment}
              onDownloadAttachment={onDownloadAttachment}
              onGetAttachmentData={onGetAttachmentData}
            />
          </React.Fragment>
        ))}

        {replyingTo && (
          <div className="mail-thread-detail__composer-anchor">
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
