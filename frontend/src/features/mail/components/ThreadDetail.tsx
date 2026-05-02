import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MailThread, MailMessage, MailAttachment, MailIdentity, ComposerRestoreData } from '../types';
import {
  AlarmClock, Archive, Clock, FolderInput, Forward, MoreHorizontal, ShieldAlert, Trash2
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ComposerAttachment } from '../providers/MailProvider';
import { MessageBlock } from './MessageBlock';
import { CollapsedMessagesBar } from './CollapsedMessagesBar';
import { MailComposer, MailComposerHandle } from './MailComposer';
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
  readonly identities?: MailIdentity[];
  readonly selectedIdentityId?: string;
  readonly onIdentityChange?: (id: string) => void;
  readonly onSend: (to: string[], cc: string[], bcc: string[], subject: string, body: string, attachments: ComposerAttachment[], fromIdentityId?: string) => Promise<void>;
  readonly composerRestoreData?: ComposerRestoreData | null;
  readonly onDeleteThread: () => void;
  readonly onToggleThreadRead: () => void;
  readonly supportsSnooze: boolean;
  readonly onSnooze: (snoozeUntil: string) => void;
  readonly snoozeUntil?: string;
  readonly isInSnoozedFolder?: boolean;
  readonly onUnsnooze: () => void;
  readonly moveFolders: import('../types').MailFolder[];
  readonly onMove: (folderId: string) => void;
  readonly composerRef?: React.RefObject<MailComposerHandle>;
}

const FR_DAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

