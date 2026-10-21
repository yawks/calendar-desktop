import { t } from 'i18next';
import type { CalendarConfig } from '../../../shared/types';
import { calendarApi } from '../../../shared/api/calendarApi';
import { exchangeCalendarApi } from '../../../shared/api/exchangeCalendarApi';
import { mailCommand } from '../../../shared/api/mailApi';
import { usableContactName } from '../../mail/utils/contactIndex';
import { listCalendars } from './googleCalendarApi';

export const OTHER_CALENDARS_GROUP = 'other-calendars';
export const isCalendarWritable = (cal?: CalendarConfig | null) => !!cal && !cal.shared && !cal.readOnly && ['google', 'exchange', 'nextcloud'].includes(cal.type ?? 'ics');
export const calendarGroupId = (cal: CalendarConfig) => cal.shared ? OTHER_CALENDARS_GROUP : cal.groupId ?? 'default';

export interface SharedCalendarSource {
  id: string;
  type: 'google' | 'exchange' | 'nextcloud';
  name: string;
  color: string;
  calendar?: CalendarConfig;
  getToken?: () => Promise<string | null>;
}
export interface SharedPerson { name?: string; email: string; principalUrl?: string }
export interface SharedCalendarChoice { key: string; calendar: Omit<CalendarConfig, 'id'> }
export interface SharedDiscovery { calendars: SharedCalendarChoice[]; limited: boolean }

export function sameCalendar(left: Omit<CalendarConfig, 'id'>, right: Omit<CalendarConfig, 'id'>): boolean {
  if (left.type !== right.type) return false;
  if (left.type === 'google') return left.googleAccountId === right.googleAccountId && left.googleCalendarId === right.googleCalendarId;
  if (left.type === 'exchange') return left.exchangeAccountId === right.exchangeAccountId && left.exchangeFolderId === right.exchangeFolderId
    && (left.shared?.ownerEmail ?? left.ownerEmail)?.toLowerCase() === (right.shared?.ownerEmail ?? right.ownerEmail)?.toLowerCase();
  return left.url.replace(/\/$/, '') === right.url.replace(/\/$/, '');
}

async function token(source: SharedCalendarSource): Promise<string> {
  const value = await source.getToken?.();
  if (!value) throw new Error('shared_auth_required');
  return value;
}

const DAV = 'DAV:';
const CALDAV = 'urn:ietf:params:xml:ns:caldav';
const SABRE = 'http://sabredav.org/ns';
const XML_NS = 'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:s="http://sabredav.org/ns"';
const text = (element: Element, ns: string, name: string) => element.getElementsByTagNameNS(ns, name)[0]?.textContent?.trim() ?? '';
const nodes = (element: Element | Document, ns: string, name: string) => Array.from(element.getElementsByTagNameNS(ns, name));
const xmlEscape = (value: string) => value.replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]!);

/** Never forward DAV credentials to an origin advertised by an untrusted XML response. */
export function sameOriginDavUrl(base: string, href: string): string {
  const url = new URL(href, base);
  if (!href.trim() || url.origin !== new URL(base).origin || url.username || url.password || url.hash || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('shared_invalid_dav_url');
  }
  return url.href;
}

export function davResponses(xml: string): Array<{ href: string; prop: Element }> {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.getElementsByTagName('parsererror').length || !document.getElementsByTagNameNS(DAV, 'multistatus').length) throw new Error('shared_invalid_dav_response');
  return nodes(document, DAV, 'response').flatMap(response => nodes(response, DAV, 'propstat').flatMap(status => {
    if (!/\s200\s/.test(text(status, DAV, 'status'))) return [];
    const prop = nodes(status, DAV, 'prop')[0];
    return prop ? [{ href: text(response, DAV, 'href'), prop }] : [];
  }));
}

