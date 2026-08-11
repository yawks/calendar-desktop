import { describe, expect, it } from 'vitest';
import { usableContactName } from './contactIndex';

describe('contact index normalization', () => {
  it('rejects low-quality and generated names', () => {
    expect(usableContactName('person@example.com', 'person@example.com')).toBeUndefined();
    expect(usableContactName('550e8400-e29b-41d4-a716-446655440000', 'person@example.com')).toBeUndefined();
    expect(usableContactName('Other Person', 'person@example.com')).toBe('Other Person');
  });
});
