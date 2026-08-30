import { describe, expect, it } from 'vitest';
import { shouldPersistQuery } from './queryClient';

describe('shouldPersistQuery', () => {
  it('does not persist full mail conversations', () => {
    expect(shouldPersistQuery(['mail', 'account', 'thread', 'conversation-id'])).toBe(false);
  });

  it('keeps lightweight mail lists and unrelated queries persistent', () => {
    expect(shouldPersistQuery(['mail', 'account', 'threads', 'inbox', 50, 0])).toBe(true);
    expect(shouldPersistQuery(['calendar', 'events'])).toBe(true);
  });
});
