import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MailMessage, MailAttachment } from '../types';
import { MessageBlockHeader } from './MessageBlockHeader';
import { EmailHtmlBody } from './EmailHtmlBody';
import { AttachmentList } from './AttachmentList';
import { ICSInvitationCard } from './ICSInvitationCard';
import { useTranslation } from 'react-i18next';
import { CalendarClock } from 'lucide-react';

export interface MessageBlockProps {
  readonly message: MailMessage;
  readonly conversationId: string;
  readonly defaultExpanded?: boolean;
  readonly currentUserEmail?: string;
  readonly mailProviderType?: 'gmail' | 'ews';
  readonly provider?: import('../providers/MailProvider').MailProvider | null;
  readonly onMarkRead?: (msg: MailMessage) => void;
  readonly onReply: (msg: MailMessage) => void;
  readonly onReplyAll: (msg: MailMessage) => void;
  readonly onForward: (msg: MailMessage) => void;
  readonly onTrash: (id: string) => void;
  readonly onToggleRead: (msg: MailMessage) => void;
  readonly onPreviewAttachment: (att: MailAttachment) => void;
  readonly onDownloadAttachment: (att: MailAttachment) => void;
  readonly onGetAttachmentData: (att: MailAttachment) => Promise<string>;
  readonly loadingAttachmentId?: string | null;
  readonly isInScheduledFolder?: boolean;
  readonly onScheduledSendCanceled?: (message: MailMessage) => void;
}

function findScrollParent(el: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = el.parentElement;
  while (current && current !== document.body) {
    const { overflow, overflowY } = getComputedStyle(current);
    if (/auto|scroll/.test(overflow) || /auto|scroll/.test(overflowY)) return current;
    current = current.parentElement;
  }
  return null;
}

async function decodeInlineImages(html: string): Promise<void> {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const sources = [...document.querySelectorAll('img[src]')]
    .map(image => image.getAttribute('src'))
    .filter((source): source is string => !!source && source.startsWith('data:'));
  if (!sources.length) return;
  const decode = Promise.allSettled(sources.map(source => new Promise<void>(resolve => {
    const image = new Image();
    image.onload = () => { image.decode?.().catch(() => undefined).finally(resolve); };
    image.onerror = () => resolve();
    image.src = source;
  })));
  await Promise.race([decode, new Promise(resolve => setTimeout(resolve, 3000))]);
}

