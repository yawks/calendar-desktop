import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEvent, updateEvent } from './googleCalendarApi';
import { createNextcloudEvent, updateNextcloudEvent } from './nextcloudCalendarApi';
import { calendarApi } from '../../../shared/api/calendarApi';
import { CalendarConfig, CalendarEvent, CreateEventPayload } from '../../../shared/types';
// @ts-ignore ical.js v1 has no bundled declarations
import ICAL from 'ical.js';
vi.mock('../../../shared/api/calendarApi', () => ({ calendarApi: { putCalDav: vi.fn(), fetchCalDav: vi.fn() } }));
const cal = { id: 'cal', type: 'nextcloud', url: 'https://calendar.example.test/' } as CalendarConfig;
const payload: CreateEventPayload = { calendarId: 'cal', title: 'Planning', start: '2026-10-15T14:00:00Z', end: '2026-10-15T15:00:00Z', isAllday: false, timeZone: 'Europe/Paris', recurrence: 'FREQ=WEEKLY;BYDAY=TH;COUNT=13' };
const original = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:series', 'DTSTART:20261001T140000Z', 'DTEND:20261001T150000Z', 'RRULE:FREQ=WEEKLY;BYDAY=TH;COUNT=13', 'EXDATE:20261008T140000Z', 'SUMMARY:Original', 'X-CUSTOM:preserve', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
const source = { sourceId: 'series', start: payload.start, end: payload.end, isRecurringInstance: true, isAllday: false } as CalendarEvent;
beforeEach(() => { vi.restoreAllMocks(); vi.mocked(calendarApi.putCalDav).mockReset(); vi.mocked(calendarApi.fetchCalDav).mockResolvedValue(original); });
describe('Google recurrence writes', () => {
  it('requests a new Meet only when enabled on creation', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"id":"new"}'));
    await createEvent('token', cal, { ...payload, onlineMeeting: true });
    expect(String(fetchMock.mock.calls[0][0])).toContain('conferenceDataVersion=1');
    const request = JSON.parse(fetchMock.mock.calls[0][1]!.body as string).conferenceData.createRequest;
    expect(request.conferenceSolutionKey.type).toBe('hangoutsMeet');
    expect(request.requestId).toBeTruthy();
    await createEvent('token', cal, { ...payload, onlineMeeting: false });
    expect(String(fetchMock.mock.calls[1][0])).not.toContain('conferenceDataVersion');
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).not.toHaveProperty('conferenceData');
    await updateEvent('token', cal, 'event', { ...payload, onlineMeeting: true });
    expect(JSON.parse(fetchMock.mock.calls[2][1]!.body as string)).not.toHaveProperty('conferenceData');
  });
  it('sends recurrence and the expansion time zone on creation', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"id":"new"}'));
    await createEvent('token', cal, payload);
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body.recurrence).toEqual([`RRULE:${payload.recurrence}`]);
    expect(body.start.timeZone).toBe('Europe/Paris');
  });
  it('preserves an existing recurrence by omitting it from a PATCH and removes it explicitly', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}'));
    await updateEvent('token', cal, 'event', { ...payload, recurrence: undefined });
    expect(fetchMock.mock.calls[0][1]!.method).toBe('PATCH');
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).not.toHaveProperty('recurrence');
    await updateEvent('token', cal, 'event', { ...payload, recurrence: '' });
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string).recurrence).toEqual([]);
  });
});
describe('CalDAV recurrence writes', () => {
  it('creates a recurring resource', async () => {
    await createNextcloudEvent(cal, payload);
    expect(vi.mocked(calendarApi.putCalDav).mock.calls[0][1]).toContain(`RRULE:${payload.recurrence}`);
  });
  it('preserves recurrence and custom properties when editing a series', async () => {
    await updateNextcloudEvent(cal, 'series', { ...payload, recurrence: undefined }, source, true);
    const content = vi.mocked(calendarApi.putCalDav).mock.calls[0][1];
    expect(content).toContain('RRULE:FREQ=WEEKLY');
    expect(content).toContain('X-CUSTOM:preserve');
    expect(content).toContain('EXDATE:20261008T140000Z');
    expect(content).toContain('DTSTART:20261001T140000Z');
  });
  it('writes an exception without changing the master rule', async () => {
    await updateNextcloudEvent(cal, 'series', { ...payload, title: 'Exception', recurrence: undefined }, source, false);
    const component = new ICAL.Component(ICAL.parse(vi.mocked(calendarApi.putCalDav).mock.calls[0][1]));
    const events = component.getAllSubcomponents('vevent');
    expect(events).toHaveLength(2);
    expect(events[0].getFirstPropertyValue('summary')).toBe('Original');
    expect(events[0].hasProperty('rrule')).toBe(true);
    expect(events[1].getFirstPropertyValue('summary')).toBe('Exception');
    expect(events[1].hasProperty('recurrence-id')).toBe(true);
    expect(events[1].hasProperty('rrule')).toBe(false);
  });
  it('removes a recurrence only when requested', async () => {
    await updateNextcloudEvent(cal, 'series', { ...payload, recurrence: '' }, source, true);
    expect(vi.mocked(calendarApi.putCalDav).mock.calls[0][1]).not.toContain('RRULE:');
  });
});
