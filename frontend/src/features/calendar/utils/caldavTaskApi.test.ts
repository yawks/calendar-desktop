// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
// @ts-ignore ical.js v1 has no bundled declarations
import ICAL from 'ical.js';
import { calendarApi } from '../../../shared/api/calendarApi';
import type { CalendarConfig, CalendarEvent } from '../../../shared/types';
import { parseCalDavTasks } from './parseCalDavTasks';
import { canEditCalDavTask, moveCalDavTask, isCalDavTaskConflict, reloadCalDavTask, updateCalDavTask } from './caldavTaskApi';
import i18n from '../../../i18n';
import { toTUIEvents } from './calendarUtils';
vi.mock('../../../shared/api/calendarApi', () => ({ calendarApi: { fetchCalDavResource: vi.fn(), putCalDav: vi.fn() } }));
const cal: CalendarConfig = { id: 'open', name: 'OpenTodo', type: 'nextcloud', url: 'http://localhost:8080/dav/', visible: true, color: '#123456', readOnly: true, nextcloudUsername: 'fixture', nextcloudPassword: 'fixture-password' };
const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VTODO', 'UID:task', 'SUMMARY:Original', 'DUE:20261022T120000Z', 'DTSTART:20261022T120000Z', 'DESCRIPTION:Original description', 'CATEGORIES:Red\\, green,Blue', 'RRULE:FREQ=WEEKLY', 'X-OPENTODO-START:SOMEDAY', 'RELATED-TO:parent', 'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT15M', 'DESCRIPTION:Reminder', 'END:VALARM', 'END:VTODO', 'END:VCALENDAR'].join('\r\n');
function event(text = ics): CalendarEvent {
  const parsed = parseCalDavTasks(text, cal)[0];
  return { ...parsed, readOnly: false, caldavTask: { ...parsed.caldavTask!, resourceUrl: 'http://localhost:8080/dav/calendars/me/project/custom-resource.ics', etag: '"v1"', project: 'Project' } };
}
beforeEach(async () => {
  await i18n.changeLanguage('fr');
  vi.mocked(calendarApi.fetchCalDavResource).mockResolvedValue({ text: ics, etag: '"v1"' });
  vi.mocked(calendarApi.putCalDav).mockResolvedValue();
});
afterEach(() => vi.resetAllMocks());
it('updates the exact VTODO resource from a DAV root, preserves project, labels, recurrence, alarms and unknown properties', async () => {
  const task = event();
  expect(task.caldavTask!.categories).toEqual(['Red, green', 'Blue']);
  expect(canEditCalDavTask(task, cal)).toBe(true);
  await updateCalDavTask(task, cal, { title: 'New title', description: 'New notes', due: '2026-10-23T13:00:00Z', start: task.caldavTask!.start, completed: false });
  const [auth, content, etag] = vi.mocked(calendarApi.putCalDav).mock.calls[0];
  expect(auth.url).toBe(task.caldavTask!.resourceUrl);
  expect(etag).toBe('"v1"');
  const component = new ICAL.Component(ICAL.parse(content)).getFirstSubcomponent('vtodo');
  expect(component.getFirstPropertyValue('summary')).toBe('New title');
  expect(component.getFirstPropertyValue('description')).toBe('New notes');
  expect(component.getFirstPropertyValue('due').toString()).toBe('2026-10-23T13:00:00Z');
  expect(component.getFirstPropertyValue('dtstart').toString()).toBe('2026-10-23T13:00:00Z');
  expect(component.getFirstPropertyValue('rrule').toString()).toBe('FREQ=WEEKLY');
  expect(component.getFirstProperty('categories').getValues()).toEqual(['Red, green', 'Blue']);
  expect(component.getFirstSubcomponent('valarm')).toBeTruthy();
  expect(component.getFirstPropertyValue('x-opentodo-start')).toBe('SOMEDAY');
  expect(component.getFirstPropertyValue('related-to')).toBe('parent');
  expect(content).not.toContain('fixture-password');
});
it('preserves an independent start date when changing a deadline and supports completion', async () => {
  const text = ics.replace('DUE:20261022T120000Z', 'DUE;VALUE=DATE:20261024');
  vi.mocked(calendarApi.fetchCalDavResource).mockResolvedValue({ text, etag: '"v1"' });
  await updateCalDavTask(event(text), cal, { title: 'Finished', description: 'Notes', due: '2026-10-25', start: '2026-10-22T12:00:00Z', completed: true });
  const component = new ICAL.Component(ICAL.parse(vi.mocked(calendarApi.putCalDav).mock.calls[0][1])).getFirstSubcomponent('vtodo');
  expect(component.getFirstPropertyValue('dtstart').toString()).toBe('2026-10-22T12:00:00Z');
  expect(component.getFirstPropertyValue('due').isDate).toBe(true);
  expect(component.getFirstPropertyValue('status')).toBe('COMPLETED');
  expect(component.getFirstPropertyValue('completed')).toBeTruthy();
  expect(component.getFirstPropertyValue('percent-complete')).toBe(100);
});
it.each([undefined, 'Europe/Paris'])('preserves floating or named-zone dates when editing and removes TZID when switching to a date only (%s)', async zone => {
  const parameters = zone ? `;TZID=${zone}` : '';
  const text = ics.replace('DUE:20261022T120000Z', `DUE${parameters}:20261022T120000`)
    .replace('DTSTART:20261022T120000Z', `DTSTART${parameters}:20261022T120000`);
  vi.mocked(calendarApi.fetchCalDavResource).mockResolvedValue({ text, etag: '"v1"' });
  const task = event(text);
  await updateCalDavTask(task, cal, { title: 'Changed', description: '', due: '2026-10-23T14:30:00', start: task.caldavTask!.start, completed: false });
  let component = new ICAL.Component(ICAL.parse(vi.mocked(calendarApi.putCalDav).mock.calls[0][1])).getFirstSubcomponent('vtodo');
  expect(component.getFirstPropertyValue('due').toString()).toBe('2026-10-23T14:30:00');
  expect(component.getFirstProperty('due').getParameter('tzid')).toBe(zone);
  await updateCalDavTask(task, cal, { title: 'Changed', description: '', due: '2026-10-23', start: task.caldavTask!.start, completed: false });
  component = new ICAL.Component(ICAL.parse(vi.mocked(calendarApi.putCalDav).mock.calls[1][1])).getFirstSubcomponent('vtodo');
  expect(component.getFirstPropertyValue('due').isDate).toBe(true);
  expect(component.getFirstProperty('due').getParameter('tzid')).toBeUndefined();
});
it.each([null, '"v2"'])('refuses stale or missing ETags without sending a write (%s)', async etag => {
  vi.mocked(calendarApi.fetchCalDavResource).mockResolvedValue({ text: ics, etag });
  await expect(updateCalDavTask(event(), cal, { title: 'New', description: '', due: '2026-10-22', completed: false })).rejects.toThrow('caldav_task_conflict');
  expect(calendarApi.putCalDav).not.toHaveBeenCalled();
});
it('propagates a racing 412 and reloads the new server version only on explicit reload', async () => {
  vi.mocked(calendarApi.putCalDav).mockRejectedValue({ detail: 'provider_http_412' });
  const error = await updateCalDavTask(event(), cal, { title: 'New', description: '', due: '2026-10-22', completed: false }).catch(error => error);
  expect(isCalDavTaskConflict(error)).toBe(true);
  expect(calendarApi.putCalDav).toHaveBeenCalledTimes(1);
  vi.mocked(calendarApi.fetchCalDavResource).mockResolvedValue({ text: ics.replace('SUMMARY:Original', 'SUMMARY:Remote title'), etag: '"v2"' });
  const reloaded = await reloadCalDavTask(event(), cal);
  expect(reloaded.caldavTask).toMatchObject({ title: 'Remote title', etag: '"v2"', project: 'Project' });
});
it('refuses read-only/shared tasks and cross-origin resources before forwarding credentials', async () => {
  const draft = { title: 'New', description: '', due: '2026-10-22', completed: false };
  await expect(updateCalDavTask({ ...event(), readOnly: true }, cal, draft)).rejects.toThrow();
  await expect(updateCalDavTask(event(), { ...cal, shared: { ownerEmail: 'other@example.test' } }, draft)).rejects.toThrow();
  const task = event(); task.caldavTask!.resourceUrl = 'http://attacker.test/task.ics';
  await expect(updateCalDavTask(task, cal, draft)).rejects.toThrow('shared_invalid_dav_url');
  expect(calendarApi.fetchCalDavResource).not.toHaveBeenCalled();
  expect(calendarApi.putCalDav).not.toHaveBeenCalled();
});

