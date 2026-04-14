import { MailAttachment } from '../types';
import { Download, Eye } from 'lucide-react';
import { formatSize, FileTypeIcon } from '../utils';

export interface AttachmentListProps {
  readonly attachments: MailAttachment[];
  readonly onPreview: (att: MailAttachment) => void;
  readonly onDownload: (att: MailAttachment) => void;
}

export function AttachmentList({ attachments, onPreview, onDownload }: AttachmentListProps) {
  return (
    <div className="mail-attachment-list">
      <div className="mail-attachment-list__header">
        <span>{attachments.length} pièce(s) jointe(s)</span>
      </div>
      <div className="mail-attachment-list__grid">
        {attachments.map((att) => (
          <div key={att.attachment_id} className="mail-attachment-card">
            <div className="mail-attachment-card__icon">
              <FileTypeIcon name={att.name} size={32} />
            </div>
            <div className="mail-attachment-card__info">
              <div className="mail-attachment-card__name" title={att.name}>{att.name}</div>
              <div className="mail-attachment-card__size">{formatSize(att.size)}</div>
            </div>
            <div className="mail-attachment-card__actions">
              <button onClick={() => onPreview(att)} title="Aperçu">
                <Eye size={16} />
              </button>
              <button onClick={() => onDownload(att)} title="Télécharger">
                <Download size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
