import { expect, it } from 'vitest';
import { eventMailDraft } from './eventMailDraft';
import type { CalendarConfig, CalendarEvent } from '../../../shared/types';
import type { FromAccount } from '../../mail/types';
const event: CalendarEvent = { id: 'ev', calendarId: 'cal', title: 'Planning', start: '', end: '', isAllday: false, category: 'time', attendees: [
  { email: 'guest@example.test', name: 'Guest', status: 'ACCEPTED' },
  { email: 'HOST@example.test', name: 'Host', status: 'ACCEPTED', isOrganizer: true },
  { email: 'host@example.test', name: 'Duplicate', status: 'ACCEPTED' },
  { email: 'ME@example.test', name: 'Me', status: 'ACCEPTED' },
  { email: 'guest@example.test', name: 'Duplicate', status: 'ACCEPTED' },
] };
const calendar: CalendarConfig = { id: 'cal', name: 'Calendar', url: '', color: '', visible: true, ownerEmail: 'me@example.test' };
it.each(['gmail', 'ews', 'imap', 'jmap'] as const)('uses the matching %s account and puts each contact in the right field', providerType => {
  const accounts: FromAccount[] = [{ id: 'account', email: 'me@example.test', providerType }];
  const cal = { ...calendar, type: providerType === 'gmail' ? 'google' : providerType === 'ews' ? 'exchange' : 'nextcloud', googleAccountId: 'account', exchangeAccountId: 'account' } as CalendarConfig;
  const draft = eventMailDraft(event, cal, accounts)!;
  expect(draft.toRecipients).toEqual([{ email: 'HOST@example.test', name: 'Host' }]);
  expect(draft.ccRecipients).toEqual([{ email: 'guest@example.test', name: 'Guest' }]);
  expect(draft).toMatchObject({ fromAccountId: 'account', initialFocus: 'subject', subject: 'Planning', isNewMessage: true });
});
it('focuses To when the organizer is me or missing', () => {
  const accounts: FromAccount[] = [{ id: 'account', email: 'host@example.test', providerType: 'gmail' }];
  const draft = eventMailDraft(event, { ...calendar, type: 'google', googleAccountId: 'account' }, accounts, ['host@example.test', 'me@example.test'])!;
  expect(draft.toRecipients).toEqual([]);
  expect(draft.ccRecipients).toEqual([{ email: 'guest@example.test', name: 'Guest' }]);
  expect(draft.initialFocus).toBe('to');
});
it('does not fall back to a different linked account or an ambiguous owner address', () => {
  const accounts: FromAccount[] = [{ id: 'other', email: 'me@example.test', providerType: 'gmail' }];
  expect(eventMailDraft(event, { ...calendar, type: 'google', googleAccountId: 'missing' }, accounts)).toBeNull();
  expect(eventMailDraft(event, calendar, [...accounts, { ...accounts[0], id: 'duplicate' }])).toBeNull();
});
