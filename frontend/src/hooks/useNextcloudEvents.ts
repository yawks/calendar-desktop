import { useState, useEffect, useCallback, useRef } from 'react';
import { CalendarConfig, CalendarEvent } from '../types';
import { parseICS } from '../utils/parseICS';

const CACHE_TTL = 30 * 60 * 1000; // 30 min
const CACHE_VERSION = 'v1';

function cacheKey(calId: string) {
  return `nextcloud-events:${CACHE_VERSION}:${calId}`;
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
    localStorage.removeItem(cacheKey(calId));
  }
}

/** Nextcloud exposes a plain ICS dump at {caldav-url}?export */
function buildExportUrl(calUrl: string): string {
  const base = calUrl.endsWith('/') ? calUrl : `${calUrl}/`;
  return `${base}?export`;
}

async function fetchAndParse(cal: CalendarConfig): Promise<CalendarEvent[]> {
  const { invoke } = await import('@tauri-apps/api/core');
  const text = await invoke<string>('fetch_url_with_auth', {
    url: buildExportUrl(cal.url),
    username: cal.nextcloudUsername ?? '',
    password: cal.nextcloudPassword ?? '',
  });
  return parseICS(text, cal);
}

export function useNextcloudEvents(calendars: CalendarConfig[]) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const calendarsRef = useRef(calendars);
  calendarsRef.current = calendars;

  const run = useCallback(async (force: boolean) => {
    const toFetch = calendarsRef.current.filter((c) => c.type === 'nextcloud' && c.url);
    if (!toFetch.length) {
      setEvents([]);
      setErrors({});
      return;
    }

    // Show stale cache immediately
    const stale: CalendarEvent[] = [];
    for (const cal of toFetch) {
      const s = getCachedEventsStale(cal.id);
      if (s) stale.push(...s);
    }
    if (stale.length > 0) setEvents(stale);

    const toRefresh = force
      ? toFetch
      : toFetch.filter((cal) => !getCachedEvents(cal.id));

    if (!toRefresh.length) return;

    setLoading(true);
    const newErrors: Record<string, string> = {};

    const settled = await Promise.allSettled(
      toRefresh.map(async (cal) => {
        const parsed = await fetchAndParse(cal);
        setCachedEvents(cal.id, parsed);
        return parsed;
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

    for (const cal of toFetch) {
      if (!refreshedIds.has(cal.id)) {
        const cached = getCachedEvents(cal.id);
        if (cached) results.push(...cached);
      }
    }

    setEvents(results);
    setErrors(newErrors);
    setLoading(false);
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

  const refresh = useCallback(() => run(true), [run]);

  return { events, loading, errors, refresh };
}
