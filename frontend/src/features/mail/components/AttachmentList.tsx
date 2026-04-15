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
    <div className="mail-attachments">
      {attachments.map((att) => (
        <div key={att.attachment_id} className="mail-view-att-card" title={att.name}>
          <div className="mail-view-att-card__icon">
            <FileTypeIcon name={att.name} size={20} />
          </div>
          <div className="mail-view-att-card__info">
            <span className="mail-view-att-card__name">{att.name}</span>
            <span className="mail-view-att-card__size">{formatSize(att.size)}</span>
          </div>
          <div className="mail-view-att-card__actions">
            <button type="button" className="mail-view-att-card__btn" onClick={() => onPreview(att)} title="Aperçu">
              <Eye size={14} />
            </button>
            <button type="button" className="mail-view-att-card__btn" onClick={() => onDownload(att)} title="Télécharger">
              <Download size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
