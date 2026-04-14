import { Download } from 'lucide-react';
import { MailAttachment } from '../../types';
import { formatSize } from '../../utils';
import { FileTypeIcon } from './FileTypeIcon';

export function AttachmentItem({ att, onDownload }: { readonly att: MailAttachment; readonly onDownload: (att: MailAttachment) => void }) {
  return (
    <div className="mail-attachment">
      <FileTypeIcon name={att.name} />
      <div className="mail-attachment__info">
        <span className="mail-attachment__name" title={att.name}>{att.name}</span>
        <span className="mail-attachment__size">{formatSize(att.size)}</span>
      </div>
      <button className="mail-attachment__dl" onClick={() => onDownload(att)} title="Télécharger" type="button">
        <Download size={14} />
      </button>
    </div>
  );
}