function formatSnoozeDate(iso: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const target = new Date(iso);
  const now = new Date();
  const diffMs = target.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60000);
  const diffHours = Math.round(diffMs / 3600000);

  const timeStr = target.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (diffMin < 60) {
    return t('mail.snoozeInMinutes', { count: Math.max(1, diffMin), defaultValue: `in ${Math.max(1, diffMin)} minute(s)` });
  }
  if (diffHours < 6) {
    return t('mail.snoozeInHours', { count: diffHours, defaultValue: `in ${diffHours} hour(s)` });
  }

  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart); tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const dayAfterStart = new Date(tomorrowStart); dayAfterStart.setDate(dayAfterStart.getDate() + 1);

  if (target >= todayStart && target < tomorrowStart) {
    return t('mail.snoozeTodayAt', { time: timeStr, defaultValue: `today at ${timeStr}` });
  }
  if (target >= tomorrowStart && target < dayAfterStart) {
    return t('mail.snoozeTomorrowAt', { time: timeStr, defaultValue: `tomorrow at ${timeStr}` });
  }

  const dateStr = target.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return t('mail.snoozeDateAt', { date: dateStr, time: timeStr, defaultValue: `${dateStr} at ${timeStr}` });
}

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
  identities, selectedIdentityId, onIdentityChange,
  onMarkRead, onTrash,
  onPreviewAttachment, onDownloadAttachment, onGetAttachmentData,
  onReply, onReplyAll, onForward, onToggleRead,
  replyMode, onCancelReply, onSaveDraft, onSend, composerRestoreData,
  onDeleteThread, onToggleThreadRead,
  supportsSnooze, onSnooze, snoozeUntil, isInSnoozedFolder, onUnsnooze,
  moveFolders, onMove, composerRef,
}: ThreadDetailProps) {
  const { t } = useTranslation();
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [snoozeMode, setSnoozeMode] = useState<'menu' | 'custom'>('menu');
  const [customSnoozeValue, setCustomSnoozeValue] = useState('');
  const [moveOpen, setMoveOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [snoozeBannerDismissed, setSnoozeBannerDismissed] = useState(false);

  useEffect(() => { setSnoozeBannerDismissed(false); }, [thread.conversation_id]);
  const composerAnchorRef = useRef<HTMLDivElement>(null);

  const handleMarkSingleRead = useCallback((msg: MailMessage) => {
    onMarkRead([msg]);
  }, [onMarkRead]);

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
  const isSnoozed = !snoozeBannerDismissed && (isInSnoozedFolder || (!!snoozeUntil && new Date(snoozeUntil) > new Date()));
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
            onClick={() => {
              if (!supportsSnooze) return;
              if (snoozeOpen) { setSnoozeOpen(false); setSnoozeMode('menu'); }
              else { setSnoozeOpen(true); setSnoozeMode('menu'); }
            }}
            title={t('mail.snooze', 'Snooze')}
          >
            <Clock size={15} />
            <span>{t('mail.snooze', 'Snooze')}</span>
          </button>
          {snoozeOpen && supportsSnooze && (
            <>
              <button type="button" aria-label="Close" className="mail-thread-toolbar__overlay" onClick={() => { setSnoozeOpen(false); setSnoozeMode('menu'); }} />
              <div className="mail-actions-menu mail-snooze-menu">
                {snoozeMode === 'menu' ? (
                  <>
                    <button className="mail-actions-menu__item" onClick={() => { onSnooze(laterToday.toISOString()); setSnoozeOpen(false); setSnoozeMode('menu'); }}>
                      {t('mail.laterToday', 'Plus tard aujourd\'hui')} · {laterTodayLabel}
                    </button>
                    <button className="mail-actions-menu__item" onClick={() => { onSnooze(tomorrowMorning.toISOString()); setSnoozeOpen(false); setSnoozeMode('menu'); }}>
                      {t('mail.tomorrowMorning', 'Demain matin')} · 9:00
                    </button>
                    <button className="mail-actions-menu__item" onClick={() => { onSnooze(tomorrowAfternoon.toISOString()); setSnoozeOpen(false); setSnoozeMode('menu'); }}>
                      {t('mail.tomorrowAfternoon', 'Demain après-midi')} · 14:00
                    </button>
                    <button className="mail-actions-menu__item" onClick={() => { onSnooze(nextWeek.toISOString()); setSnoozeOpen(false); setSnoozeMode('menu'); }}>
                      {t('mail.nextWeek', 'La semaine prochaine')} {nextWeekDayName} · 9:00
                    </button>
                    <div className="mail-actions-menu__separator" />
                    <button className="mail-actions-menu__item" onClick={() => setSnoozeMode('custom')}>
                      <Clock size={13} />
                      {t('mail.snoozeChooseDateTime', 'Choisir une date et une heure')}
                    </button>
                  </>
                ) : (
                  <div className="mail-snooze-custom">
                    <div className="mail-snooze-custom__fields">
                      <input
                        type="datetime-local"
                        value={customSnoozeValue}
                        min={new Date().toISOString().slice(0, 16)}
                        onChange={e => setCustomSnoozeValue(e.target.value)}
                      />
                    </div>
                    <div className="mail-snooze-custom__actions">
                      <button onClick={() => { setSnoozeOpen(false); setSnoozeMode('menu'); setCustomSnoozeValue(''); }}>
                        {t('mail.cancel', 'Annuler')}
                      </button>
                      <button
                        className="mail-snooze-custom__ok"
                        disabled={!customSnoozeValue}
                        onClick={() => {
                          if (customSnoozeValue) {
                            onSnooze(new Date(customSnoozeValue).toISOString());
                            setSnoozeOpen(false);
                            setSnoozeMode('menu');
                            setCustomSnoozeValue('');
                          }
                        }}
                      >
                        {t('mail.snoozeOk', 'OK')}
                      </button>
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
      </div>

      {isSnoozed && (
        <div className="mail-snooze-banner">
          <AlarmClock size={18} className="mail-snooze-banner__icon" />
          <span className="mail-snooze-banner__text">
            {snoozeUntil
              ? <>{t('mail.snoozedUntilLabel', 'Snoozed until')}{' '}<strong>{formatSnoozeDate(snoozeUntil, t)}</strong></>
              : t('mail.snoozed', 'Snoozed')}
          </span>
          <button className="mail-snooze-banner__btn" onClick={() => { setSnoozeBannerDismissed(true); onUnsnooze(); }}>
            {t('mail.unsnooze', 'Unsnooze')}
          </button>
        </div>
      )}

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
              onMarkRead={handleMarkSingleRead}
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
              defaultExpanded={!msg.is_read || idx === messages.length - 1}
              currentUserEmail={currentUserEmail}
              mailProviderType={mailProviderType}
              onMarkRead={handleMarkSingleRead}
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

        {(replyingTo || composerRestoreData) && (
          <div ref={composerAnchorRef} className="mail-thread-detail__composer-anchor">
            <MailComposer
              ref={composerRef}
              replyTo={replyingTo ?? (composerRestoreData?.replyingToMsg ?? undefined)}
              mode={replyMode}
              contacts={contacts}
              currentUserEmail={currentUserEmail}
              restoreData={composerRestoreData}
              identities={identities}
              selectedIdentityId={selectedIdentityId}
              onIdentityChange={onIdentityChange}
              onGetAttachmentData={onGetAttachmentData}
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
