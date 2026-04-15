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
  readonly onReply: (msg: MailMessage) => void;
  readonly onReplyAll: (msg: MailMessage) => void;
  readonly onForward: (msg: MailMessage) => void;
  readonly onTrash: (id: string) => void;
  readonly onToggleRead: (msg: MailMessage) => void;
  readonly onPreviewAttachment: (att: MailAttachment) => void;
  readonly onDownloadAttachment: (att: MailAttachment) => void;
  readonly onGetAttachmentData: (att: MailAttachment) => Promise<string>;
}

export function MessageBlock({
  message, defaultExpanded = false, currentUserEmail, mailProviderType,
  onReply, onReplyAll, onForward, onTrash, onToggleRead,
  onPreviewAttachment, onDownloadAttachment, onGetAttachmentData,
}: MessageBlockProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const markedRef = useRef(false);

  useEffect(() => {
    if (message.is_read || markedRef.current || !isExpanded) return;
    markedRef.current = true;
  }, [isExpanded, message.is_read]);

  const hasAttachments = message.attachments && message.attachments.length > 0;
  const icsAttachments = message.attachments?.filter(
    att => att.content_type.includes('calendar') || att.name.toLowerCase().endsWith('.ics')
  ) ?? [];

  return (
    <div className={`mail-message-block${isExpanded ? ' expanded' : ''}${message.is_read ? '' : ' unread'}`}>
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
          <EmailHtmlBody html={message.body_html || ''} />
        </div>
      )}
    </div>
  );
}
