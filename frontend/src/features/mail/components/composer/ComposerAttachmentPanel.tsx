import { X } from 'lucide-react';
import { ComposerAttachment } from '../../providers/MailProvider';
import { formatSize } from '../../utils';
import { FileTypeIcon } from '../thread/FileTypeIcon';

export function ComposerAttachmentPanel({ attachments, onRemove }: { readonly attachments: ComposerAttachment[]; readonly onRemove: (i: number) => void }) {
  if (attachments.length === 0) return null;
  return (
    <div className="mail-composer__attachments">
      {attachments.map((att, i) => (
        <div key={i} className="mail-attachment-chip">
          <FileTypeIcon name={att.name} size={14} />
          <span className="mail-attachment-chip__name" title={att.name}>{att.name}</span>
          <span className="mail-attachment-chip__size">({formatSize(att.size)})</span>
          <button type="button" onClick={() => onRemove(i)} className="mail-attachment-chip__remove">
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
