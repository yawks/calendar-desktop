import { MailMessage } from '../../types';
import { MessageBlockHeader } from '../MessageBlockHeader';
import { EmailHtmlBody } from './EmailHtmlBody';
import { AttachmentItem } from './AttachmentItem';
import { ICSInvitationCard } from '../ICSInvitationCard';

interface MessageBlockProps {
  readonly msg: MailMessage;
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
  readonly onReply: (msg: MailMessage, all: boolean) => void;
  readonly onForward: (msg: MailMessage) => void;
  readonly onImageClick: (src: string) => void;
  readonly onDownloadAttachment: (att: any) => void;
  readonly onGetAttachmentData: (att: any) => Promise<string>;
  readonly onTrash: (itemId: string) => void;
  readonly onToggleRead: (msg: MailMessage) => void;
  readonly onComposeToContact?: (contact: { email: string; name: string | null }) => void;
  readonly currentUserEmail?: string;
  readonly mailProviderType?: 'gmail' | 'ews';
}

export function MessageBlock({
  msg,
  isExpanded,
  onToggle,
  onReply,
  onForward,
  onImageClick,
  onDownloadAttachment,
  onGetAttachmentData,
  onTrash,
  onToggleRead,
  onComposeToContact,
  currentUserEmail,
  mailProviderType,
}: MessageBlockProps) {
  const icsAttachments = msg.attachments.filter(a => a.name.toLowerCase().endsWith('.ics'));
  const otherAttachments = msg.attachments.filter(a => !a.name.toLowerCase().endsWith('.ics'));

  return (
    <div className={`mail-message${isExpanded ? ' mail-message--expanded' : ''}`}>
      <MessageBlockHeader
        message={msg}
        expanded={isExpanded}
        onToggleExpand={onToggle}
        onReply={() => onReply(msg, false)}
        onReplyAll={() => onReply(msg, true)}
        onForward={() => onForward(msg)}
        onTrash={onTrash}
        onToggleRead={onToggleRead}
        onComposeToContact={onComposeToContact}
      />

      {isExpanded && (
        <div className="mail-message__content">
          <EmailHtmlBody html={msg.body_html} onImageClick={onImageClick} />

          {icsAttachments.map((att, i) => (
            <ICSInvitationCard
               key={i}
               source={{ kind: 'attachment', attachment: att, getAttachmentData: onGetAttachmentData }}
               currentUserEmail={currentUserEmail}
               mailProviderType={mailProviderType}
            />
          ))}

          {otherAttachments.length > 0 && (
            <div className="mail-message__attachments">
              {otherAttachments.map((att, i) => (
                <AttachmentItem
                  key={i}
                  att={att}
                  onDownload={onDownloadAttachment}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
