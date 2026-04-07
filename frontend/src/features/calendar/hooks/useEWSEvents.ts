import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CalendarConfig, CalendarEvent } from '../../../shared/types';
import { useExchangeAuth } from '../../../shared/store/ExchangeAuthStore';
import { cacheGetStale, cacheSet, cacheIsFresh } from '../utils/eventCache';

const CACHE_TTL = 30 * 60 * 1000; // 30 min
const CACHE_VERSION = 'ews1';

function cacheKey(calId: string) {
  return `ews-events:${CACHE_VERSION}:${calId}`;
}

function getDateRange() {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 26 * 7); // 6 months past
  const end = new Date(now);
  end.setDate(end.getDate() + 52 * 7); // 12 months future  — total ~1.5 years, well under EWS 2-year limit
  return { start, end };
}

interface EwsEventRaw {
  item_id: string;
  change_key: string;
  subject: string;
  start: string;
  end: string;
  is_all_day: boolean;
  location?: string;
  organizer_name?: string;
  organizer_email?: string;
  my_response_type: string;
  attendees: Array<{
    name?: string;
    email: string;
    response_type: string;
  }>;
  is_meeting: boolean;
  recurring_master_id?: string;
}

function ewsResponseToRsvp(ewsStatus: string): import('../../../shared/types').AttendeeStatus {
  switch (ewsStatus) {
    case 'Accept':
    case 'Organizer': return 'ACCEPTED';
    case 'Decline': return 'DECLINED';
    case 'Tentative': return 'TENTATIVE';
    default: return 'NEEDS-ACTION';
  }
}

async function fetchEWSEvents(
  cal: CalendarConfig,
  accessToken: string,
): Promise<CalendarEvent[]> {
  const { start, end } = getDateRange();

  console.log('[EWS] invoke ews_get_calendar_events', { start: start.toISOString(), end: end.toISOString() });
  let raw: EwsEventRaw[];
  try {
    raw = await invoke<EwsEventRaw[]>('ews_get_calendar_events', {
      accessToken,
      start: start.toISOString(),
      end: end.toISOString(),
    });
    console.log('[EWS] raw response count:', raw.length);
    const declined = raw.filter(e => e.my_response_type === 'Decline');
    console.log('[EWS] declined events:', declined.map(e => ({ subject: e.subject, my_response_type: e.my_response_type })));
  } catch (err) {
    console.error('[EWS] invoke error:', err);
    throw err;
  }

  return raw.map((ev): CalendarEvent => {
    const attendees = ev.attendees.map((a) => ({
      name: a.name ?? a.email,
      email: a.email,
      status: ewsResponseToRsvp(a.response_type),
      isOrganizer: false,
    }));

    if (ev.organizer_email) {
      attendees.unshift({
        name: ev.organizer_name ?? ev.organizer_email,
        email: ev.organizer_email,
        status: 'ACCEPTED' as const,
        isOrganizer: true,
      });
    }

    const selfStatus = ewsResponseToRsvp(ev.my_response_type);
    const isDeclined = selfStatus === 'DECLINED';
    const isUnaccepted = selfStatus !== 'ACCEPTED' && ev.is_meeting;

    return {
      // Encode item_id and change_key together so CalendarPage can split them for RSVP
      id: `${cal.id}::${ev.item_id}`,
      sourceId: `${ev.item_id}|${ev.change_key}`,
      // recurring_master_id is shared by all occurrences of a recurring series.
      // For non-recurring events, item_id is stable (unlike change_key which rotates on updates).
      seriesId: ev.recurring_master_id ?? ev.item_id,
      calendarId: cal.id,
      title: ev.subject,
      start: ev.start,
      end: ev.end,
      isAllday: ev.is_all_day,
      category: ev.is_all_day ? 'allday' : 'time',
      location: ev.location,
      isDeclined,
      isUnaccepted,
      selfRsvpStatus: ev.is_meeting ? selfStatus : undefined,
      attendees: ev.is_meeting ? attendees : [],
    };
  });
}

export function useEWSEvents(calendars: CalendarConfig[]) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { getValidToken } = useExchangeAuth();
  const calendarsRef = useRef(calendars);
  calendarsRef.current = calendars;
  const getValidTokenRef = useRef(getValidToken);
  getValidTokenRef.current = getValidToken;

  const run = useCallback(async (force: boolean) => {
    const ewsCals = calendarsRef.current.filter(
      (c) => c.type === 'exchange' && c.exchangeAccountId
    );
    if (!ewsCals.length) {
      setEvents([]);
      setErrors({});
      return;
    }

    // Phase 1: show stale cache immediately
    const stale = (
      await Promise.all(ewsCals.map((cal) => cacheGetStale<CalendarEvent[]>(cacheKey(cal.id))))
    ).flat().filter(Boolean) as CalendarEvent[];
    if (stale.length > 0) setEvents(stale);

    // Phase 2: refresh expired / forced caches
    const toRefresh = force
      ? ewsCals
      : (
          await Promise.all(
            ewsCals.map(async (cal) =>
              (await cacheIsFresh(cacheKey(cal.id), CACHE_TTL)) ? null : cal
            )
          )
        ).filter(Boolean) as CalendarConfig[];

    if (!toRefresh.length) return;

    setLoading(true);
    const newErrors: Record<string, string> = {};

    const settled = await Promise.allSettled(
      toRefresh.map(async (cal) => {
        const token = await getValidTokenRef.current(cal.exchangeAccountId!);
        if (!token) throw new Error('Token invalide. Reconnectez votre compte Exchange.');
        console.log('[EWS] fetching events for calendar', cal.id, cal.name);
        const fetched = await fetchEWSEvents(cal, token);
        console.log('[EWS] fetched', fetched.length, 'events for', cal.name);
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
        console.error('[EWS] error fetching calendar', toRefresh[i].id, toRefresh[i].name, result.reason);
        newErrors[toRefresh[i].id] = result.reason?.message ?? 'Erreur inconnue';
      }
    });

    for (const cal of ewsCals) {
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
    .filter((c) => c.type === 'exchange')
    .map((c) => `${c.id}:${c.exchangeAccountId}`)
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