function credentials(source: SharedCalendarSource, url: string) {
  const cal = source.calendar!;
  return { url: sameOriginDavUrl(cal.url, url), username: cal.nextcloudUsername ?? '', password: cal.nextcloudPassword ?? '' };
}
async function dav(source: SharedCalendarSource, url: string, method: 'PROPFIND' | 'REPORT', depth: '0' | '1', body: string) {
  const request = credentials(source, url);
  return davResponses(await calendarApi.queryCalDav(request, method, depth, body)).map(response => ({ ...response, href: sameOriginDavUrl(request.url, response.href) }));
}
async function props(source: SharedCalendarSource, url: string, properties: string, depth: '0' | '1' = '0') {
  return dav(source, url, 'PROPFIND', depth, `<d:propfind ${XML_NS}><d:prop>${properties}</d:prop></d:propfind>`);
}

async function searchDavPeople(source: SharedCalendarSource, query: string): Promise<SharedPerson[]> {
  const cal = source.calendar!;
  const discovery = await props(source, cal.url, '<d:principal-collection-set/>');
  const collection = discovery.flatMap(({ prop }) => nodes(prop, DAV, 'principal-collection-set').flatMap(set => nodes(set, DAV, 'href').map(node => node.textContent ?? '')))[0];
  if (!collection) throw new Error('shared_directory_unavailable');
  const property = query.includes('@') ? '<s:email-address/>' : '<d:displayname/>';
  const report = `<d:principal-property-search ${XML_NS}><d:property-search><d:prop>${property}</d:prop><d:match>${xmlEscape(query)}</d:match></d:property-search><d:prop><d:displayname/><s:email-address/><c:calendar-user-address-set/><c:calendar-home-set/></d:prop></d:principal-property-search>`;
  const results = await dav(source, collection, 'REPORT', '0', report);
  return results.flatMap(({ href, prop }) => {
    const email = text(prop, SABRE, 'email-address') || nodes(prop, CALDAV, 'calendar-user-address-set').flatMap(set => nodes(set, DAV, 'href').map(node => node.textContent ?? '')).find(address => /^mailto:/i.test(address))?.replace(/^mailto:/i, '');
    return email ? [{ email, name: text(prop, DAV, 'displayname'), principalUrl: sameOriginDavUrl(cal.url, href) }] : [];
  });
}

export interface SharedPeopleSearch { people: SharedPerson[]; directoryUnavailable: boolean }

export async function searchSharedPeople(source: SharedCalendarSource, query: string): Promise<SharedPeopleSearch> {
  const result = await searchSharedPeopleRaw(source, query);
  return { ...result, people: result.people.map(person => ({ ...person, name: usableContactName(person.name, person.email) })) };
}

// A denied directory is optional; retry after the account gets a different token.
const deniedGoogleDirectories = new WeakMap<SharedCalendarSource, string>();

