import { useEffect, useMemo } from 'react';
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
  const isPdf = attachment.content_type.includes('pdf') || attachment.name.toLowerCase().endsWith('.pdf');
  // Chromium does not reliably allow a PDF data URL to be loaded in a child
  // frame once the app is installed as a PWA. A same-origin blob URL also
  // avoids hitting the browser's data-URL length limits for large documents.
  const previewUrl = useMemo(() => {
    if (!data) return null;
    const compact = data.replaceAll(/\s/g, '');
    const binary = atob(compact);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return URL.createObjectURL(new Blob([bytes], {
      type: isPdf ? 'application/pdf' : attachment.content_type,
    }));
  }, [attachment.content_type, data, isPdf]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

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
          {!loading && previewUrl && isImage && (
            <img src={previewUrl} alt={attachment.name} className="mail-preview-modal__img" />
          )}
          {!loading && previewUrl && isPdf && (
            <iframe src={previewUrl} title={attachment.name} className="mail-preview-modal__iframe" />
          )}
        </div>
      </dialog>
    </>,
    document.body,
  );
}
