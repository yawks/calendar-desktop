import { X } from 'lucide-react';
import { ComposerAttachment } from '../providers/MailProvider';
import { FileTypeIcon, formatSize } from '../utils';

export interface ComposerAttachmentPanelProps {
  readonly attachments: ComposerAttachment[];
  readonly onRemove: (index: number) => void;
}

export function ComposerAttachmentPanel({ attachments, onRemove }: ComposerAttachmentPanelProps) {
  if (attachments.length === 0) return null;
  return (
    <div className="mail-attachments">
      {attachments.map((att, idx) => (
        <div key={idx} className="mail-view-att-card" title={att.name}>
          <div className="mail-view-att-card__icon">
            <FileTypeIcon name={att.name} size={20} />
          </div>
          <div className="mail-view-att-card__info">
            <span className="mail-view-att-card__name">{att.name}</span>
            <span className="mail-view-att-card__size">{formatSize(att.size)}</span>
          </div>
          <div className="mail-view-att-card__actions">
            <button type="button" className="mail-view-att-card__btn" onClick={() => onRemove(idx)} title="Supprimer">
              <X size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