async function searchSharedPeopleRaw(source: SharedCalendarSource, query: string): Promise<SharedPeopleSearch> {
  if (source.type === 'nextcloud') return { people: await searchDavPeople(source, query), directoryUnavailable: false };
  const accessToken = await token(source);
  if (source.type === 'exchange') return { people: await mailCommand<SharedPerson[]>('mail_search_contacts', { accessToken, query, maxCount: 10 }), directoryUnavailable: false };
  const headers = { Authorization: `Bearer ${accessToken}` };
  const params = new URLSearchParams({ query, pageSize: '10', readMask: 'names,emailAddresses' });
  const contacts = async () => {
    // Google requires warming its lazy contact search cache before the first query.
    await fetch(`https://people.googleapis.com/v1/people:searchContacts?${new URLSearchParams({ query: '', readMask: 'names,emailAddresses' })}`, { headers });
    return fetch(`https://people.googleapis.com/v1/people:searchContacts?${params}`, { headers });
  };
  const directoryParams = new URLSearchParams(params);
  directoryParams.append('sources', 'DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE');
  directoryParams.append('sources', 'DIRECTORY_SOURCE_TYPE_DOMAIN_CONTACT');
  const directory = deniedGoogleDirectories.get(source) === accessToken ? Promise.resolve(null)
    : fetch(`https://people.googleapis.com/v1/people:searchDirectoryPeople?${directoryParams}`, { headers }).then(response => {
      if (response.status === 403) deniedGoogleDirectories.set(source, accessToken);
      return response;
    });
  const requests = await Promise.allSettled([contacts(), directory]);
  const successful = requests.flatMap(result => result.status === 'fulfilled' && result.value?.ok ? [result.value] : []);
  const directoryUnavailable = requests[1].status === 'rejected' || !requests[1].value?.ok;
  if (!successful.length) throw new Error('shared_directory_unavailable');
  const people: SharedPerson[] = [];
  for (const response of successful) {
    const data = await response.json() as { people?: GooglePerson[]; results?: Array<{ person: GooglePerson }> };
    for (const person of data.people ?? data.results?.map(result => result.person) ?? []) {
      for (const email of person.emailAddresses ?? []) if (email.value) people.push({ email: email.value, name: person.names?.[0]?.displayName });
    }
  }
  return { people: people.filter((person, index) => people.findIndex(other => other.email.toLowerCase() === person.email.toLowerCase()) === index), directoryUnavailable };
}
interface GooglePerson { names?: Array<{ displayName: string }>; emailAddresses?: Array<{ value: string }> }

export function sharedCalendarErrorKey(source: SharedCalendarSource, error: unknown): string {
  if (source.type !== 'exchange') return 'sharedCalendars.accessError';
  const message = error instanceof Error ? error.message : String(error);
  const codes = ['access_denied', 'folder_not_found', 'mailbox_not_found', 'unauthorized', 'server_busy', 'request_failed', 'invalid_response'] as const;
  const code = codes.find(code => message.includes(`ews_shared_${code}`));
  if (code) return `sharedCalendars.ewsErrors.${code}`;
  if (/404|unknown.*(route|command)/i.test(message)) return 'sharedCalendars.ewsErrors.update_required';
  return 'sharedCalendars.ewsErrors.request_failed';
}

