// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { calendarApi } from '../../../shared/api/calendarApi';
import { exchangeCalendarApi } from '../../../shared/api/exchangeCalendarApi';
import { mailCommand } from '../../../shared/api/mailApi';
import { calendarGroupId, sharedCalendarErrorKey, davResponses, discoverSharedCalendars, isCalendarWritable, resolveSharedCalDav, sameOriginDavUrl, searchSharedPeople, type SharedCalendarSource } from './sharedCalendars';
import type { CalendarConfig } from '../../../shared/types';

vi.mock('../../../shared/api/calendarApi', () => ({ calendarApi: { queryCalDav: vi.fn() } }));
vi.mock('../../../shared/api/exchangeCalendarApi', () => ({ exchangeCalendarApi: { shared: vi.fn() } }));
vi.mock('../../../shared/api/mailApi', () => ({ mailCommand: vi.fn() }));
const source: SharedCalendarSource = { id: 'account', type: 'google', name: 'Google', color: '#123456', getToken: async () => 'test-token' };
const cal: CalendarConfig = { id: 'source', name: 'Home', type: 'nextcloud', color: '#123456', visible: true, url: 'https://cloud.example/dav/calendars/me/home/', nextcloudUsername: 'me', nextcloudPassword: 'test-secret' };
const nc = { ...source, type: 'nextcloud' as const, calendar: cal };
function response(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status }); }
function multistatus(href: string, properties: string, status = 200) {
  return `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:s="http://sabredav.org/ns"><d:response><d:href>${href}</d:href><d:propstat><d:prop>${properties}</d:prop><d:status>HTTP/1.1 ${status} Status</d:status></d:propstat></d:response></d:multistatus>`;
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('rejects foreign and credential-bearing DAV URLs before passing credentials', () => {
  expect(sameOriginDavUrl(cal.url, '/dav/principals/other/')).toBe('https://cloud.example/dav/principals/other/');
  for (const url of ['https://evil.example/cal/', '//evil.example/cal/', 'http://cloud.example/cal/', 'https://user:secret@cloud.example/cal/', 'javascript:alert(1)', '']) {
    expect(() => sameOriginDavUrl(cal.url, url)).toThrow();
  }
});
it('parses DAV properties by namespace, ignores forbidden propstats and rejects invalid XML', () => {
  expect(davResponses(multistatus('/one/', '<d:displayname>Other &amp; team</d:displayname>'))[0].prop.textContent).toBe('Other & team');
  expect(davResponses(multistatus('/one/', '<d:displayname>Hidden</d:displayname>', 403))).toEqual([]);
  expect(() => davResponses('<html>error</html>')).toThrow();
});
it('resolves current CalDAV source credentials without copying them into the subscription', () => {
  const shared: CalendarConfig = { ...cal, id: 'shared', url: 'https://cloud.example/dav/other/', nextcloudPassword: undefined, shared: { sourceCalendarId: cal.id, ownerEmail: 'other@example.com' } };
  expect(resolveSharedCalDav(shared, [cal]).nextcloudPassword).toBe('test-secret');
  expect(shared.nextcloudPassword).toBeUndefined();
  expect(() => resolveSharedCalDav(shared, [])).toThrow('shared_auth_required');
  expect(() => resolveSharedCalDav({ ...shared, url: 'https://evil.example/' }, [cal])).toThrow();
});
it('fixes shared calendars to their group and excludes every provider from writable targets', () => {
  for (const type of ['google', 'exchange', 'nextcloud'] as const) {
    expect(isCalendarWritable({ ...cal, type })).toBe(true);
    const shared = { ...cal, type, groupId: 'work', shared: { ownerEmail: 'other@example.com' } };
    expect(isCalendarWritable(shared)).toBe(false);
    expect(calendarGroupId(shared)).toBe('other-calendars');
  }
  expect(isCalendarWritable(undefined)).toBe(false);
});
it('uses the EWS directory without needing an email-enabled account', async () => {
  vi.mocked(mailCommand).mockResolvedValue([{ name: 'Other', email: 'other@example.com' }]);
  await expect(searchSharedPeople({ ...source, type: 'exchange' }, 'Other')).resolves.toMatchObject({ people: [{ name: 'Other', email: 'other@example.com' }], directoryUnavailable: false });
  expect(mailCommand).toHaveBeenCalledWith('mail_search_contacts', { accessToken: 'test-token', query: 'Other', maxCount: 10 });
});
it('keeps multiple EWS folder references with no token in the saved configurations', async () => {
  vi.mocked(exchangeCalendarApi.shared).mockResolvedValue({ calendars: [{ id: 'one', name: 'Main' }, { id: 'two', name: 'Team' }], limitedDiscovery: true });
  const result = await discoverSharedCalendars({ ...source, type: 'exchange' }, { email: 'other@example.com' });
  expect(result.limited).toBe(true);
  expect(result.calendars.map(choice => choice.calendar.exchangeFolderId)).toEqual(['one', 'two']);
  expect(result.calendars[0].calendar).toMatchObject({ exchangeAccountId: 'account', shared: { ownerEmail: 'other@example.com' }, groupId: 'other-calendars', color: '#123456' });
  expect(JSON.stringify(result)).not.toContain('test-token');
});
it('combines Google contacts and the workspace directory while deduplicating email addresses', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('searchDirectoryPeople')
    ? response({ people: [{ names: [{ displayName: 'Other' }], emailAddresses: [{ value: 'other@example.com' }] }] })
    : response({ results: [{ person: { emailAddresses: [{ value: 'other@example.com' }] } }] })));
  expect((await searchSharedPeople(source, 'other')).people).toHaveLength(1);
});
it('paginates Google shared calendars, keeps multiple choices, excludes owners and free/busy-only calendars', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/events?')) return response({ items: [] });
    if (url.includes('/calendars/')) return response({ id: 'other@example.com', summary: 'Main' });
    return url.includes('pageToken=next')
      ? response({ items: [{ id: 'team', summary: 'Team', accessRole: 'reader' }] })
      : response({ items: [{ id: 'other@example.com', summary: 'Other', accessRole: 'reader' }, { id: 'me', summary: 'Mine', accessRole: 'owner' }, { id: 'busy', summary: 'Busy', accessRole: 'freeBusyReader' }], nextPageToken: 'next' });
  }));
  const result = await discoverSharedCalendars(source, { name: 'Other', email: 'other@example.com' });
  expect(result.limited).toBe(true);
  expect(result.calendars.map(choice => choice.calendar.googleCalendarId)).toEqual(['other@example.com', 'team']);
});
it('does not add a Google primary calendar whose event access is denied', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/events?') ? response({}, 403) : url.includes('/calendarList') ? response({ items: [] }) : response({ id: 'other@example.com', summary: 'Main' })));
  await expect(discoverSharedCalendars(source, { email: 'other@example.com' })).rejects.toThrow('shared_calendar_unavailable');
});
it('finds CalDAV people and multiple accessible event collections, excluding task-only collections', async () => {
  vi.mocked(calendarApi.queryCalDav).mockImplementation(async (_credentials, method, _depth, body) => {
    if (body.includes('<d:principal-collection-set/>')) return multistatus('/dav/', '<d:principal-collection-set><d:href>/principals/</d:href></d:principal-collection-set>');
    if (method === 'REPORT') return multistatus('/principals/other/', '<d:displayname>Other</d:displayname><s:email-address>other@example.com</s:email-address>');
    if (body.includes('<d:current-user-principal/>')) return multistatus('/dav/', '');
    if (body.includes('<c:calendar-home-set/>')) return multistatus('/principals/other/', '<c:calendar-home-set><d:href>/calendars/other/</d:href></c:calendar-home-set>');
    return multistatus('/calendars/other/one/', '<d:resourcetype><c:calendar/></d:resourcetype><d:displayname>One</d:displayname>')
      .replace('</d:multistatus>', '') + multistatus('/calendars/other/two/', '<d:resourcetype><c:calendar/></d:resourcetype><d:displayname>Two</d:displayname>').replace(/^.*?<d:response>/, '<d:response>').replace('</d:multistatus>', '') + multistatus('/calendars/other/tasks/', '<d:resourcetype><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>').replace(/^.*?<d:response>/, '<d:response>').replace('</d:multistatus>', '') + multistatus('/calendars/other/hidden/', '<d:resourcetype><c:calendar/></d:resourcetype><d:current-user-privilege-set><d:privilege><d:write/></d:privilege></d:current-user-privilege-set>').replace(/^.*?<d:response>/, '<d:response>');
  });
  const result = await discoverSharedCalendars(nc, { email: 'other@example.com' });
  expect(result.calendars).toHaveLength(2);
  expect(result.calendars[0].calendar.shared).toEqual({ ownerEmail: 'other@example.com', sourceCalendarId: cal.id });
  expect(result.calendars[0].calendar).not.toHaveProperty('nextcloudPassword');
});
it('finds Nextcloud shared bindings in our home when the owner home is not browsable', async () => {
  vi.mocked(calendarApi.queryCalDav).mockImplementation(async (_credentials, _method, _depth, body) => {
    if (body.includes('<d:current-user-principal/>')) return multistatus(cal.url, '<d:current-user-principal><d:href>/principals/me/</d:href></d:current-user-principal>');
    if (body.includes('<c:calendar-home-set/>')) return multistatus('/principals/me/', '<c:calendar-home-set><d:href>/calendars/me/</d:href></c:calendar-home-set>');
    return multistatus('/calendars/me/shared/', '<d:resourcetype><c:calendar/></d:resourcetype><d:displayname>Shared</d:displayname><d:owner><d:href>/principals/other/</d:href></d:owner><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>');
  });
  const result = await discoverSharedCalendars(nc, { email: 'other@example.com', principalUrl: 'https://cloud.example/principals/other/' });
  expect(result.calendars[0].calendar.url).toBe('https://cloud.example/calendars/me/shared/');
});

