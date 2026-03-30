import { useState, useEffect, useCallback, useRef } from 'react';
import { CalendarConfig, CalendarEvent } from '../types';
import { cacheGetStale, cacheSet, cacheIsFresh } from '../utils/eventCache';

const CACHE_TTL = 30 * 60 * 1000; // 30 min
const CACHE_VERSION = 'ek1';

function cacheKey(calId: string) {
  return `ek-events:${CACHE_VERSION}:${calId}`;
}

// Date window: 52 weeks past, 104 weeks future
function getDateRange() {
  const now = new Date();
  const timeMin = new Date(now);
  timeMin.setDate(timeMin.getDate() - 52 * 7);
  const timeMax = new Date(now);
  timeMax.setDate(timeMax.getDate() + 104 * 7);
  return { timeMin, timeMax };
}

interface EKAttendeeInfo {
  name: string;
  email: string;
  status: string;
  is_organizer: boolean;
  is_self: boolean;
}

interface EKEventInfo {
  id: string;
  calendar_id: string;
  title: string;
  start: string;
  end: string;
  is_all_day: boolean;
  location?: string;
  notes?: string;
  attendees: EKAttendeeInfo[];
}

async function fetchEKEvents(cal: CalendarConfig): Promise<CalendarEvent[]> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { timeMin, timeMax } = getDateRange();

  const raw = await invoke<EKEventInfo[]>('fetch_eventkit_events', {
    calendarId: cal.eventKitCalendarId,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
  });

  return raw.map((ev): CalendarEvent => {
    const attendees = ev.attendees.map((a) => ({
      name: a.name,
      email: a.email,
      status: a.status as import('../types').AttendeeStatus,
      isOrganizer: a.is_organizer,
    }));

    let isUnaccepted = false;
    let isDeclined = false;
    let selfRsvpStatus: import('../types').AttendeeStatus | undefined;

    const self = ev.attendees.find((a) => a.is_self && !a.is_organizer);
    if (self) {
      const status = self.status as import('../types').AttendeeStatus;
      isDeclined = status === 'DECLINED';
      isUnaccepted = status !== 'ACCEPTED';
      selfRsvpStatus = status;
    }

    return {
      id: ev.id,
      sourceId: ev.id,
      calendarId: cal.id,
      title: ev.title,
      start: ev.start,
      end: ev.end,
      isAllday: ev.is_all_day,
      category: ev.is_all_day ? 'allday' : 'time',
      location: ev.location,
      description: ev.notes,
      isUnaccepted,
      isDeclined,
      selfRsvpStatus,
      attendees,
      seriesId: ev.id,
    };
  });
}

export function useEventKitEvents(calendars: CalendarConfig[]) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const calendarsRef = useRef(calendars);
  calendarsRef.current = calendars;

  const run = useCallback(async (force: boolean) => {
    const ekCals = calendarsRef.current.filter(
      (c) => c.type === 'eventkit' && c.eventKitCalendarId
    );
    if (!ekCals.length) {
      setEvents([]);
      setErrors({});
      return;
    }

    // Phase 1: show stale cache immediately (IDB read — very fast, no network)
    const stale = (await Promise.all(ekCals.map((cal) => cacheGetStale<CalendarEvent[]>(cacheKey(cal.id))))).flat().filter(Boolean) as CalendarEvent[];
    if (stale.length > 0) setEvents(stale);

    // Phase 2: refresh expired / forced caches
    const toRefresh = force
      ? ekCals
      : (await Promise.all(ekCals.map(async (cal) => ((await cacheIsFresh(cacheKey(cal.id), CACHE_TTL)) ? null : cal)))).filter(Boolean) as CalendarConfig[];

    if (!toRefresh.length) return;

    setLoading(true);
    const newErrors: Record<string, string> = {};

    const settled = await Promise.allSettled(
      toRefresh.map(async (cal) => {
        const fetched = await fetchEKEvents(cal);
        await cacheSet(cacheKey(cal.id), fetched);
        return fetched;
      })
    );

    const results: CalendarEvent[] = [];
    const refreshedIds = new Set(toRefresh.map((c) => c.id));

    settled.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        results.push(...result.value);
      } else {
        newErrors[toRefresh[i].id] = result.reason?.message ?? 'Erreur inconnue';
      }
    });

    for (const cal of ekCals) {
      if (!refreshedIds.has(cal.id)) {
        const cached = await cacheGetStale<CalendarEvent[]>(cacheKey(cal.id));
        if (cached) results.push(...cached);
      }
    }

    setEvents(results);
    setErrors(newErrors);
    setLoading(false);
  }, []);

  const calKey = calendars
    .filter((c) => c.type === 'eventkit')
    .map((c) => `${c.id}:${c.eventKitCalendarId}`)
    .join(',');

  const prevKey = useRef('');
  useEffect(() => {
    if (calKey === prevKey.current) return;
    prevKey.current = calKey;
    run(false);
  }, [calKey, run]);

  const refresh = useCallback(() => run(true), [run]);

  return { events, loading, errors, refresh };
}