export async function discoverSharedCalendars(source: SharedCalendarSource, person: SharedPerson): Promise<SharedDiscovery> {
  const base = { visible: true, color: source.color, groupId: OTHER_CALENDARS_GROUP, shared: { ownerEmail: person.email } };
  if (source.type === 'exchange') {
    const data = await exchangeCalendarApi.shared({ accessToken: await token(source), email: person.email });
    return { limited: data.limitedDiscovery, calendars: data.calendars.map(folder => ({ key: folder.id || person.email, calendar: {
      ...base, name: `${person.name || person.email} — ${folder.name || t('sharedCalendars.availabilityCalendar')}`, type: 'exchange', url: '',
      exchangeAccountId: source.id, exchangeFolderId: folder.id,
    } })) };
  }
  if (source.type === 'google') {
    const accessToken = await token(source);
    const headers = { Authorization: `Bearer ${accessToken}` };
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(person.email)}`, { headers });
    if (!response.ok && ![403, 404].includes(response.status)) throw new Error(`provider_http_${response.status}`);
    let primary = response.ok ? await response.json() as { id: string; summary: string } : null;
    if (primary) {
      const readable = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(primary.id)}/events?maxResults=1`, { headers });
      if ([403, 404].includes(readable.status)) primary = null;
      else if (!readable.ok) throw new Error(`provider_http_${readable.status}`);
    }
    // Google exposes only our subscription list, never another user's full calendar list.
    const known = (await listCalendars(accessToken)).filter(cal => !cal.primary && cal.accessRole !== 'owner' && cal.accessRole !== 'freeBusyReader');
    const choices = [...(primary ? [primary] : []), ...known];
    const unique = choices.filter((cal, index) => choices.findIndex(other => other.id === cal.id) === index);
    if (!unique.length) throw new Error('shared_calendar_unavailable');
    return { limited: true, calendars: unique.map(cal => ({ key: cal.id, calendar: {
      ...base, shared: { ownerEmail: cal.id === person.email ? person.email : cal.id },
      name: cal.id === person.email ? `${person.name || person.email} — ${cal.summary}` : cal.summary,
      type: 'google', url: '', googleAccountId: source.id, googleCalendarId: cal.id,
    } })) };
  }
  const cal = source.calendar!;
  const matches = person.principalUrl ? [person] : await searchDavPeople(source, person.email);
  const matching = matches.filter(match => match.email.toLowerCase() === person.email.toLowerCase());
  const calendars: SharedCalendarChoice[] = [];
  const collectionProps = '<d:resourcetype/><d:displayname/><d:owner/><c:supported-calendar-component-set/><d:current-user-privilege-set/>';
  const addCollection = ({ href, prop }: { href: string; prop: Element }) => {
    if (!nodes(prop, CALDAV, 'calendar').length) return;
    const components = nodes(prop, CALDAV, 'comp');
    if (components.length && !components.some(component => component.getAttribute('name') === 'VEVENT')) return;
    const privileges = nodes(prop, DAV, 'current-user-privilege-set');
    if (privileges.length && !nodes(privileges[0], DAV, 'read').length && !nodes(privileges[0], DAV, 'all').length) return;
    const url = sameOriginDavUrl(cal.url, href);
    if (calendars.some(choice => choice.key === url)) return;
    calendars.push({ key: url, calendar: { ...base, name: `${person.name || person.email} — ${text(prop, DAV, 'displayname') || url}`, type: 'nextcloud', url,
      shared: { ownerEmail: person.email, sourceCalendarId: cal.id },
    } });
  };
  // Nextcloud can expose shared bindings in our home while denying access to the owner's home.
  try {
    const current = await props(source, cal.url, '<d:current-user-principal/>');
    const currentPrincipal = current.flatMap(({ prop }) => nodes(prop, DAV, 'current-user-principal').map(node => text(node, DAV, 'href')))[0];
    if (currentPrincipal) {
      const ownPrincipal = await props(source, currentPrincipal, '<c:calendar-home-set/>');
      const ownHomes = ownPrincipal.flatMap(({ prop }) => nodes(prop, CALDAV, 'calendar-home-set').map(node => text(node, DAV, 'href')));
      for (const home of ownHomes) {
        const collections = await props(source, home, collectionProps, '1');
        for (const collection of collections) {
          const owner = nodes(collection.prop, DAV, 'owner')[0];
          const ownerHref = owner ? text(owner, DAV, 'href') : '';
          if (ownerHref && matching.some(match => sameOriginDavUrl(cal.url, ownerHref).replace(/\/$/, '') === match.principalUrl?.replace(/\/$/, ''))) addCollection(collection);
        }
      }
    }
  } catch {
    // Some CalDAV servers expose only the owner's collections; use that path below.
  }
  if (calendars.length) return { limited: false, calendars };
  for (const match of matching) {
    const principal = await props(source, match.principalUrl!, '<c:calendar-home-set/>');
    const homes = principal.flatMap(({ prop }) => nodes(prop, CALDAV, 'calendar-home-set').flatMap(set => nodes(set, DAV, 'href').map(node => node.textContent ?? '')));
    for (const home of homes) for (const collection of await props(source, home, collectionProps, '1')) addCollection(collection);
  }
  if (!calendars.length) throw new Error('shared_calendar_unavailable');
  return { limited: false, calendars };
}

export function resolveSharedCalDav(cal: CalendarConfig, calendars: CalendarConfig[]): CalendarConfig {
  if (!cal.shared) return cal;
  const source = calendars.find(source => source.id === cal.shared?.sourceCalendarId && !source.shared && source.type === 'nextcloud');
  if (!source) throw new Error('shared_auth_required');
  sameOriginDavUrl(source.url, cal.url);
  return { ...cal, nextcloudUsername: source.nextcloudUsername, nextcloudPassword: source.nextcloudPassword };
}
