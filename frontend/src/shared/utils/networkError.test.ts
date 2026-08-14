import { describe, expect, it } from 'vitest';
import { isOfflineLikeError, isTemporaryMailServiceError } from './networkError';

describe('isOfflineLikeError', () => {
  it.each([
    new TypeError('Failed to fetch'),
    new Error('HTTP 502'),
    new Error('Gmail API 503: Service unavailable'),
    'Network request failed',
    '504 Gateway Timeout',
  ])('recognises transient connectivity failures', error => {
    expect(isOfflineLikeError(error)).toBe(true);
  });

  it.each([
    new Error('Unauthorized'),
    new Error('Invalid credentials'),
    new Error('Google API 400: invalid request'),
  ])('keeps actionable failures visible', error => {
    expect(isOfflineLikeError(error)).toBe(false);
  });

  it.each([
    new Error('ErrorMailboxStoreUnavailable: The mailbox database is temporarily unavailable., Cannot open mailbox.'),
    new Error('Mailbox store is temporarily unavailable'),
  ])('recognises temporary mail provider failures', error => {
    expect(isTemporaryMailServiceError(error)).toBe(true);
  });

  it('does not classify authentication failures as temporary provider failures', () => {
    expect(isTemporaryMailServiceError(new Error('Unauthorized'))).toBe(false);
  });
});
