import { t } from 'i18next';
import { calendarApi } from '../../../shared/api/calendarApi';
import type { CalendarConfig, CalendarEvent } from '../../../shared/types';
import { davResponses, sameOriginDavUrl } from './sharedCalendars';
import { parseICS } from './parseICS';
import { parseCalDavTasks } from './parseCalDavTasks';

const DAV = 'DAV:';
const CALDAV = 'urn:ietf:params:xml:ns:caldav';
const NS = `xmlns:d="${DAV}" xmlns:c="${CALDAV}"`;
const PROPERTIES = '<d:resourcetype/><d:displayname/><d:current-user-principal/><c:calendar-home-set/><c:supported-calendar-component-set/><d:current-user-privilege-set/>';
const nodes = (element: Element, ns: string, name: string) => Array.from(element.getElementsByTagNameNS(ns, name));
const hrefs = (prop: Element, ns: string, name: string) => nodes(prop, ns, name).flatMap(set => nodes(set, DAV, 'href').map(href => href.textContent?.trim() ?? ''));

export interface CalDavSnapshot { events: CalendarEvent[]; readOnly: boolean }

export async function loadCalDavCalendar(cal: CalendarConfig): Promise<CalDavSnapshot> {
  const query = async (url: string, method: 'PROPFIND' | 'REPORT', depth: '0' | '1', body: string) =>
    davResponses(await calendarApi.queryCalDav({ url: sameOriginDavUrl(cal.url, url), username: cal.nextcloudUsername ?? '', password: cal.nextcloudPassword ?? '' }, method, depth, body));
  const props = (url: string, depth: '0' | '1' = '0') => query(url, 'PROPFIND', depth, `<d:propfind ${NS}><d:prop>${PROPERTIES}</d:prop></d:propfind>`);
  const initial = await props(cal.url);
  const self = initial.find(({ href }) => sameOriginDavUrl(cal.url, href).replace(/\/$/, '') === cal.url.replace(/\/$/, ''));
  if (!self) throw new Error(t('config.caldavInvalidResponse'));
  const isCollection = nodes(self.prop, CALDAV, 'calendar').length > 0;
  let collections = isCollection ? [self] : [];
  if (!isCollection) {
    let homes = hrefs(self.prop, CALDAV, 'calendar-home-set');
    if (!homes.length) {
      const principal = hrefs(self.prop, DAV, 'current-user-principal')[0];
      if (principal) homes = (await props(principal)).flatMap(({ prop }) => hrefs(prop, CALDAV, 'calendar-home-set'));
    }
    // A calendar-home URL is also a valid entry point.
    if (!homes.length) homes = [cal.url];
    for (const home of [...new Set(homes)]) collections.push(...await props(home, '1'));
    collections = collections.filter(({ prop }) => nodes(prop, CALDAV, 'calendar').length > 0);
  }
  const unique = new Map(collections.map(collection => [sameOriginDavUrl(cal.url, collection.href), collection]));
  if (!unique.size) throw new Error(t('config.caldavNoCollections'));
  const events: CalendarEvent[] = [];
  let readOnly = !isCollection || !!cal.shared;
  for (const [url, { prop }] of unique) {
    const components = nodes(prop, CALDAV, 'comp').map(comp => comp.getAttribute('name'));
    const eventCollection = !components.length || components.includes('VEVENT');
    const taskCollection = components.includes('VTODO');
    const privileges = nodes(prop, DAV, 'current-user-privilege-set')[0];
    const writable = !privileges || ['write', 'write-content', 'all'].some(name => nodes(privileges, DAV, name).length > 0);
    if (!eventCollection || !writable) readOnly = true;
    for (const component of [eventCollection && 'VEVENT', taskCollection && 'VTODO'].filter((value): value is string => !!value)) {
      const start = new Date(); start.setFullYear(start.getFullYear() - 1);
      const end = new Date(); end.setFullYear(end.getFullYear() + 2);
      const compact = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      // Fetch tasks without a time filter: some servers only filter DTSTART, missing DUE-only tasks.
      const range = component === 'VEVENT' ? `<c:time-range start="${compact(start)}" end="${compact(end)}"/>` : '';
      const responses = await query(url, 'REPORT', '1', `<c:calendar-query ${NS}><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="${component}">${range}</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`);
      for (const { href, prop: data } of responses) {
        const ics = nodes(data, CALDAV, 'calendar-data')[0]?.textContent;
        if (!ics) continue;
        const resourceUrl = sameOriginDavUrl(url, href);
        const parsed = component === 'VTODO' ? parseCalDavTasks(ics, cal) : parseICS(ics, cal);
        const etag = nodes(data, DAV, 'getetag')[0]?.textContent?.trim() || null;
        const project = nodes(prop, DAV, 'displayname')[0]?.textContent?.trim() || undefined;
        events.push(...parsed.map(event => ({ ...event,
          // Resource URLs distinguish identical UIDs in different project lists.
          id: isCollection ? event.id : `${event.id}:${resourceUrl}`,
          readOnly: event.isTask ? !!cal.shared || !writable || !etag || etag.startsWith('W/') : event.readOnly || readOnly,
          ...(event.caldavTask ? { caldavTask: { ...event.caldavTask, resourceUrl, etag, project } } : {}),
        })));
      }
    }
  }
  return { events, readOnly };
}

export function calDavLoadError(error: unknown): string {
  const detail = error instanceof Error ? error.message : typeof error === 'string' ? error
    : error && typeof error === 'object' && 'detail' in error ? String(error.detail) : '';
  const status = detail.match(/provider_http_(\d{3})/i)?.[1];
  if (status) {
    const key = ({ '401': 'invalidCredentials', '403': 'accessForbidden', '404': 'urlNotFound' } as Record<string, string>)[status];
    return t(`config.${key ?? 'unexpectedResponse'}`, { status });
  }
  const messages = ['caldavInvalidResponse', 'caldavNoCollections'].map(key => t(`config.${key}`));
  return messages.includes(detail) ? detail : t('config.caldavLoadFailed');
}
