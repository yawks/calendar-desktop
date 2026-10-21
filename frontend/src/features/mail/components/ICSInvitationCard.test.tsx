// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { CalendarConfig, CalendarEvent } from '../../../shared/types';
const fixtures = vi.hoisted(() => ({ calendars: [] as CalendarConfig[], events: [] as CalendarEvent[], timeline: vi.fn(), detail: vi.fn(), google: vi.fn(), exchange: vi.fn(), nextcloud: vi.fn(), refetch: vi.fn(), queryData: [] as CalendarEvent[] }));
vi.mock('../../calendar/store/CalendarStore', () => ({ useCalendars: () => ({ calendars: fixtures.calendars }) }));
vi.mock('../../../shared/store/GoogleAuthStore', () => ({ useGoogleAuth: () => ({ getValidToken: vi.fn().mockResolvedValue('token') }) }));
vi.mock('../../../shared/store/ExchangeAuthStore', () => ({ useExchangeAuth: () => ({ accounts: [{ id: 'account', email: 'me@example.test', displayName: 'Me' }], getValidToken: vi.fn().mockResolvedValue('token') }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn(), refetchQueries: fixtures.refetch, getQueryData: () => fixtures.queryData }) }));
vi.mock('../../calendar/hooks/useGoogleEvents', () => ({ useGoogleEvents: (calendars: CalendarConfig[]) => { fixtures.google(calendars); return { events: fixtures.events.filter(e => calendars.some(c => c.id === e.calendarId && c.type === 'google')), refresh: vi.fn() }; }, patchGoogleCachedRsvp: vi.fn() }));
vi.mock('../../calendar/hooks/useNextcloudEvents', () => ({ useNextcloudEvents: (calendars: CalendarConfig[]) => { fixtures.nextcloud(calendars); return { events: fixtures.events.filter(e => calendars.some(c => c.id === e.calendarId && c.type === 'nextcloud')), refresh: vi.fn() }; }, patchNextcloudCachedRsvp: vi.fn() }));
vi.mock('../../calendar/hooks/useCalendarQueries', () => ({ CALENDAR_KEYS: { events: vi.fn() }, useCalendarEvents: (calendars: CalendarConfig[]) => { fixtures.exchange(calendars); return { events: fixtures.events.filter(e => calendars.some(c => c.id === e.calendarId && c.type === 'exchange')) }; } }));
vi.mock('../../calendar/hooks/useEWSEvents', () => ({ patchEWSCachedRsvp: vi.fn() }));
vi.mock('../../calendar/components/DayEventsTimeline', () => ({ DayEventsTimeline: (props: unknown) => { fixtures.timeline(props); return null; } }));
vi.mock('../../calendar/components/EventModal', () => ({ default: (props: unknown) => { fixtures.detail(props); return <div data-testid="preview-event-detail" />; } }));
vi.mock('./EmailHtmlBody', () => ({ EmailHtmlBody: () => null }));
vi.mock('../../calendar/utils/googleCalendarApi', () => ({ updateEvent: vi.fn(), respondToGoogleEvent: vi.fn(), createEvent: vi.fn() }));
vi.mock('../../calendar/utils/nextcloudCalendarApi', () => ({ updateNextcloudEvent: vi.fn(), respondToNextcloudEvent: vi.fn(), createNextcloudEvent: vi.fn() }));
vi.mock('../../../shared/api/exchangeCalendarApi', () => ({ exchangeCalendarApi: { update: vi.fn() } }));
import { updateEvent } from '../../calendar/utils/googleCalendarApi';
import { updateNextcloudEvent } from '../../calendar/utils/nextcloudCalendarApi';
import { exchangeCalendarApi } from '../../../shared/api/exchangeCalendarApi';
import { ICSInvitationCard } from './ICSInvitationCard';
import '../../../i18n';

