import { X } from 'lucide-react';
import { ComposerAttachment } from '../providers/MailProvider';
import { FileTypeIcon, formatSize } from '../utils';

export interface ComposerAttachmentPanelProps {
  readonly attachments: ComposerAttachment[];
  readonly onRemove: (index: number) => void;
}

export function ComposerAttachmentPanel({ attachments, onRemove }: ComposerAttachmentPanelProps) {
  return (
    <div className="mail-composer__attachments">
      {attachments.map((att, idx) => (
        <div key={idx} className="mail-composer__attachment-tile">
          <FileTypeIcon name={att.name} size={20} />
          <span className="mail-composer__attachment-name" title={att.name}>{att.name}</span>
          <span className="mail-composer__attachment-size">({formatSize(att.size)})</span>
          <button className="mail-composer__attachment-remove" onClick={() => onRemove(idx)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
