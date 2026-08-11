import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileService, openExternalUrl } from './fileService';

describe('fileService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('downloads standard and URL-safe base64 through a Blob URL', () => {
    const click = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() });
    vi.stubGlobal('document', { createElement: vi.fn(() => ({ click })) });
    fileService.downloadBase64('hello.txt', 'SGVsbG8tXw', 'text/plain');
    expect(click).toHaveBeenCalled();
  });

  it('only opens safe external protocols', () => {
    const open = vi.fn();
    vi.stubGlobal('location', { href: 'https://courrier.example/' });
    vi.stubGlobal('open', open);
    expect(openExternalUrl('javascript:alert(1)')).toBe(false);
    expect(openExternalUrl('https://example.com/path')).toBe(true);
    expect(open).toHaveBeenCalledWith('https://example.com/path', '_blank', 'noopener,noreferrer');
  });
});
