// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { CalendarConfig, CalendarEvent } from '../../../shared/types';
const fixtures = vi.hoisted(() => ({ calendars: [] as CalendarConfig[], events: [] as CalendarEvent[], timeline: vi.fn(), detail: vi.fn(), google: vi.fn(), exchange: vi.fn(), nextcloud: vi.fn() }));
vi.mock('../../calendar/store/CalendarStore', () => ({ useCalendars: () => ({ calendars: fixtures.calendars }) }));
vi.mock('../../../shared/store/GoogleAuthStore', () => ({ useGoogleAuth: () => ({ getValidToken: vi.fn() }) }));
vi.mock('../../../shared/store/ExchangeAuthStore', () => ({ useExchangeAuth: () => ({ getValidToken: vi.fn() }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn(), getQueryData: vi.fn() }) }));
vi.mock('../../calendar/hooks/useGoogleEvents', () => ({ useGoogleEvents: (calendars: CalendarConfig[]) => { fixtures.google(calendars); return { events: fixtures.events.filter(e => calendars.some(c => c.id === e.calendarId && c.type === 'google')), refresh: vi.fn() }; }, patchGoogleCachedRsvp: vi.fn() }));
vi.mock('../../calendar/hooks/useNextcloudEvents', () => ({ useNextcloudEvents: (calendars: CalendarConfig[]) => { fixtures.nextcloud(calendars); return { events: fixtures.events.filter(e => calendars.some(c => c.id === e.calendarId && c.type === 'nextcloud')), refresh: vi.fn() }; }, patchNextcloudCachedRsvp: vi.fn() }));
vi.mock('../../calendar/hooks/useCalendarQueries', () => ({ CALENDAR_KEYS: { events: vi.fn() }, useCalendarEvents: (calendars: CalendarConfig[]) => { fixtures.exchange(calendars); return { events: fixtures.events.filter(e => calendars.some(c => c.id === e.calendarId && c.type === 'exchange')) }; } }));
vi.mock('../../calendar/hooks/useEWSEvents', () => ({ patchEWSCachedRsvp: vi.fn() }));
vi.mock('../../calendar/components/DayEventsTimeline', () => ({ DayEventsTimeline: (props: unknown) => { fixtures.timeline(props); return null; } }));
vi.mock('../../calendar/components/EventModal', () => ({ default: (props: unknown) => { fixtures.detail(props); return <div data-testid="preview-event-detail" />; } }));
vi.mock('./EmailHtmlBody', () => ({ EmailHtmlBody: () => null }));
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
