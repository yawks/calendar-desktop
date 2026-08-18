import { platform } from '../platform';
import { getTauriInvoke, isTauriRuntime } from '../platform/tauriRuntime';

export interface PickedFile {
  name: string;
  type: string;
  data: ArrayBuffer;
}

function base64ToBlob(data: string, contentType = 'application/octet-stream'): Blob {
  const normalized = data.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: contentType });
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const fileService = {
  downloadBase64(filename: string, data: string, contentType?: string): void {
    downloadBlob(base64ToBlob(data, contentType), filename);
  },

  saveText(filename: string, text: string, contentType = 'text/plain;charset=utf-8'): void {
    downloadBlob(new Blob([text], { type: contentType }), filename);
  },

  pickFile(accept = '*/*'): Promise<PickedFile | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.onchange = async () => {
        const file = input.files?.[0];
        resolve(file ? { name: file.name, type: file.type, data: await file.arrayBuffer() } : null);
      };
      input.oncancel = () => resolve(null);
      input.click();
    });
  },
};

export function openExternalUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl, globalThis.location.href);
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return false;
    if (platform.openExternalUrl) {
      void platform.openExternalUrl(url.href);
      return true;
    }
    const invoke = getTauriInvoke();
    if (invoke) {
      void invoke('open_external_url', { url: url.href }).catch(error => {
        console.error('[Desktop] Failed to open external URL', error);
      });
      return true;
    }
    globalThis.open(url.href, '_blank', 'noopener,noreferrer');
    return true;
  } catch {
    return false;
  }
}

export function installDesktopExternalLinkHandler(): () => void {
  if (!isTauriRuntime()) return () => undefined;

  const handleClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest<HTMLAnchorElement>('a[href]');
    if (!anchor || anchor.hasAttribute('download')) return;
    const url = new URL(anchor.href, globalThis.location.href);
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return;
    event.preventDefault();
    openExternalUrl(url.href);
  };

  document.addEventListener('click', handleClick);
  return () => document.removeEventListener('click', handleClick);
}
