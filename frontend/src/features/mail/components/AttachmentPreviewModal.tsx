import { useEffect } from 'react';
import { MailAttachment } from '../types';
import { X, RefreshCw } from 'lucide-react';
import { createPortal } from 'react-dom';
import { FileTypeIcon } from '../utils';

export interface AttachmentPreviewModalProps {
  readonly attachment: MailAttachment;
  readonly loading: boolean;
  readonly data: string | null;
  readonly onClose: () => void;
}

export function AttachmentPreviewModal({ attachment, loading, data, onClose }: AttachmentPreviewModalProps) {
  const isImage = attachment.content_type.startsWith('image/');
  const isPdf = attachment.content_type.includes('pdf');
  const dataUrl = data ? `data:${attachment.content_type};base64,${data}` : null;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return createPortal(
    <>
      {/* Backdrop — positioned behind the dialog via CSS z-index */}
      <button
        type="button"
        className="mail-preview-overlay"
        onClick={onClose}
        aria-label="Fermer l'aperçu"
      />
      <dialog open className="mail-preview-modal">
        <div className="mail-preview-modal__header">
          <FileTypeIcon name={attachment.name} size={16} />
          <span className="mail-preview-modal__title">{attachment.name}</span>
          <button type="button" className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mail-preview-modal__body">
          {loading && (
            <div className="mail-preview-modal__loading">
              <RefreshCw size={32} className="spin" style={{ opacity: 0.4 }} />
            </div>
          )}
          {!loading && dataUrl && isImage && (
            <img src={dataUrl} alt={attachment.name} className="mail-preview-modal__img" />
          )}
          {!loading && dataUrl && isPdf && (
            <iframe src={dataUrl} title={attachment.name} className="mail-preview-modal__iframe" />
          )}
        </div>
      </dialog>
    </>,
    document.body,
  );
}
