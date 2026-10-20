// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../../i18n';
import { calendarApi } from '../../../shared/api/calendarApi';
import type { CalendarConfig } from '../../../shared/types';
import { calDavLoadError, loadCalDavCalendar } from './loadCalDavCalendar';
import { parseCalDavTasks } from './parseCalDavTasks';
import { isCalendarWritable } from './sharedCalendars';
import { toTUIEvents } from './calendarUtils';

vi.mock('../../../shared/api/calendarApi', () => ({ calendarApi: { queryCalDav: vi.fn() } }));
const cal: CalendarConfig = { id: 'opentodo', name: 'OpenTodo', type: 'nextcloud', url: 'http://localhost:8080/dav/', nextcloudUsername: 'test@example.test', nextcloudPassword: 'fixture-secret', visible: true, color: '#123456' };
const xml = (...responses: string[]) => `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${responses.join('')}</d:multistatus>`;
const response = (href: string, properties: string) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${properties}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
const collection = (href: string, components = ['VTODO']) => response(href, `<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set>${components.map(name => `<c:comp name="${name}"/>`).join('')}</c:supported-calendar-component-set>`);
const taskIcs = (...lines: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VTODO', 'UID:task-one', 'SUMMARY:Préparer le dossier', ...lines, 'END:VTODO', 'END:VCALENDAR'].join('\r\n');
const data = (href: string, ics: string) => response(href, `<c:calendar-data>${ics.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</c:calendar-data>`);

beforeEach(async () => {
  await i18n.changeLanguage('fr');
  vi.mocked(calendarApi.queryCalDav).mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

it('discovers OpenTodo projects from /dav/ and reads due-only tasks using REPORT', async () => {
  vi.mocked(calendarApi.queryCalDav)
    .mockResolvedValueOnce(xml(response('/dav/', '<d:current-user-principal><d:href>/dav/principals/me/</d:href></d:current-user-principal>')))
    .mockResolvedValueOnce(xml(response('/dav/principals/me/', '<c:calendar-home-set><d:href>/dav/calendars/me/</d:href></c:calendar-home-set>')))
    .mockResolvedValueOnce(xml(collection('/dav/calendars/me/inbox/'), collection('/dav/calendars/me/project/')))
    .mockResolvedValueOnce(xml(data('/dav/calendars/me/inbox/task.ics', taskIcs('DUE;VALUE=DATE:20261022'))))
    .mockResolvedValueOnce(xml(data('/dav/calendars/me/project/task.ics', taskIcs('DUE:20261023T143000Z'))));
  const result = await loadCalDavCalendar(cal);
  expect(result.readOnly).toBe(true);
  expect(result.events).toHaveLength(2);
  expect(result.events[0]).toMatchObject({ title: 'Tâche : Préparer le dossier', start: '2026-10-22T00:00:00', end: '2026-10-23T00:00:00', isAllday: true, readOnly: true, isTask: true });
  expect(result.events[1]).toMatchObject({ start: '2026-10-23T14:30:00.000Z', end: '2026-10-23T15:00:00.000Z', readOnly: true });
  expect(new Set(result.events.map(event => event.id)).size).toBe(2);
  expect(result.events.every(event => !event.sourceId)).toBe(true);
  const reports = vi.mocked(calendarApi.queryCalDav).mock.calls.filter(call => call[1] === 'REPORT');
  expect(reports).toHaveLength(2);
  expect(reports.every(call => call[3].includes('name="VTODO"') && !call[3].includes('time-range'))).toBe(true);
  expect(vi.mocked(calendarApi.queryCalDav).mock.calls.every(call => call[0].password === 'fixture-secret' && !call[0].url.includes('?export'))).toBe(true);
  expect(isCalendarWritable({ ...cal, readOnly: result.readOnly })).toBe(false);
  expect(toTUIEvents(result.events, [cal], false, [], {}).every(event => event.isReadOnly)).toBe(true);
});

it('reads a direct Nextcloud event collection with REPORT and preserves event IDs and write access', async () => {
  const direct = { ...cal, url: 'http://localhost:8080/remote.php/dav/calendars/me/personal/' };
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:event', 'SUMMARY:Meeting', 'DTSTART:20261022T120000Z', 'DTEND:20261022T130000Z', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  vi.mocked(calendarApi.queryCalDav).mockResolvedValueOnce(xml(collection(direct.url, ['VEVENT'])))
    .mockResolvedValueOnce(xml(data(`${direct.url}event.ics`, ics)));
  const result = await loadCalDavCalendar(direct);
  expect(result.readOnly).toBe(false);
  expect(result.events[0]).toMatchObject({ id: 'opentodo-event-2026-10-22T12:00:00Z', sourceId: 'event', title: 'Meeting', readOnly: false });
  expect(vi.mocked(calendarApi.queryCalDav).mock.calls[1][3]).toContain('name="VEVENT"');
});

it('accepts a calendar-home URL and an empty task list', async () => {
  const home = { ...cal, url: `${cal.url}calendars/me/` };
  vi.mocked(calendarApi.queryCalDav).mockResolvedValueOnce(xml(response(home.url, '<d:resourcetype><d:collection/></d:resourcetype>')))
    .mockResolvedValueOnce(xml(collection(`${home.url}inbox/`))).mockResolvedValueOnce(xml());
  expect(await loadCalDavCalendar(home)).toEqual({ events: [], readOnly: true });
});

it.each([true, false])('carries project names and labels and only enables editing with write privileges and an ETag (writable=%s)', async writable => {
  const direct = { ...cal, url: `${cal.url}calendars/me/project/` };
  const properties = '<d:resourcetype><c:calendar/></d:resourcetype><d:displayname>Project Alpha</d:displayname><c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>'
    + `<d:current-user-privilege-set><d:privilege><d:${writable ? 'write-content' : 'read'}/></d:privilege></d:current-user-privilege-set>`;
  vi.mocked(calendarApi.queryCalDav).mockResolvedValueOnce(xml(response(direct.url, properties)))
    .mockResolvedValueOnce(xml(response(`${direct.url}task.ics`, `<d:getetag>"v1"</d:getetag><c:calendar-data>${taskIcs('DUE;VALUE=DATE:20261022', 'CATEGORIES:Urgent,Client')}</c:calendar-data>`)));
  const { events } = await loadCalDavCalendar(direct);
  expect(events[0].readOnly).toBe(!writable);
  expect(events[0].caldavTask).toMatchObject({ resourceUrl: `${direct.url}task.ics`, etag: '"v1"', project: 'Project Alpha', categories: ['Urgent', 'Client'] });
});

it('rejects a discovery link to another origin before forwarding credentials', async () => {
  vi.mocked(calendarApi.queryCalDav).mockResolvedValueOnce(xml(response('/dav/', '<d:current-user-principal><d:href>https://attacker.test/principal/</d:href></d:current-user-principal>')));
  await expect(loadCalDavCalendar(cal)).rejects.toThrow('shared_invalid_dav_url');
  expect(calendarApi.queryCalDav).toHaveBeenCalledTimes(1);
});

it('rejects invalid XML instead of treating it as an empty calendar', async () => {
  vi.mocked(calendarApi.queryCalDav).mockResolvedValue('<html>Login page</html>');
  await expect(loadCalDavCalendar(cal)).rejects.toThrow();
});

it.each(['fr', 'en'])('parses dated tasks with localized titles, skips completed/undated tasks, and preserves local dates (%s)', async language => {
  await i18n.changeLanguage(language);
  const tasks = parseCalDavTasks(taskIcs('DUE;VALUE=DATE:20261022', 'RRULE:FREQ=DAILY'), cal);
  expect(tasks).toHaveLength(1);
  expect(tasks[0].title).toBe(`${language === 'fr' ? 'Tâche : ' : 'Task: '}Préparer le dossier`);
  expect(tasks[0].start).toBe('2026-10-22T00:00:00');
  expect(parseCalDavTasks(taskIcs('DTSTART:20261022T123000Z'), cal)[0].start).toBe('2026-10-22T12:30:00.000Z');
  for (const lines of [[], ['DUE:20261022T123000Z', 'STATUS:COMPLETED'], ['DUE:20261022T123000Z', 'STATUS:CANCELLED'], ['DUE:20261022T123000Z', 'COMPLETED:20261022T130000Z']]) {
    expect(parseCalDavTasks(taskIcs(...lines), cal)).toEqual([]);
  }
});

it.each(['fr', 'en'])('shows HTTP errors from native string/object rejections without leaking URLs or credentials (%s)', async language => {
  await i18n.changeLanguage(language);
  expect(calDavLoadError('provider_http_405')).toContain('405');
  expect(calDavLoadError({ code: 'provider_request_failed', detail: 'provider_http_401' })).toBe(i18n.t('config.invalidCredentials'));
  expect(calDavLoadError(new Error('provider_http_403'))).toBe(i18n.t('config.accessForbidden'));
  expect(calDavLoadError('provider_http_404')).toBe(i18n.t('config.urlNotFound'));
  expect(calDavLoadError('failed request http://user:fixture-secret@localhost/')).toBe(i18n.t('config.caldavLoadFailed'));
});
