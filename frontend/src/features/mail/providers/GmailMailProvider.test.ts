import { describe, expect, it } from 'vitest';

describe('Gmail attachment base64 normalization', () => {
  it('normalizes URL-safe unpadded base64 for Web Blob consumers', () => {
    const raw = 'SGVsbG8tXw';
    const normalized = raw.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(raw.length / 4) * 4, '=');
    expect(atob(normalized)).toBe('Hello-_');
  });
});