it('excludes shared calendars from fetching, selection and the day preview for every provider', async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const personal = (['google', 'exchange', 'nextcloud'] as const).map(type => ({ id: type, name: `Personal ${type}`, type, url: 'https://calendar.example.test/', color: '#123456', visible: true, googleAccountId: 'me@example.test', exchangeAccountId: 'me@example.test', ownerEmail: 'me@example.test' }));
  const shared = personal.map(cal => ({ ...cal, id: `shared-${cal.id}`, name: `Shared ${cal.type}`, shared: { ownerEmail: 'other@example.test' } }));
  fixtures.calendars = [...personal, ...shared, { ...personal[0], id: 'ics', name: 'ICS feed', type: 'ics' }];
  fixtures.events = fixtures.calendars.map(cal => ({ id: `event-${cal.id}`, calendarId: cal.id, title: cal.name, start: '2026-10-19T10:00:00Z', end: '2026-10-19T11:00:00Z', isAllday: false, category: 'time' }));
  const host = document.createElement('div'); host.className = 'mail-thread-detail'; document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ICSInvitationCard currentUserEmail="me@example.test" mailProviderType="gmail" source={{ kind: 'text', icsText: 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:invite\r\nDTSTART:20261019T120000Z\r\nDTEND:20261019T130000Z\r\nSUMMARY:Invitation\r\nEND:VEVENT\r\nEND:VCALENDAR' }} />));
    for (const fetch of [fixtures.google, fixtures.exchange, fixtures.nextcloud]) expect(fetch).toHaveBeenLastCalledWith(personal);
    const preview = fixtures.timeline.mock.calls.at(-1)![0] as { calendars: CalendarConfig[]; events: CalendarEvent[]; onEventClick: (event: CalendarEvent) => void };
    expect(preview.calendars).toEqual(personal);
    expect(preview.events.some(event => event.calendarId.startsWith('shared-') || event.calendarId === 'ics')).toBe(false);
    expect(preview.events.filter(event => event.id.startsWith('event-'))).toHaveLength(3);
    await act(async () => host.querySelector<HTMLButtonElement>('.ics-cal-selector__btn')!.click());
    expect(document.body.textContent).not.toContain('Shared google');
    expect(document.body.textContent).not.toContain('Shared exchange');
    expect(document.body.textContent).not.toContain('Shared nextcloud');
    expect(document.body.textContent).not.toContain('ICS feed');
    for (const cal of personal) expect(document.body.textContent).toContain(cal.name);
    await act(async () => preview.onEventClick(preview.events[0]));
    expect(document.body.querySelector('[data-testid="preview-event-detail"]')?.parentElement).toBe(document.body);
    expect(host.querySelector('[data-testid="preview-event-detail"]')).toBeNull();
    expect(fixtures.detail).toHaveBeenLastCalledWith(expect.objectContaining({ event: preview.events[0], calendar: personal[0], readOnly: true, allowTagEditing: true, anchorElement: host }));
    const detail = fixtures.detail.mock.calls.at(-1)![0];
    expect(detail.onEdit).toBeUndefined();
    expect(detail.onRsvp).toBeUndefined();
    expect(detail.onDelete).toBeUndefined();
    const invitationPreview = preview.events.find(event => event.id === '__ics_preview__')!;
    expect(invitationPreview).toBeDefined();
    await act(async () => preview.onEventClick(invitationPreview));
    expect(fixtures.detail).toHaveBeenLastCalledWith(expect.objectContaining({ allowTagEditing: false }));
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it.each(['google', 'exchange', 'nextcloud'] as const)('keeps the preview and rejects an RSVP without creating a replacement on %s', async (type) => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  fixtures.calendars = [{ id: type, type, name: type, url: 'https://calendar.example.test/', color: '#123456', visible: true, ownerEmail: 'me@example.test' }];
  fixtures.events = [];
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ICSInvitationCard currentUserEmail="me@example.test" source={{ kind: 'text', icsText: 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:invite\r\nDTSTART:20261019T120000Z\r\nDTEND:20261019T130000Z\r\nSUMMARY:Invitation\r\nEND:VEVENT\r\nEND:VCALENDAR' }} />));
    await act(async () => host.querySelector<HTMLButtonElement>('.ics-btn--accept')!.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('invitation');
    expect(fixtures.timeline.mock.calls.at(-1)![0].events).toEqual([expect.objectContaining({ id: '__ics_preview__', title: 'Invitation' })]);
  } finally { await act(async () => root.unmount()); host.remove(); }
});


it.each(['google', 'exchange', 'nextcloud'] as const)('shows COUNTER as a proposal without RSVP or duplicate creation on %s', async (type) => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  fixtures.calendars = [{ id: type, type, name: type, url: 'https://calendar.example.test/', color: '#123456', visible: true }];
  fixtures.events = [];
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'METHOD:COUNTER',
    'BEGIN:VTIMEZONE', 'TZID:Romance Standard Time',
    'BEGIN:STANDARD', 'DTSTART:16010101T030000', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10', 'END:STANDARD',
    'BEGIN:DAYLIGHT', 'DTSTART:16010101T020000', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3', 'END:DAYLIGHT', 'END:VTIMEZONE',
    'BEGIN:VEVENT', 'UID:proposal', 'SUMMARY:New time proposed: Meeting',
    'DTSTART;TZID=Romance Standard Time:20261023T100000', 'DTEND;TZID=Romance Standard Time:20261023T110000',
    'RECURRENCE-ID;TZID=Romance Standard Time:20261023T100000', 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  try {
    await act(async () => root.render(<ICSInvitationCard source={{ kind: 'text', icsText: ics }} />));
    expect(host.querySelector('.ics-card__label')?.textContent).toMatch(/Nouvel horaire proposé|New time proposed/);
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    expect(host.querySelectorAll('.ics-card__actions button')).toHaveLength(2);
    expect(host.querySelector('input[type=radio]')).toBeNull();
    const preview = fixtures.timeline.mock.calls.at(-1)![0];
    expect(preview.events).toEqual([expect.objectContaining({ start: '2026-10-23T08:00:00.000Z', end: '2026-10-23T09:00:00.000Z' })]);
    expect(preview.highlightedEventId).toBe('__ics_preview__');
    await act(async () => root.render(<ICSInvitationCard source={{ kind: 'text', icsText: ics.replace('20261023T110000', '20261023T113000') }} />));
    expect(fixtures.timeline.mock.calls.at(-1)![0].events[0].end).toBe('2026-10-23T09:30:00.000Z');
  } finally { await act(async () => root.unmount()); host.remove(); }
});


it.each(['google', 'exchange', 'nextcloud'] as const)('automatically reschedules the corresponding meeting on %s', async type => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(updateEvent).mockClear();
  vi.mocked(updateNextcloudEvent).mockClear();
  vi.mocked(exchangeCalendarApi.update).mockClear();
  fixtures.calendars = [{ id: type, type, name: type, url: 'https://calendar.example.test/', color: '#123456', visible: true, ownerEmail: 'me@example.test', googleAccountId: 'account', exchangeAccountId: 'account' }];
  fixtures.events = [{ id: 'original', sourceId: 'original|key', calendarId: type, title: 'Meeting', start: '2026-10-22T08:00:00Z', end: '2026-10-22T09:00:00Z', isAllday: false, category: 'time', attendees: [{ name: 'Me', email: type === 'exchange' ? '' : 'me@example.test', isOrganizer: true, status: 'ACCEPTED' }] }];
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'METHOD:COUNTER', 'BEGIN:VEVENT', 'UID:proposal', 'SUMMARY:Meeting', 'DTSTART:20261023T100000Z', 'DTEND:20261023T110000Z', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  try {
    await act(async () => root.render(<ICSInvitationCard currentUserEmail="alias@example.test" source={{ kind: 'text', icsText: ics }} />));
    const button = host.querySelector<HTMLButtonElement>('.ics-btn--accept')!;
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    const payload = expect.objectContaining({ title: 'Meeting', start: '2026-10-23T10:00:00.000Z', end: '2026-10-23T11:00:00.000Z' });
    if (type === 'google') expect(updateEvent).toHaveBeenCalledWith('token', fixtures.calendars[0], 'original|key', payload, undefined, true);
    if (type === 'nextcloud') expect(updateNextcloudEvent).toHaveBeenCalledWith(fixtures.calendars[0], 'original|key', payload, fixtures.events[0]);
    if (type === 'exchange') expect(exchangeCalendarApi.update).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'original', changeKey: 'key', start: '2026-10-23T10:00:00.000Z' }));
    expect(host.querySelector('.ics-card__feedback--success')).not.toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});


