import { describe, expect, it } from 'vitest';
import type { CalendarConfig, CalendarEvent, ExchangeAccount } from '../../../shared/types';
import { isEventEditable } from './eventPermissions';

const event: CalendarEvent = { id: 'event', calendarId: 'calendar', title: 'Meeting', start: '2026-10-22T08:00:00Z', end: '2026-10-22T09:00:00Z', isAllday: false, category: 'time' };
const accounts = [{ id: 'account', email: 'me@example.test', displayName: 'My Name' }] as ExchangeAccount[];
const organizer = { email: 'me@example.test', name: 'My Name', isOrganizer: true, status: 'ACCEPTED' as const };

describe.each(['google', 'exchange', 'nextcloud'] as const)('%s event permissions', type => {
  const calendar = { id: 'calendar', type, ownerEmail: 'me@example.test', exchangeAccountId: 'account' } as CalendarConfig;
  it('accepts personal appointments without attendees', () => {
    expect(isEventEditable(event, calendar, accounts)).toBe(true);
  });
  it('accepts an organizer independently of the mail or ICS metadata', () => {
    expect(isEventEditable({ ...event, attendees: [organizer] }, calendar, accounts)).toBe(true);
  });
  it('rejects meetings organized by another person', () => {
    expect(isEventEditable({ ...event, attendees: [{ ...organizer, email: 'other@example.test', name: 'Someone Else' }] }, calendar, accounts)).toBe(false);
  });
  it('rejects shared calendars, read-only events and tasks', () => {
    expect(isEventEditable(event, { ...calendar, readOnly: true }, accounts)).toBe(false);
    expect(isEventEditable({ ...event, readOnly: true }, calendar, accounts)).toBe(false);
    expect(isEventEditable({ ...event, isTask: true }, calendar, accounts)).toBe(false);
  });
});

it('recognizes the Exchange organizer by name when EWS returns an internal address', () => {
  const calendar = { type: 'exchange', exchangeAccountId: 'account' } as CalendarConfig;
  expect(isEventEditable({ ...event, attendees: [{ ...organizer, email: '' }] }, calendar, accounts)).toBe(true);
});
