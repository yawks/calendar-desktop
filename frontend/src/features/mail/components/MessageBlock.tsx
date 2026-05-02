import { useEffect, useRef, useState } from 'react';
import { MailMessage, MailAttachment } from '../types';
import { MessageBlockHeader } from './MessageBlockHeader';
import { EmailHtmlBody } from './EmailHtmlBody';
import { AttachmentList } from './AttachmentList';
import { ICSInvitationCard } from './ICSInvitationCard';

export interface MessageBlockProps {
  readonly message: MailMessage;
  readonly defaultExpanded?: boolean;
  readonly currentUserEmail?: string;
  readonly mailProviderType?: 'gmail' | 'ews';
  readonly onMarkRead?: (msg: MailMessage) => void;
  readonly onReply: (msg: MailMessage) => void;
  readonly onReplyAll: (msg: MailMessage) => void;
  readonly onForward: (msg: MailMessage) => void;
  readonly onTrash: (id: string) => void;
  readonly onToggleRead: (msg: MailMessage) => void;
  readonly onPreviewAttachment: (att: MailAttachment) => void;
  readonly onDownloadAttachment: (att: MailAttachment) => void;
  readonly onGetAttachmentData: (att: MailAttachment) => Promise<string>;
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

export function MessageBlock({
  message, defaultExpanded = false, currentUserEmail, mailProviderType,
  onMarkRead, onReply, onReplyAll, onForward, onTrash, onToggleRead,
  onPreviewAttachment, onDownloadAttachment, onGetAttachmentData,
}: MessageBlockProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const blockRef = useRef<HTMLDivElement>(null);
  const markedRef = useRef(false);

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

  const hasAttachments = message.attachments && message.attachments.length > 0;
  const icsAttachments = message.attachments?.filter(
    att => att.content_type.includes('calendar') || att.name.toLowerCase().endsWith('.ics')
  ) ?? [];

  return (
    <div ref={blockRef} className={`mail-message-block${isExpanded ? ' expanded' : ''}${message.is_read ? '' : ' unread'}`}>
      <MessageBlockHeader
        message={message}
        expanded={isExpanded}
        onToggleExpand={() => setIsExpanded(!isExpanded)}
        onReply={onReply}
        onReplyAll={onReplyAll}
        onForward={onForward}
        onTrash={onTrash}
        onToggleRead={onToggleRead}
      />

      {isExpanded && (
        <div className="mail-message-block__body">
          {hasAttachments && (
            <AttachmentList
              attachments={message.attachments}
              onPreview={onPreviewAttachment}
              onDownload={onDownloadAttachment}
            />
          )}
          {icsAttachments.map(att => (
            <ICSInvitationCard
              key={att.attachment_id}
              source={{ kind: 'attachment', attachment: att, getAttachmentData: onGetAttachmentData }}
              currentUserEmail={currentUserEmail}
              mailProviderType={mailProviderType}
            />
          ))}
          {message.ics_mime && (
            <ICSInvitationCard
              key="ics_mime"
              source={{ kind: 'text', icsText: message.ics_mime }}
              currentUserEmail={currentUserEmail}
              mailProviderType={mailProviderType}
            />
          )}
          <EmailHtmlBody html={message.body_html || ''} bodyText={message.body_text} />
        </div>
      )}
    </div>
  );
}