it.each([false, true])('declines the proposal without modifying the calendar (send failure: %s)', async fail => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  fixtures.calendars = [];
  fixtures.events = [];
  vi.mocked(updateEvent).mockClear();
  vi.mocked(updateNextcloudEvent).mockClear();
  vi.mocked(exchangeCalendarApi.update).mockClear();
  const send = fail ? vi.fn().mockRejectedValue(new Error('Send failed')) : vi.fn().mockResolvedValue(undefined);
  const text = 'BEGIN:VCALENDAR\r\nMETHOD:COUNTER\r\nBEGIN:VEVENT\r\nUID:meeting\r\nSUMMARY:Meeting\r\nDTSTART:20261023T100000Z\r\nDTEND:20261023T110000Z\r\nEND:VEVENT\r\nEND:VCALENDAR';
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ICSInvitationCard source={{ kind: 'text', icsText: text }} onDeclineCounter={send} />));
    await act(async () => host.querySelector<HTMLButtonElement>('.ics-btn--decline')!.click());
    expect(send).toHaveBeenCalledWith(text, 'Meeting');
    expect(updateEvent).not.toHaveBeenCalled();
    expect(updateNextcloudEvent).not.toHaveBeenCalled();
    expect(exchangeCalendarApi.update).not.toHaveBeenCalled();
    expect(host.querySelector(fail ? '[role="alert"]' : '.ics-card__feedback--success')).not.toBeNull();
    expect(host.querySelector<HTMLButtonElement>('.ics-btn--decline')!.disabled).toBe(!fail);
  } finally { await act(async () => root.unmount()); host.remove(); }
});


