import { useState, useEffect, useCallback, useRef } from 'react';
import { CalendarConfig, CalendarEvent } from '../types';
import { useGoogleAuth } from '../store/GoogleAuthStore';
import { listEvents } from '../utils/googleCalendarApi';

const CACHE_TTL = 30 * 60 * 1000; // 30 min
const CACHE_VERSION = 'g1';

function cacheKey(calId: string) {
  return `google-events:${CACHE_VERSION}:${calId}`;
}

function getCachedEvents(calId: string): CalendarEvent[] | null {
  try {
    const raw = localStorage.getItem(cacheKey(calId));
    if (!raw) return null;
    const { events, at } = JSON.parse(raw) as { events: CalendarEvent[]; at: number };
    if (Date.now() - at > CACHE_TTL) return null;
    return events;
  } catch {
    return null;
  }
}

function getCachedEventsStale(calId: string): CalendarEvent[] | null {
  try {
    const raw = localStorage.getItem(cacheKey(calId));
    if (!raw) return null;
    const { events } = JSON.parse(raw) as { events: CalendarEvent[]; at: number };
    return events;
  } catch {
    return null;
  }
}

function setCachedEvents(calId: string, events: CalendarEvent[]) {
  try {
    localStorage.setItem(cacheKey(calId), JSON.stringify({ events, at: Date.now() }));
  } catch {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('google-events:')) localStorage.removeItem(key);
    }
  }
}

// Date window: 52 weeks past, 104 weeks future (same as ICS)
function getDateRange() {
  const now = new Date();
  const timeMin = new Date(now);
  timeMin.setDate(timeMin.getDate() - 52 * 7);
  const timeMax = new Date(now);
  timeMax.setDate(timeMax.getDate() + 104 * 7);
  return { timeMin, timeMax };
}

export function useGoogleEvents(calendars: CalendarConfig[]) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { getValidToken } = useGoogleAuth();
  const calendarsRef = useRef(calendars);
  calendarsRef.current = calendars;

  const run = useCallback(async (force: boolean) => {
    const googleCals = calendarsRef.current.filter((c) => c.type === 'google' && c.googleCalendarId && c.googleAccountId);
    if (!googleCals.length) {
      setEvents([]);
      setErrors({});
      return;
    }

    // Phase 1: show stale cache immediately
    const stale: CalendarEvent[] = [];
    for (const cal of googleCals) {
      const s = getCachedEventsStale(cal.id);
      if (s) stale.push(...s);
    }
    if (stale.length > 0) setEvents(stale);

    // Phase 2: refresh expired / forced caches
    const toRefresh = force
      ? googleCals
      : googleCals.filter((c) => !getCachedEvents(c.id));

    if (!toRefresh.length) return;

    setLoading(true);
    const newErrors: Record<string, string> = {};
    const { timeMin, timeMax } = getDateRange();

    const settled = await Promise.allSettled(
      toRefresh.map(async (cal) => {
        const token = await getValidToken(cal.googleAccountId!);
        if (!token) throw new Error('Token invalide ou expiré. Reconnectez votre compte Google.');
        const fetched = await listEvents(token, cal, timeMin, timeMax);
        setCachedEvents(cal.id, fetched);
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

    for (const cal of googleCals) {
      if (!refreshedIds.has(cal.id)) {
        const cached = getCachedEvents(cal.id);
        if (cached) results.push(...cached);
      }
    }

    setEvents(results);
    setErrors(newErrors);
    setLoading(false);
  }, [getValidToken]);

  const calKey = calendars
    .filter((c) => c.type === 'google')
    .map((c) => `${c.id}:${c.googleCalendarId}:${c.googleAccountId}`)
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
