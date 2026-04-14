import { useState } from 'react';
import { MailMessage, MailAttachment } from '../types';
import { MessageBlockHeader } from './MessageBlockHeader';
import { EmailHtmlBody } from './EmailHtmlBody';
import { AttachmentList } from './AttachmentList';

export interface MessageBlockProps {
  readonly message: MailMessage;
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
  message, onReply, onReplyAll, onForward, onTrash, onToggleRead,
  onPreviewAttachment, onDownloadAttachment,
}: MessageBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const hasAttachments = message.attachments && message.attachments.length > 0;

  return (
    <div className={`mail-message-block ${isExpanded ? 'expanded' : 'collapsed'}`}>
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
          <EmailHtmlBody html={message.body_html || ''} />

          {hasAttachments && (
            <AttachmentList
              attachments={message.attachments}
              onPreview={onPreviewAttachment}
              onDownload={onDownloadAttachment}
            />
          )}
        </div>
      )}
    </div>
  );
}
