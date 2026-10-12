export type OfficeFormat = 'docx' | 'xlsx';
export const OFFICE_PREVIEW_MAX_BYTES = 20 * 1024 * 1024;

export function getOfficeFormat(name: string, contentType: string): OfficeFormat | null {
  const extension = name.includes('.') ? name.split('.').pop()?.toLowerCase() : '';
  if (extension === 'docx' || extension === 'xlsx') return extension;
  switch (contentType.split(';')[0].trim().toLowerCase()) {
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': return 'docx';
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': return 'xlsx';
    default: return null;
  }
}

export function officeAttachmentBytes(data: string): ArrayBuffer {
  const normalized = data.replaceAll(/\s/g, '').replaceAll('-', '+').replaceAll('_', '/');
  if (normalized.length > Math.ceil(OFFICE_PREVIEW_MAX_BYTES / 3) * 4) throw new Error('office-size-limit');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  if (binary.length > OFFICE_PREVIEW_MAX_BYTES) throw new Error('office-size-limit');
  return Uint8Array.from(binary, character => character.charCodeAt(0)).buffer;
}
