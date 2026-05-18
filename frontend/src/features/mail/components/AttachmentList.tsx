import { MailAttachment } from '../types';
import { Download, Eye, Loader2 } from 'lucide-react';
import { formatSize, FileTypeIcon } from '../utils';
import { useTranslation } from 'react-i18next';

export interface AttachmentListProps {
  readonly attachments: MailAttachment[];
  readonly onPreview: (att: MailAttachment) => void;
  readonly onDownload: (att: MailAttachment) => void;
  readonly loadingAttachmentId?: string | null;
}

export function AttachmentList({ attachments, onPreview, onDownload, loadingAttachmentId }: AttachmentListProps) {
  const { t } = useTranslation();
  return (
    <div className="mail-attachments">
      {attachments.map((att) => {
        const previewLoading = loadingAttachmentId === `preview:${att.attachment_id}`;
        const downloadLoading = loadingAttachmentId === `download:${att.attachment_id}`;
        return (
          <div key={att.attachment_id} className={`mail-view-att-card${previewLoading || downloadLoading ? ' mail-view-att-card--loading' : ''}`} title={att.name}>
            <div className="mail-view-att-card__icon">
              <FileTypeIcon name={att.name} size={20} />
            </div>
            <div className="mail-view-att-card__info">
              <span className="mail-view-att-card__name">{att.name}</span>
              <span className="mail-view-att-card__size">{formatSize(att.size)}</span>
            </div>
            <div className="mail-view-att-card__actions">
              <button type="button" className="mail-view-att-card__btn" onClick={() => onPreview(att)} title={t('mail.attachment.preview')} disabled={previewLoading || downloadLoading}>
                {previewLoading ? <Loader2 size={14} className="spin" /> : <Eye size={14} />}
              </button>
              <button type="button" className="mail-view-att-card__btn" onClick={() => onDownload(att)} title={t('mail.attachment.download')} disabled={previewLoading || downloadLoading}>
                {downloadLoading ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
