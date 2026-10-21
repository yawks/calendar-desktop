import { afterEach, expect, it, vi } from 'vitest';
import { eventMarkers, eventOptions, isFreeEvent } from './eventOptions';
import { createEvent, listEvents, updateEvent } from './googleCalendarApi';
import { createNextcloudEvent, updateNextcloudEvent } from './nextcloudCalendarApi';
import { calendarApi } from '../../../shared/api/calendarApi';
import { parseICS } from './parseICS';
import { CalendarConfig, CreateEventPayload } from '../../../shared/types';

const cal = { id: 'cal', type: 'google', googleCalendarId: 'primary', url: 'https://example.test/calendar/' } as CalendarConfig;
const payload: CreateEventPayload = { calendarId: 'cal', title: 'Absence', start: '2026-10-20T08:00:00Z', end: '2026-10-20T18:00:00Z', isAllday: false };
afterEach(() => vi.restoreAllMocks());

it('keeps privacy independent of absence and offers only provider values', () => {
  expect(eventMarkers({ availability: 'OOF', sensitivity: 'Private' })).toBe('🏖 🔒');
  expect(eventMarkers({ eventType: 'focusTime', sensitivity: 'private' })).toBe('🔒 🎯');
  expect(eventOptions({ type: 'nextcloud' } as CalendarConfig).availability).not.toContain('OOF');
  expect(eventOptions({ type: 'ics' } as CalendarConfig).availability).toEqual([]);
  expect(isFreeEvent({ availability: 'TRANSPARENT' })).toBe(true);
  expect(isFreeEvent({ availability: 'OOF' })).toBe(false);
});

it('reads and writes Google privacy and absence without creating a meeting or auto-declining invitations', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"id":"new"}'));
  await createEvent('token', cal, { ...payload, sensitivity: 'private', availability: 'opaque', eventType: 'outOfOffice', onlineMeeting: true });
  expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toMatchObject({ visibility: 'private', transparency: 'opaque', eventType: 'outOfOffice', outOfOfficeProperties: { autoDeclineMode: 'declineNone' } });
  expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).not.toHaveProperty('conferenceData');
  fetch.mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: 'event', summary: 'Absence', eventType: 'outOfOffice', visibility: 'private', transparency: 'opaque', start: { dateTime: payload.start }, end: { dateTime: payload.end } }] })));
  expect((await listEvents('token', cal, new Date(payload.start), new Date(payload.end)))[0]).toMatchObject({ sensitivity: 'private', availability: 'opaque', eventType: 'outOfOffice' });
  await updateEvent('token', cal, 'event', { ...payload, eventType: 'outOfOffice', sensitivity: 'private' });
  const patch = JSON.parse(fetch.mock.calls[2][1]!.body as string);
  expect(patch).not.toHaveProperty('eventType');
  expect(patch).not.toHaveProperty('outOfOfficeProperties');
  expect(patch.visibility).toBe('private');
});

it('validates Google status constraints and preserves provider errors', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Not eligible', { status: 403 }));
  await expect(createEvent('token', cal, { ...payload, eventType: 'focusTime', isAllday: true })).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  await expect(createEvent('token', cal, { ...payload, eventType: 'focusTime' })).rejects.toThrow('Not eligible');
  await expect(createEvent('token', cal, { ...payload, sensitivity: 'PRIVATE\r\nATTENDEE:injected' })).rejects.toThrow('Invalid');
});

it('creates working locations and leap-day birthdays with the required properties', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"id":"new"}'));
  await createEvent('token', cal, { ...payload, eventType: 'workingLocation', location: 'Paris' });
  expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toMatchObject({ visibility: 'public', transparency: 'transparent', workingLocationProperties: { customLocation: { label: 'Paris' } } });
  await createEvent('token', cal, { ...payload, start: '2028-02-29', end: '2028-03-01', isAllday: true, eventType: 'birthday' });
  expect(JSON.parse(fetch.mock.calls[1][1]!.body as string)).toMatchObject({ visibility: 'private', transparency: 'transparent', recurrence: ['RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1'] });
});

it('round-trips CalDAV CLASS/TRANSP and preserves them when omitted from an edit', async () => {
  const nextcloud = { ...cal, type: 'nextcloud' as const };
  const put = vi.spyOn(calendarApi, 'putCalDav').mockResolvedValue();
  await createNextcloudEvent(nextcloud, { ...payload, sensitivity: 'PRIVATE', availability: 'TRANSPARENT' });
  const original = put.mock.calls[0][1];
  expect(original).toContain('CLASS:PRIVATE');
  expect(original).toContain('TRANSP:TRANSPARENT');
  expect(parseICS(original, nextcloud)[0]).toMatchObject({ sensitivity: 'PRIVATE', availability: 'TRANSPARENT' });
  vi.spyOn(calendarApi, 'fetchCalDav').mockResolvedValue(original);
  await updateNextcloudEvent(nextcloud, 'uid', payload);
  expect(put.mock.calls[1][1]).toContain('CLASS:PRIVATE');
  await updateNextcloudEvent(nextcloud, 'uid', { ...payload, sensitivity: 'PUBLIC', availability: 'OPAQUE' });
  expect(put.mock.calls[2][1]).toContain('CLASS:PUBLIC');
  vi.mocked(calendarApi.putCalDav).mockRejectedValueOnce(new Error('denied'));
  await expect(createNextcloudEvent(nextcloud, payload)).rejects.toThrow('denied');
});

it('preserves Google office metadata when unchanged and updates an edited working location', async () => {
  const current = { workingLocationProperties: { type: 'officeLocation', officeLocation: { label: 'Paris', buildingId: 'building' } } };
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => new Response(JSON.stringify(options?.method === 'PATCH' ? {} : current)));
  await updateEvent('token', cal, 'event', { ...payload, eventType: 'workingLocation', location: 'Paris' });
  expect(JSON.parse(fetch.mock.calls[1][1]!.body as string)).not.toHaveProperty('workingLocationProperties');
  await updateEvent('token', cal, 'event', { ...payload, eventType: 'workingLocation', location: 'Lyon' });
  expect(JSON.parse(fetch.mock.calls[3][1]!.body as string).workingLocationProperties).toEqual({ type: 'customLocation', customLocation: { label: 'Lyon' } });
});
