import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, ZoomIn, ZoomOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { HyperlinkTarget } from '@silurus/ooxml/xlsx';
import { openExternalUrl } from '../../../shared/services/fileService';
import { OFFICE_PREVIEW_MAX_BYTES, type OfficeFormat } from '../utils/officeAttachment';

type Viewer = {
  load(data: ArrayBuffer): Promise<void>;
  destroy(): void;
  zoomIn(): void | Promise<void>;
  zoomOut(): void | Promise<void>;
};

export function OfficeAttachmentPreview({ format, load }: {
  readonly format: OfficeFormat;
  readonly load: () => Promise<ArrayBuffer>;
}) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<{ viewer: Viewer; navigate?: (index: number) => void; fail: () => void } | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [tooLarge, setTooLarge] = useState(false);
  const [page, setPage] = useState({ index: 0, total: 0 });

  useEffect(() => {
    const mount = document.createElement('div');
    mount.className = 'mail-office-preview__mount';
    hostRef.current!.appendChild(mount);
    let disposed = false;
    let failed = false;
    let viewer: Viewer | undefined;
    setStatus('loading');
    setBusy(false);
    setTooLarge(false);
    setPage({ index: 0, total: 0 });
    const fail = () => { failed = true; if (!disposed) setStatus('error'); };
    const changed = (index: number, total: number) => {
      if (!disposed) setPage({ index, total });
    };
    const onHyperlinkClick = (target: HyperlinkTarget) => {
      if (!disposed && target.kind === 'external' && /^(https?:|mailto:)/i.test(target.url)) {
        openExternalUrl(target.url);
      }
    };
    const options = { mode: 'worker' as const, useGoogleFonts: false, enableTextSelection: true, onError: fail, onHyperlinkClick };
    void (async () => {
      const bytes = await load();
      if (disposed) return;
      if (bytes.byteLength > OFFICE_PREVIEW_MAX_BYTES) throw new Error('office-size-limit');
      if (format === 'docx') {
        const { DocxScrollViewer } = await import('@silurus/ooxml/docx');
        if (disposed) return;
        const doc = new DocxScrollViewer(mount, { ...options, onVisiblePageChange: changed });
        viewer = doc;
        controlsRef.current = { viewer, fail, navigate: index => {
          doc.scrollToPage(index);
          if (!disposed) setPage(current => ({ ...current, index }));
        } };
      } else {
        const { XlsxViewer } = await import('@silurus/ooxml/xlsx');
        if (disposed) return;
        viewer = new XlsxViewer(mount, { ...options, resizable: false, showZoomSlider: false });
        controlsRef.current = { viewer, fail };
      }
      await viewer.load(bytes);
      if (!disposed && !failed) setStatus('ready');
    })().catch(reason => {
      if (!disposed) setTooLarge(reason instanceof Error && reason.message === 'office-size-limit');
      fail();
    });
    return () => {
      disposed = true;
      controlsRef.current = null;
      try { viewer?.destroy(); } finally { mount.remove(); }
    };
  }, [format, load]);

  const run = (action: (controls: NonNullable<typeof controlsRef.current>) => void | Promise<void>) => {
    const controls = controlsRef.current;
    if (!controls) return;
    setBusy(true);
    try {
      void Promise.resolve(action(controls)).catch(controls.fail).finally(() => {
        if (controlsRef.current === controls) setBusy(false);
      });
    } catch { controls.fail(); setBusy(false); }
  };
  const iconButton = (label: string, icon: React.ReactNode, disabled: boolean, action: () => void) => (
    <button type="button" className="btn-ghost" aria-label={label} title={label} disabled={disabled || busy} aria-busy={busy} onClick={action}>{icon}</button>
  );
  return <div className="mail-office-preview">
    <div className="mail-office-preview__toolbar">
      {format === 'docx' && <>
        {iconButton(t('mail.office.previous'), <ChevronLeft size={16} />, status !== 'ready' || page.index === 0, () => run(c => c.navigate?.(page.index - 1)))}
        <span role="status">{t('mail.office.pages', { current: page.total ? page.index + 1 : 0, total: page.total })}</span>
        {iconButton(t('mail.office.next'), <ChevronRight size={16} />, status !== 'ready' || page.index + 1 >= page.total, () => run(c => c.navigate?.(page.index + 1)))}
      </>}
      {iconButton(t('mail.office.zoomOut'), <ZoomOut size={16} />, status !== 'ready', () => run(c => c.viewer.zoomOut()))}
      {iconButton(t('mail.office.zoomIn'), <ZoomIn size={16} />, status !== 'ready', () => run(c => c.viewer.zoomIn()))}
    </div>
    {format === 'xlsx' && <p className="mail-office-preview__note">{t('mail.office.formulas')}</p>}
    <div className="mail-office-preview__viewport" aria-busy={status === 'loading'}>
      <div ref={hostRef} className="mail-office-preview__host" />
      {status === 'loading' && <div className="mail-office-preview__status" role="status"><Loader2 size={24} className="spin" />{t('mail.office.loading')}</div>}
      {status === 'error' && <div className="mail-office-preview__status" role="alert">{t(tooLarge ? 'mail.office.tooLarge' : 'mail.office.error')}</div>}
    </div>
    {status === 'ready' && <span className="mail-office-preview__ready" role="status">{t('mail.office.ready')}</span>}
  </div>;
}
