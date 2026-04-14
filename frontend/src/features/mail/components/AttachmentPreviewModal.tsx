import { MailAttachment } from '../types';
import { X, RefreshCw } from 'lucide-react';
import { createPortal } from 'react-dom';

export interface AttachmentPreviewModalProps {
  readonly attachment: MailAttachment;
  readonly loading: boolean;
  readonly data: string | null;
  readonly onClose: () => void;
}

export function AttachmentPreviewModal({ attachment, loading, data, onClose }: AttachmentPreviewModalProps) {
  const isImage = attachment.content_type.startsWith('image/');
  const isPdf = attachment.content_type.includes('pdf');

  return createPortal(
    <div className="mail-attachment-preview">
      <div className="mail-attachment-preview__overlay" onClick={onClose} />
      <div className="mail-attachment-preview__container">
        <div className="mail-attachment-preview__header">
          <div className="mail-attachment-preview__title">
            <span>{attachment.name}</span>
          </div>
          <div className="mail-attachment-preview__actions">
            <button className="mail-attachment-preview__close" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
        </div>
        <div className="mail-attachment-preview__content">
          {loading ? (
            <div className="mail-attachment-preview__loading">
              <RefreshCw size={32} className="spin" />
            </div>
          ) : data ? (
            isImage ? (
              <img src={`data:${attachment.content_type};base64,${data}`} alt={attachment.name} />
            ) : isPdf ? (
              <iframe src={`data:${attachment.content_type};base64,${data}`} title={attachment.name} />
            ) : (
              <div className="mail-attachment-preview__unsupported">
                Aperçu non disponible pour ce type de fichier.
              </div>
            )
          ) : (
            <div className="mail-attachment-preview__error">
              Erreur lors du chargement de l'aperçu.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
