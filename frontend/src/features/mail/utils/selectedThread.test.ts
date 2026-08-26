import { describe, expect, it } from 'vitest';
import type { MailThread } from '../types';
import { mergeSelectedThread } from './selectedThread';

const thread = (topic: string, overrides: Partial<MailThread> = {}): MailThread => ({
  conversation_id: 'conversation', topic, snippet: '',
  last_delivery_time: '2026-08-26T10:00:00Z', message_count: 1, unread_count: 1,
  from_name: null, from_email: null, has_attachments: false, ...overrides,
});

describe('mergeSelectedThread', () => {
  it('keeps the resolved detail subject when a recall changes the list topic', () => {
    const current = thread('(no subject)', { snippet: 'Original message' });
    const listed = thread('Rappel :', { message_count: 2, unread_count: 0 });

    expect(mergeSelectedThread(current, listed)).toMatchObject({
      topic: '(no subject)', snippet: 'Original message', message_count: 2, unread_count: 0,
    });
  });

  it('fills an empty detail shell from the list', () => {
    const listed = thread('Objet', {
      snippet: 'Aperçu', from_name: 'Alice', from_email: 'alice@example.com',
    });

    expect(mergeSelectedThread(thread(''), listed)).toMatchObject({
      topic: 'Objet', snippet: 'Aperçu', from_name: 'Alice', from_email: 'alice@example.com',
    });
  });

  it('keeps the same object when no metadata changed', () => {
    const current = thread('Objet');
    expect(mergeSelectedThread(current, { ...current })).toBe(current);
  });
});