it.each([
  ['exchange', 'success'], ['exchange', 'failure'], ['exchange', 'already-saved'], ['exchange', 'conflict'],
  ['google', 'success'], ['google', 'failure'], ['nextcloud', 'success'], ['nextcloud', 'failure'],
] as const)('optimistically replaces the old slot on %s and reconciles %s', async (type, outcome) => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const cal = { id: type, type, name: 'Calendar', ownerEmail: 'me@example.test', exchangeAccountId: 'account', googleAccountId: 'account' } as CalendarConfig;
  const original: CalendarEvent = { id: 'original', sourceId: 'original|old-key', icalUid: 'meeting', calendarId: cal.id, title: 'Meeting', start: '2026-10-23T08:00:00Z', end: '2026-10-23T09:00:00Z', isAllday: false, category: 'time' };
  fixtures.calendars = [cal]; fixtures.events = [original];
  fixtures.queryData = outcome === 'already-saved' ? [{ ...original, start: '2026-10-23T10:00:00Z', end: '2026-10-23T11:00:00Z' }] : [original];
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const request = () => new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  if (type === 'exchange') vi.mocked(exchangeCalendarApi.update).mockImplementationOnce(request);
  if (type === 'google') vi.mocked(updateEvent).mockImplementationOnce(request);
  if (type === 'nextcloud') vi.mocked(updateNextcloudEvent).mockImplementationOnce(request);
  const text = 'BEGIN:VCALENDAR\r\nMETHOD:COUNTER\r\nBEGIN:VEVENT\r\nUID:meeting\r\nSUMMARY:Meeting\r\nDTSTART:20261023T100000Z\r\nDTEND:20261023T110000Z\r\nEND:VEVENT\r\nEND:VCALENDAR';
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<ICSInvitationCard source={{ kind: 'text', icsText: text }} />));
    await act(async () => host.querySelector<HTMLButtonElement>('.ics-btn--accept')!.click());
    let events = fixtures.timeline.mock.calls.at(-1)![0].events;
    expect(events).toEqual([expect.objectContaining({ id: original.id, start: '2026-10-23T10:00:00.000Z', selfRsvpStatus: 'ACCEPTED', isUnaccepted: false })]);
    await act(async () => {
      if (outcome === 'success') resolve();
      else reject(new Error(outcome === 'failure' ? 'Network failure' : 'EWS update ErrorIrresolvableConflict'));
    });
    events = fixtures.timeline.mock.calls.at(-1)![0].events;
    if (outcome === 'success' || outcome === 'already-saved') {
      expect(events).toHaveLength(1);
      expect(host.querySelector('[role="alert"]')).toBeNull();
      expect(host.querySelector('.ics-card__feedback--success')).not.toBeNull();
    } else {
      expect(events).toContainEqual(original);
      expect(events).toHaveLength(2);
      expect(host.querySelector('[role="alert"]')).not.toBeNull();
    }
  } finally { await act(async () => root.unmount()); host.remove(); }
});
