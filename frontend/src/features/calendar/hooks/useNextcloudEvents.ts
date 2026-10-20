import { useState, useEffect, useCallback, useRef } from 'react';
import { AttendeeStatus, CalendarConfig, CalendarEvent } from '../../../shared/types';
import { resolveSharedCalDav } from '../utils/sharedCalendars';
import { calDavLoadError, loadCalDavCalendar, type CalDavSnapshot } from '../utils/loadCalDavCalendar';
import { cacheGetStale, cacheSet, cacheIsFresh, patchCachedEventRsvp } from '../utils/eventCache';

const CACHE_TTL = 30 * 60 * 1000; // 30 min
const CACHE_VERSION = 'v3';

function cacheKey(calId: string) {
  return `nextcloud-events:${CACHE_VERSION}:${calId}`;
}

export function useNextcloudEvents(calendars: CalendarConfig[], onLoaded?: (id: string, events: CalendarEvent[]) => void) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [readOnlyCalendarIds, setReadOnlyCalendarIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const calendarsRef = useRef(calendars);
  calendarsRef.current = calendars;
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  const run = useCallback(async (force: boolean, calendarId?: string) => {
    const toFetch = calendarsRef.current.filter((c) => c.type === 'nextcloud' && c.url);
    if (!toFetch.length) {
      setEvents([]);
      setReadOnlyCalendarIds([]);
      setErrors({});
      return;
    }

    const readOnlyIds = new Set<string>();
    // Phase 1: show stale cache immediately (IDB read — very fast, no network)
    const stale = (await Promise.all(toFetch.map(async (cal) => {
      const cached = await cacheGetStale<CalDavSnapshot>(cacheKey(cal.id));
      if (cached) {
        onLoadedRef.current?.(cal.id, cached.events);
        if (cached.readOnly) readOnlyIds.add(cal.id);
      }
      return cached?.events;
    }))).flat().filter(Boolean) as CalendarEvent[];
    if (stale.length > 0) setEvents(stale);
    setReadOnlyCalendarIds([...readOnlyIds]);

    // Phase 2: refresh expired / forced caches
    const toRefresh = force
      ? toFetch.filter((cal) => !calendarId || cal.id === calendarId)
      : (await Promise.all(toFetch.map(async (cal) => ((await cacheIsFresh(cacheKey(cal.id), CACHE_TTL)) ? null : cal)))).filter(Boolean) as CalendarConfig[];

    if (!toRefresh.length) return;

    setLoading(true);
    const newErrors: Record<string, string> = {};

    const settled = await Promise.allSettled(
      toRefresh.map(async (cal) => {
        const parsed = await loadCalDavCalendar(resolveSharedCalDav(cal, calendarsRef.current));
        await cacheSet(cacheKey(cal.id), parsed);
        onLoadedRef.current?.(cal.id, parsed.events);
        if (parsed.readOnly) readOnlyIds.add(cal.id);
        else readOnlyIds.delete(cal.id);
        return parsed.events;
      })
    );

    const results: CalendarEvent[] = [];
    const refreshedIds = new Set(toRefresh.map((c) => c.id));

    settled.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        results.push(...result.value);
      } else {
        newErrors[toRefresh[i].id] = calDavLoadError(result.reason);
        results.push(...stale.filter(event => event.calendarId === toRefresh[i].id));
      }
    });

    for (const cal of toFetch) {
      if (!refreshedIds.has(cal.id)) {
        const cached = await cacheGetStale<CalDavSnapshot>(cacheKey(cal.id));
        if (cached) results.push(...cached.events);
      }
    }

    setEvents(results);
    setReadOnlyCalendarIds([...readOnlyIds]);
    setErrors(newErrors);
    setLoading(false);
    return results;
  }, []);

  const calKey = calendars
    .filter((c) => c.type === 'nextcloud' && c.url)
    .map((c) => `${c.id}:${c.url}:${c.nextcloudUsername ?? ''}`)
    .join(',');

  const prevKey = useRef('');
  useEffect(() => {
    if (calKey === prevKey.current) return;
    prevKey.current = calKey;
    run(false);
  }, [calKey, run]);

  const refresh = useCallback((calendarId?: string) => run(true, calendarId), [run]);

  return { events, loading, errors, refresh, readOnlyCalendarIds };
}

/** Patch a single Nextcloud event's RSVP status in the IndexedDB cache. */
export function patchNextcloudCachedRsvp(calId: string, eventId: string, status: AttendeeStatus): Promise<void> {
  return patchCachedEventRsvp(cacheKey(calId), eventId, status);
}