it('replaces EWS technical names with the email fallback and keeps readable names', async () => {
  vi.mocked(mailCommand).mockResolvedValue([
    { name: '62b9e44b-78f8-4f02-ac5e-bfac0076674f', email: 'person@example.com' },
    { name: ' Alexandra Example ', email: 'alexandra@example.com' },
    { name: 'duplicate@example.com', email: 'duplicate@example.com' },
  ]);
  const { people } = await searchSharedPeople({ ...source, type: 'exchange' }, 'person');
  expect(people.map(person => person.name || person.email)).toEqual(['person@example.com', 'Alexandra Example', 'duplicate@example.com']);
  expect(people[0].email).toBe('person@example.com');
});

it('keeps Google contacts usable and reports a denied directory without retrying it on each keystroke', async () => {
  let accessToken = 'old-token';
  const account = { ...source, getToken: async () => accessToken };
  const fetchMock = vi.fn(async (url: string) => url.includes('searchDirectoryPeople')
    ? response({ error: { code: 403, status: 'PERMISSION_DENIED' } }, 403)
    : response({ results: [{ person: { names: [{ displayName: 'Other Person' }], emailAddresses: [{ value: 'other@example.com' }] } }] }));
  vi.stubGlobal('fetch', fetchMock);
  const first = await searchSharedPeople(account, 'oth');
  expect(first.directoryUnavailable).toBe(true);
  expect(first.people[0]).toEqual({ name: 'Other Person', email: 'other@example.com' });
  await searchSharedPeople(account, 'other');
  expect(fetchMock.mock.calls.filter(([url]) => url.includes('searchDirectoryPeople'))).toHaveLength(1);
  accessToken = 'reconnected-token';
  await searchSharedPeople(account, 'other');
  expect(fetchMock.mock.calls.filter(([url]) => url.includes('searchDirectoryPeople'))).toHaveLength(2);
});
it('reports Google directory denial even when the contacts endpoint succeeds with no matches', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('searchDirectoryPeople') ? response({}, 403) : response({ results: [] })));
  await expect(searchSharedPeople({ ...source }, 'other')).resolves.toEqual({ people: [], directoryUnavailable: true });
});
it('can discover a Google calendar directly by email when the People API is denied', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('people.googleapis.com')) return response({}, 403);
    if (url.includes('/events?')) return response({ items: [] });
    if (url.includes('/calendarList')) return response({ items: [] });
    return response({ id: 'other@example.com', summary: 'Other calendar' });
  }));
  await expect(searchSharedPeople({ ...source }, 'other@example.com')).rejects.toThrow('shared_directory_unavailable');
  const result = await discoverSharedCalendars(source, { email: 'other@example.com' });
  expect(result.calendars[0].calendar.googleCalendarId).toBe('other@example.com');
});

