import { useEffect, useMemo, useRef, useState } from 'react';
import { MailAttachment } from '../types';
import { X, RefreshCw } from 'lucide-react';
import { createPortal } from 'react-dom';
import { FileTypeIcon } from '../utils';
import { platform } from '../../../shared/platform';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export interface AttachmentPreviewModalProps {
  readonly attachment: MailAttachment;
  readonly loading: boolean;
  readonly data: string | null;
  readonly onClose: () => void;
}

function AndroidPdfPreview({ bytes }: { readonly bytes: Uint8Array }) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const pages = pagesRef.current;
    if (!pages) return;
    pages.replaceChildren();
    setRendering(true);
    setError('');

    let task: ReturnType<typeof import('pdfjs-dist')['getDocument']> | null = null;
    void import('pdfjs-dist').then(async ({ getDocument, GlobalWorkerOptions }) => {
      GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      task = getDocument({ data: bytes.slice() });
      const pdf = await task.promise;
      for (let pageNumber = 1; pageNumber <= pdf.numPages && !cancelled; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const initialViewport = page.getViewport({ scale: 1 });
        const availableWidth = Math.max(1, pages.clientWidth);
        const cssScale = availableWidth / initialViewport.width;
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: cssScale * pixelRatio });
        const canvas = document.createElement('canvas');
        canvas.className = 'mail-preview-modal__pdf-page';
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.width = `${Math.ceil(viewport.width / pixelRatio)}px`;
        canvas.style.height = `${Math.ceil(viewport.height / pixelRatio)}px`;
        pages.appendChild(canvas);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas indisponible');
        await page.render({ canvasContext: context, viewport }).promise;
      }
      if (!cancelled) setRendering(false);
    }).catch(reason => {
      if (!cancelled) {
        setRendering(false);
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    });

    return () => {
      cancelled = true;
      if (task) void task.destroy();
    };
  }, [bytes]);

  return (
    <div className="mail-preview-modal__pdf-android">
      <div ref={pagesRef} className="mail-preview-modal__pdf-pages" />
      {rendering && <RefreshCw size={32} className="spin mail-preview-modal__pdf-loader" />}
      {error && <div className="mail-preview-modal__pdf-error">{error}</div>}
    </div>
  );
}

export function AttachmentPreviewModal({ attachment, loading, data, onClose }: AttachmentPreviewModalProps) {
  const isImage = attachment.content_type.startsWith('image/');
  const isPdf = attachment.content_type.includes('pdf') || attachment.name.toLowerCase().endsWith('.pdf');
  // Chromium does not reliably allow a PDF data URL to be loaded in a child
  // frame once the app is installed as a PWA. A same-origin blob URL also
  // avoids hitting the browser's data-URL length limits for large documents.
  const previewBytes = useMemo(() => {
    if (!data) return null;
    const compact = data.replaceAll(/\s/g, '');
    const binary = atob(compact);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }, [data]);
  const previewUrl = useMemo(() => {
    if (!previewBytes) return null;
    return URL.createObjectURL(new Blob([previewBytes], {
      type: isPdf ? 'application/pdf' : attachment.content_type,
    }));
  }, [attachment.content_type, isPdf, previewBytes]);

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
          {!loading && previewBytes && isPdf && platform.isNativeAndroid && (
            <AndroidPdfPreview bytes={previewBytes} />
          )}
          {!loading && previewUrl && isPdf && !platform.isNativeAndroid && (
            <iframe src={previewUrl} title={attachment.name} className="mail-preview-modal__iframe" />
          )}
        </div>
      </dialog>
    </>,
    document.body,
  );
}
