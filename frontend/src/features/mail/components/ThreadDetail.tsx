import { useEffect, useRef, useState } from 'react';
import { MailThread, MailMessage, MailAttachment, ComposerRestoreData } from '../types';
import {
  Archive, Clock, FolderInput, Forward, MoreHorizontal, ShieldAlert, Trash2
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ComposerAttachment } from '../providers/MailProvider';
import { formatFullDate } from '../utils';
import { MessageBlock } from './MessageBlock';
import { CollapsedMessagesBar } from './CollapsedMessagesBar';
import { MailComposer } from './MailComposer';
import { FolderPickerPopover } from './FolderPickerPopover';

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
  thread, messages, replyingTo, contacts, currentUserEmail, mailProviderType,
  onMarkRead, onTrash,
  onPreviewAttachment, onDownloadAttachment, onGetAttachmentData,
  onReply, onReplyAll, onForward, onToggleRead,
  replyMode, onCancelReply, onSaveDraft, onSend, composerRestoreData,
  onDeleteThread, onToggleThreadRead,
  supportsSnooze, onSnooze, snoozeUntil, onUnsnooze,
  moveFolders, onMove,
}: ThreadDetailProps) {
  const { t } = useTranslation();
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const composerAnchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unread = messages.filter(m => !m.is_read);
    if (unread.length > 0) onMarkRead(unread);
  }, [messages, onMarkRead]);

  useEffect(() => {
    if (!replyingTo) return;
    // Defer until the browser has painted the newly mounted composer
    const raf = requestAnimationFrame(() => {
      composerAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(raf);
  }, [replyingTo]);

  const [middleExpanded, setMiddleExpanded] = useState(false);

  const { laterToday, tomorrowMorning, tomorrowAfternoon, nextWeek } = computeSnoozeOptions();
  const laterTodayLabel = laterToday.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const nextWeekDayName = FR_DAYS[nextWeek.getDay()];

  const isUnread = thread.unread_count > 0;
  const isSnoozed = !!snoozeUntil && new Date(snoozeUntil) > new Date();
  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;

  return (
    <div className="mail-thread-detail">
      <div className="mail-thread-detail__toolbar">
        {/* Archive */}
        <button className="mail-detail-action-btn" onClick={() => {}} title={t('mail.archive', 'Archive')}>
          <Archive size={15} />
          <span>{t('mail.archive', 'Archive')}</span>
        </button>

        {/* Delete */}
        <button
          className="mail-detail-action-btn mail-detail-action-btn--danger"
          onClick={onDeleteThread}
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
                <button className="mail-actions-menu__item" onClick={() => { onSnooze(laterToday.toISOString()); setSnoozeOpen(false); }}>
                  Plus tard aujourd'hui · {laterTodayLabel}
                </button>
                <button className="mail-actions-menu__item" onClick={() => { onSnooze(tomorrowMorning.toISOString()); setSnoozeOpen(false); }}>
                  Demain matin · 9:00
                </button>
                <button className="mail-actions-menu__item" onClick={() => { onSnooze(tomorrowAfternoon.toISOString()); setSnoozeOpen(false); }}>
                  Demain après-midi · 14:00
                </button>
                <button className="mail-actions-menu__item" onClick={() => { onSnooze(nextWeek.toISOString()); setSnoozeOpen(false); }}>
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
                onSelect={folderId => { onMove(folderId); setMoveOpen(false); }}
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
        <h2 className="mail-thread-detail__subject">{thread.topic || t('mail.noSubject', "(Pas d'objet)")}</h2>
        {isSnoozed && snoozeUntil && (
          <div className="mail-snooze-banner">
            <Clock size={22} className="mail-snooze-banner__icon" />
            <span className="mail-snooze-banner__text">
              {t('mail.snoozedUntil', "En attente jusqu'au")}{' '}
              <strong>{formatFullDate(snoozeUntil)}</strong>
            </span>
            <button className="mail-snooze-banner__btn" onClick={onUnsnooze}>
              {t('mail.clickToUnsnooze', 'Annuler')}
            </button>
          </div>
        )}
      </div>

      <div className="mail-thread-detail__messages">
        {messages.length > 5 && !middleExpanded ? (
          <>
            <CollapsedMessagesBar
              messages={messages.slice(0, messages.length - 1)}
              onExpand={() => setMiddleExpanded(true)}
            />
            <MessageBlock
              message={messages[messages.length - 1]}
              defaultExpanded={true}
              currentUserEmail={currentUserEmail}
              mailProviderType={mailProviderType}
              onReply={onReply}
              onReplyAll={onReplyAll}
              onForward={onForward}
              onTrash={onTrash}
              onToggleRead={onToggleRead}
              onPreviewAttachment={onPreviewAttachment}
              onDownloadAttachment={onDownloadAttachment}
              onGetAttachmentData={onGetAttachmentData}
            />
          </>
        ) : (
          messages.map((msg, idx) => (
            <MessageBlock
              key={msg.item_id}
              message={msg}
              defaultExpanded={idx === messages.length - 1}
              currentUserEmail={currentUserEmail}
              mailProviderType={mailProviderType}
              onReply={onReply}
              onReplyAll={onReplyAll}
              onForward={onForward}
              onTrash={onTrash}
              onToggleRead={onToggleRead}
              onPreviewAttachment={onPreviewAttachment}
              onDownloadAttachment={onDownloadAttachment}
              onGetAttachmentData={onGetAttachmentData}
            />
          ))
        )}

        {replyingTo && (
          <div ref={composerAnchorRef} className="mail-thread-detail__composer-anchor">
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