export function MessageBlock({
  message, conversationId, defaultExpanded = false, currentUserEmail, mailProviderType, provider,
  onMarkRead, onReply, onReplyAll, onForward, onTrash, onToggleRead,
  onPreviewAttachment, onDownloadAttachment, onGetAttachmentData, loadingAttachmentId,
  isInScheduledFolder = false, onScheduledSendCanceled,
}: MessageBlockProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [cancelingScheduled, setCancelingScheduled] = useState(false);
  const [scheduledCanceled, setScheduledCanceled] = useState(false);
  const blockRef = useRef<HTMLDivElement>(null);
  const markedRef = useRef(false);

  const contentQuery = useQuery({
    queryKey: ['mail', provider?.accountId, 'message-content', conversationId, message.item_id],
    queryFn: async () => {
      const content = await provider!.getMessageContent!(message.item_id, conversationId);
      void decodeInlineImages(content.body_html);
      return content;
    },
    enabled: isExpanded && message.body_loaded === false && !!provider?.getMessageContent,
    staleTime: Infinity,
    // Keep cached content for immediate paint, but validate it whenever the
    // message block is mounted again so a partial provider response cannot
    // poison the cache permanently.
    refetchOnMount: 'always',
    retry: false,
  });
  const displayedMessage = contentQuery.data ? { ...message, ...contentQuery.data, body_loaded: true } : message;
  const bodyLoading = isExpanded && displayedMessage.body_loaded === false && !contentQuery.isError;
  const scheduledQuery = useQuery({
    queryKey: ['mail-scheduled-send', provider?.accountId, message.item_id],
    queryFn: () => provider!.getScheduledSend!(message.item_id),
    enabled: isExpanded && isInScheduledFolder && !!provider?.getScheduledSend && !scheduledCanceled,
    staleTime: 30_000,
    retry: false,
  });
  const cancelScheduled = async () => {
    if (!scheduledQuery.data || !provider?.cancelScheduledSend) return;
    setCancelingScheduled(true);
    try {
      let draftMessage = displayedMessage;
      if (draftMessage.body_loaded === false && provider.getMessageContent) {
        const result = await contentQuery.refetch();
        if (result.data) draftMessage = { ...message, ...result.data, body_loaded: true };
      }
      await provider.cancelScheduledSend(scheduledQuery.data.submissionId);
      setScheduledCanceled(true);
      await queryClient.invalidateQueries({ queryKey: ['mail'] });
      onScheduledSendCanceled?.(draftMessage);
    } finally {
      setCancelingScheduled(false);
    }
  };
  const withContent = async (action: (loaded: MailMessage) => void) => {
    if (displayedMessage.body_loaded !== false) { action(displayedMessage); return; }
    const result = await contentQuery.refetch();
    if (result.data) action({ ...message, ...result.data, body_loaded: true });
  };

  useEffect(() => {
    if (message.is_read || markedRef.current || !isExpanded || !onMarkRead) return;
    const el = blockRef.current;
    if (!el) return;
    const root = findScrollParent(el);
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          observer.disconnect();
          markedRef.current = true;
          onMarkRead(message);
        }
      },
      { root, threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded, message.is_read, message.item_id]);

  const hasAttachments = displayedMessage.attachments && displayedMessage.attachments.length > 0;
  const icsAttachments = displayedMessage.attachments?.filter(
    att => att.content_type.includes('calendar') || att.name.toLowerCase().endsWith('.ics')
  ) ?? [];

  return (
    <div ref={blockRef} className={`mail-message-block${isExpanded ? ' expanded' : ''}${message.is_read ? '' : ' unread'}`}>
      <MessageBlockHeader
        message={message}
        expanded={isExpanded}
        onToggleExpand={() => setIsExpanded(!isExpanded)}
        onReply={() => void withContent(onReply)}
        onReplyAll={() => void withContent(onReplyAll)}
        onForward={() => void withContent(onForward)}
        onTrash={onTrash}
        onToggleRead={onToggleRead}
        provider={provider}
      />

      {isExpanded && scheduledQuery.data && !scheduledCanceled && (() => {
        const scheduledDate = new Date(scheduledQuery.data.scheduledAt);
        const remainingMs = scheduledDate.getTime() - Date.now();
        const remainingHours = Math.max(1, Math.round(remainingMs / 3_600_000));
        return <div className="mail-scheduled-banner">
          <CalendarClock size={26} className="mail-scheduled-banner__icon" />
          <div className="mail-scheduled-banner__content">
            <strong>{t('mail.willBeSentAt', 'Sera envoyé le {{date}}', { date: scheduledDate.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) })}</strong>
            <span>{remainingHours < 24
              ? t('mail.inHours', 'Dans {{count}} heure(s)', { count: remainingHours })
              : t('mail.inDaysHours', 'Dans {{days}} j {{hours}} h', { days: Math.floor(remainingHours / 24), hours: remainingHours % 24 })}</span>
          </div>
          <button type="button" className="mail-scheduled-banner__cancel" disabled={cancelingScheduled} onClick={() => void cancelScheduled()}>
            {cancelingScheduled ? t('mail.cancelingSend', 'Annulation…') : t('mail.cancelSend', 'Annuler l’envoi')}
          </button>
        </div>;
      })()}

      {isExpanded && (
        <div className="mail-message-block__body">
          {hasAttachments && (
            <AttachmentList
              attachments={displayedMessage.attachments}
              onPreview={onPreviewAttachment}
              onDownload={onDownloadAttachment}
              loadingAttachmentId={loadingAttachmentId}
            />
          )}
          {icsAttachments.map(att => (
            <ICSInvitationCard
              key={att.attachment_id}
              source={{ kind: 'attachment', attachment: att, getAttachmentData: onGetAttachmentData }}
              currentUserEmail={currentUserEmail}
              mailProviderType={mailProviderType}
              invitationHtml={displayedMessage.body_html}
              invitationText={displayedMessage.body_text}
            />
          ))}
          {displayedMessage.ics_mime && (
            <ICSInvitationCard
              key="ics_mime"
              source={{ kind: 'text', icsText: displayedMessage.ics_mime }}
              currentUserEmail={currentUserEmail}
              mailProviderType={mailProviderType}
              invitationHtml={displayedMessage.body_html}
              invitationText={displayedMessage.body_text}
            />
          )}
          {bodyLoading ? (
            <div className="mail-message-body-skeleton" aria-busy="true">
              <span /><span /><span /><span />
            </div>
          ) : contentQuery.isError ? (
            <div className="mail-message-body-error">
              <div>{contentQuery.error instanceof Error ? contentQuery.error.message : String(contentQuery.error)}</div>
              <button type="button" className="mail-message-body-retry" onClick={() => contentQuery.refetch()}>
                {t('mail.messageContentLoadError', 'Impossible de charger le message — réessayer')}
              </button>
            </div>
          ) : (
            <>
              <EmailHtmlBody html={displayedMessage.body_html || ''} bodyText={displayedMessage.body_text} />
              {message.body_loaded === false && contentQuery.data && (
                <button
                  type="button"
                  className="mail-message-body-reload"
                  disabled={contentQuery.isFetching}
                  onClick={() => void contentQuery.refetch()}
                >
                  {contentQuery.isFetching
                    ? t('mail.messageContentReloading', 'Rechargement…')
                    : t('mail.messageContentReload', 'Recharger le contenu')}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