it('moves timed tasks without converting them into events and shifts both dates', async () => {
  const task = event();
  expect(toTUIEvents([task], [cal], false, [], {})[0].isReadOnly).toBe(false);
  expect(toTUIEvents([{ ...task, readOnly: true }], [cal], false, [], {})[0].isReadOnly).toBe(true);
  const target = new Date(task.start); target.setDate(target.getDate() + 2); target.setHours(target.getHours() + 1);
  await moveCalDavTask(task, cal, target);
  const component = new ICAL.Component(ICAL.parse(vi.mocked(calendarApi.putCalDav).mock.calls[0][1])).getFirstSubcomponent('vtodo');
  expect(component.getFirstPropertyValue('due').toString()).toBe('2026-10-24T13:00:00Z');
  expect(component.getFirstPropertyValue('dtstart').toString()).toBe('2026-10-24T13:00:00Z');
  expect(vi.mocked(calendarApi.putCalDav).mock.calls[0][2]).toBe('"v1"');
});
it('moves all-day deadlines by calendar days while retaining their timed start', async () => {
  const text = ics.replace('DUE:20261022T120000Z', 'DUE;VALUE=DATE:20261024');
  vi.mocked(calendarApi.fetchCalDavResource).mockResolvedValue({ text, etag: '"v1"' });
  const task = event(text);
  const target = new Date(task.start); target.setDate(target.getDate() + 1);
  await moveCalDavTask(task, cal, target);
  const component = new ICAL.Component(ICAL.parse(vi.mocked(calendarApi.putCalDav).mock.calls[0][1])).getFirstSubcomponent('vtodo');
  expect(component.getFirstPropertyValue('due').toString()).toBe('2026-10-25');
  expect(component.getFirstPropertyValue('dtstart').toString()).toBe('2026-10-23T12:00:00Z');
});
