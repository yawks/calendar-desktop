import { useTranslation } from 'react-i18next';
import { OfficeAttachmentPreview } from './OfficeAttachmentPreview';
import { getOfficeFormat } from '../utils/officeAttachment';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MailAttachment } from '../types';
import { X, RefreshCw, Download } from 'lucide-react';
import { createPortal } from 'react-dom';
import { FileTypeIcon } from '../utils';
import { platform } from '../../../shared/platform';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export interface AttachmentPreviewModalProps {
  readonly attachment: MailAttachment;
  readonly loading: boolean;
  readonly data: string | null;
  readonly onClose: () => void;
  readonly loadOffice?: () => Promise<ArrayBuffer>;
  readonly onDownload?: () => Promise<void>;
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

export function AttachmentPreviewModal({ attachment, loading, data, onClose, loadOffice, onDownload }: AttachmentPreviewModalProps) {
  const { t } = useTranslation();
  const closeRef = useRef<HTMLButtonElement>(null);
  const downloadGenerationRef = useRef(0);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  useEffect(() => {
    downloadGenerationRef.current += 1;
    setDownloading(false);
    setDownloadError(false);
    return () => { downloadGenerationRef.current += 1; };
  }, [attachment, onDownload]);
  const officeFormat = getOfficeFormat(attachment.name, attachment.content_type);
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
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, []);

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
        aria-label={t('mail.office.close')}
      />
      <dialog open aria-modal="true" aria-label={attachment.name} className="mail-preview-modal" onKeyDown={event => {
        if (event.key !== 'Tab') return;
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"], a[href], input, select'));
        const first = buttons[0]; const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
        <div className="mail-preview-modal__header">
          <FileTypeIcon name={attachment.name} size={16} />
          <span className="mail-preview-modal__title">{attachment.name}</span>
          {onDownload && <button type="button" className="btn-ghost mail-office-download" disabled={downloading} aria-busy={downloading} onClick={() => {
            const generation = downloadGenerationRef.current;
            setDownloading(true); setDownloadError(false);
            void onDownload().catch(() => {
              if (downloadGenerationRef.current === generation) setDownloadError(true);
            }).finally(() => {
              if (downloadGenerationRef.current === generation) setDownloading(false);
            });
          }}>{downloading ? <RefreshCw size={16} className="spin" /> : <Download size={16} />}{t('mail.attachment.download')}</button>}
          <button ref={closeRef} type="button" className="btn-icon" aria-label={t('mail.office.close')} title={t('mail.office.close')} onClick={onClose}><X size={16} /></button>
        </div>
        {downloadError && <p className="mail-office-download-error" role="alert">{t('mail.office.downloadError')}</p>}
        <div className="mail-preview-modal__body">
          {officeFormat && loadOffice && <OfficeAttachmentPreview format={officeFormat} load={loadOffice} />}
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
