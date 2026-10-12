// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { OfficeAttachmentPreview } from './OfficeAttachmentPreview';
import { getOfficeFormat, officeAttachmentBytes, OFFICE_PREVIEW_MAX_BYTES } from '../utils/officeAttachment';
const mocks = vi.hoisted(() => ({ instances: [] as any[], open: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../../shared/services/fileService', () => ({ openExternalUrl: mocks.open }));
class Viewer {
  load = vi.fn(async () => {}); destroy = vi.fn(); zoomIn = vi.fn(); zoomOut = vi.fn(); scrollToPage = vi.fn();
  constructor(public mount: HTMLElement, public options: any) { mocks.instances.push(this); }
}
vi.mock('@silurus/ooxml/docx', () => ({ DocxScrollViewer: Viewer }));
vi.mock('@silurus/ooxml/xlsx', () => ({ XlsxViewer: Viewer }));
it('detects extension before MIME, excludes legacy formats and enforces the byte limit', () => {
  expect(getOfficeFormat('REPORT.DOCX', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('docx');
  expect(getOfficeFormat('file', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; charset=utf-8')).toBe('xlsx');
  expect(getOfficeFormat('old.doc', 'application/msword')).toBeNull();
  expect(getOfficeFormat('slides.pptx', 'application/octet-stream')).toBeNull();
  expect(Array.from(new Uint8Array(officeAttachmentBytes('aGVsbG8')))).toEqual([104, 101, 108, 108, 111]);
  expect(() => officeAttachmentBytes('!')).toThrow();
  expect(() => officeAttachmentBytes('A'.repeat(Math.ceil(OFFICE_PREVIEW_MAX_BYTES / 3) * 4 + 1))).toThrow('office-size-limit');
});
it('isolates obsolete loads, cleans up, navigates, zooms and filters links', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); const root = createRoot(host);
  let resolve!: (data: ArrayBuffer) => void;
  await act(async () => root.render(<OfficeAttachmentPreview format="docx" load={() => new Promise(r => { resolve = r; })} />));
  const oldMount = host.querySelector('.mail-office-preview__mount');
  const load = async () => new ArrayBuffer(2);
  await act(async () => root.render(<OfficeAttachmentPreview format="docx" load={load} />));
  await act(async () => resolve(new ArrayBuffer(1)));
  expect(mocks.instances).toHaveLength(1);
  expect(oldMount?.parentElement).toBeNull();
  const doc = mocks.instances[0];
  expect(doc.options).toMatchObject({ mode: 'worker', useGoogleFonts: false, enableTextSelection: true });
  await act(async () => doc.options.onVisiblePageChange(0, 3));
  await act(async () => (host.querySelector('[aria-label="mail.office.next"]') as HTMLElement).click());
  expect(doc.scrollToPage).toHaveBeenCalledWith(1);
  await act(async () => (host.querySelector('[aria-label="mail.office.zoomIn"]') as HTMLElement).click());
  expect(doc.zoomIn).toHaveBeenCalledOnce();
  doc.options.onHyperlinkClick({ kind: 'external', url: 'javascript:alert(1)' });
  doc.options.onHyperlinkClick({ kind: 'internal', url: 'https://example.test' });
  doc.options.onHyperlinkClick({ kind: 'external', url: 'https://example.test' });
  expect(mocks.open).toHaveBeenCalledOnce();
  expect(mocks.open).toHaveBeenCalledWith('https://example.test');
  await act(async () => root.render(<OfficeAttachmentPreview format="xlsx" load={load} />));
  expect(doc.destroy).toHaveBeenCalledOnce();
  expect(doc.mount.parentElement).toBeNull();
  expect(mocks.instances[1].options).toMatchObject({ resizable: false, showZoomSlider: false });
  await act(async () => mocks.instances[1].options.onError(new Error('invalid')));
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('mail.office.error');
  await act(async () => root.unmount());
  expect(mocks.instances[1].destroy).toHaveBeenCalledOnce();
  doc.options.onHyperlinkClick({ kind: 'external', url: 'https://obsolete.test' });
  expect(mocks.open).toHaveBeenCalledTimes(1);
});