it('shows an actionable EWS error without exposing the provider response', () => {
  const ews = { ...source, type: 'exchange' as const };
  expect(sharedCalendarErrorKey(ews, new Error('ews_shared_access_denied'))).toBe('sharedCalendars.ewsErrors.access_denied');
  expect(sharedCalendarErrorKey(ews, 'ews_shared_folder_not_found')).toBe('sharedCalendars.ewsErrors.folder_not_found');
  expect(sharedCalendarErrorKey(ews, new Error('ews_shared_mailbox_not_found'))).toBe('sharedCalendars.ewsErrors.mailbox_not_found');
  expect(sharedCalendarErrorKey(ews, new Error('unknown_api_route'))).toBe('sharedCalendars.ewsErrors.update_required');
  expect(sharedCalendarErrorKey(ews, new Error('private server response'))).toBe('sharedCalendars.ewsErrors.request_failed');
  expect(sharedCalendarErrorKey(source, new Error('ews_shared_access_denied'))).toBe('sharedCalendars.accessError');
});
it('preserves the precise Exchange discovery failure for the modal', async () => {
  vi.mocked(exchangeCalendarApi.shared).mockRejectedValue(new Error('ews_shared_access_denied'));
  await expect(discoverSharedCalendars({ ...source, type: 'exchange' }, { email: 'other@example.com' })).rejects.toThrow('ews_shared_access_denied');
});

it('adds an EWS availability-only primary reference when the folder is not browsable', async () => {
  vi.mocked(exchangeCalendarApi.shared).mockResolvedValue({ calendars: [{ id: '', name: '' }], limitedDiscovery: true });
  const result = await discoverSharedCalendars({ ...source, type: 'exchange' }, { email: 'other@example.com', name: 'Other Person' });
  expect(result.calendars).toHaveLength(1);
  expect(result.calendars[0].key).toBe('other@example.com');
  expect(result.calendars[0].calendar).toMatchObject({ exchangeAccountId: source.id, exchangeFolderId: '', shared: { ownerEmail: 'other@example.com' }, groupId: 'other-calendars' });
});
