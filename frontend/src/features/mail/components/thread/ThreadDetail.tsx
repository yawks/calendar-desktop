import { Archive, BellOff, FolderInput, MoreHorizontal, Trash2, X } from 'lucide-react';
import { MailMessage, MailThread } from '../../types';
import { MessageBlock } from './MessageBlock';

interface ThreadDetailProps {
  readonly thread: MailThread;
  readonly messages: MailMessage[];
  readonly messagesLoading: boolean;
  readonly onReply: (msg: MailMessage, all: boolean) => void;
  readonly onForward: (msg: MailMessage) => void;
  readonly onArchive: () => void;
  readonly onDelete: () => void;
  readonly onSnooze: () => void;
  readonly onMove: () => void;
  readonly onClose: () => void;
  readonly onImageClick: (src: string) => void;
  readonly onDownloadAttachment: (att: any) => void;
  readonly onGetAttachmentData: (att: any) => Promise<string>;
  readonly onTrash: (itemId: string) => void;
  readonly onToggleRead: (msg: MailMessage) => void;
  readonly onComposeToContact?: (contact: { email: string; name: string | null }) => void;
  readonly currentUserEmail?: string;
  readonly mailProviderType?: 'gmail' | 'ews';
}

export function ThreadDetail({
  thread,
  messages,
  messagesLoading,
  onReply,
  onForward,
  onArchive,
  onDelete,
  onSnooze,
  onMove,
  onClose,
  onImageClick,
  onDownloadAttachment,
  onGetAttachmentData,
  onTrash,
  onToggleRead,
  onComposeToContact,
  currentUserEmail,
  mailProviderType,
}: ThreadDetailProps) {
  return (
    <div className="mail-thread-detail">
      <div className="mail-thread-detail__toolbar">
        <button className="btn-icon" onClick={onClose} title="Fermer" type="button"><X size={18} /></button>
        <div style={{ flex: 1 }} />
        <button className="btn-icon" onClick={onArchive} title="Archiver" type="button"><Archive size={18} /></button>
        <button className="btn-icon" onClick={onDelete} title="Supprimer" type="button"><Trash2 size={18} /></button>
        <button className="btn-icon" onClick={onSnooze} title="Mettre en attente" type="button"><BellOff size={18} /></button>
        <button className="btn-icon" onClick={onMove} title="Déplacer vers" type="button"><FolderInput size={18} /></button>
        <div className="divider-v" />
        <button className="btn-icon" type="button"><MoreHorizontal size={18} /></button>
      </div>

      <div className="mail-thread-detail__header">
        <h2 className="mail-thread-detail__subject">{thread.subject || '(Sans objet)'}</h2>
      </div>

      <div className="mail-thread-detail__messages">
        {messagesLoading ? (
          <div className="mail-thread-detail__loading">Chargement des messages...</div>
        ) : (
          messages.map((msg, i) => (
            <MessageBlock
              key={msg.item_id}
              msg={msg}
              isExpanded={i === messages.length - 1}
              onToggle={() => {}}
              onReply={onReply}
              onForward={onForward}
              onImageClick={onImageClick}
              onDownloadAttachment={onDownloadAttachment}
              onGetAttachmentData={onGetAttachmentData}
              onTrash={onTrash}
              onToggleRead={onToggleRead}
              onComposeToContact={onComposeToContact}
              currentUserEmail={currentUserEmail}
              mailProviderType={mailProviderType}
            />
          ))
        )}
      </div>
    </div>
  );
}
