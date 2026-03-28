import { useState, useEffect, useCallback, useRef } from 'react';
import { CalendarConfig, CalendarEvent } from '../types';
import { parseICS } from '../utils/parseICS';

const CACHE_TTL = 30 * 60 * 1000; // 30 min
const CACHE_VERSION = 'v3';

// Store parsed events (JSON, ~10x smaller than raw ICS)
function cacheKey(calId: string, ownerEmail?: string) {
  return `ics-events:${CACHE_VERSION}:${calId}:${ownerEmail ?? ''}`;
}

function getCachedEvents(calId: string, ownerEmail?: string): CalendarEvent[] | null {
  try {
    const raw = localStorage.getItem(cacheKey(calId, ownerEmail));
    if (!raw) return null;
    const { events, at } = JSON.parse(raw) as { events: CalendarEvent[]; at: number };
    if (Date.now() - at > CACHE_TTL) return null;
    return events;
  } catch {
    return null;
  }
}

// Returns cached events regardless of TTL (for background refresh: show stale while fetching)
function getCachedEventsStale(calId: string, ownerEmail?: string): CalendarEvent[] | null {
  try {
    const raw = localStorage.getItem(cacheKey(calId, ownerEmail));
    if (!raw) return null;
    const { events } = JSON.parse(raw) as { events: CalendarEvent[]; at: number };
    return events;
  } catch {
    return null;
  }
}

function setCachedEvents(calId: string, events: CalendarEvent[], ownerEmail?: string) {
  const value = JSON.stringify({ events, at: Date.now() });
  try {
    localStorage.setItem(cacheKey(calId, ownerEmail), value);
  } catch {
    // Quota exceeded: evict all ics-events entries then retry
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('ics-events:')) localStorage.removeItem(key);
    }
    try {
      localStorage.setItem(`ics-events:${CACHE_VERSION}:${calId}`, value);
    } catch { /* give up */ }
  }
}

async function fetchAndParse(cal: CalendarConfig): Promise<CalendarEvent[]> {
  const { invoke } = await import('@tauri-apps/api/core');
  const text = await invoke<string>('fetch_ics', { url: cal.url });
  return parseICS(text, cal);
}

export function useICSEvents(calendars: CalendarConfig[]) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const calendarsRef = useRef(calendars);
  calendarsRef.current = calendars;

  const run = useCallback(async (force: boolean) => {
    // Fetch all calendars with a URL, regardless of visibility.
    // Visibility filtering happens at render time so toggling doesn't trigger a reload.
    const toFetch = calendarsRef.current.filter((c) => c.url && (!c.type || c.type === 'ics'));
    if (!toFetch.length) {
      setEvents([]);
      setErrors({});
      return;
    }

    // Phase 1: immediately show any cached data (even stale) so the UI stays usable.
    const staleEvents: CalendarEvent[] = [];
    for (const cal of toFetch) {
      const stale = getCachedEventsStale(cal.id, cal.ownerEmail);
      if (stale) staleEvents.push(...stale);
    }
    if (staleEvents.length > 0) setEvents(staleEvents);

    // Phase 2: determine which calendars actually need a network fetch.
    const toRefresh = force
      ? toFetch
      : toFetch.filter((cal) => !getCachedEvents(cal.id, cal.ownerEmail));

    if (toRefresh.length === 0) return; // all caches are fresh — nothing to do

    setLoading(true);
    const newErrors: Record<string, string> = {};

    const settled = await Promise.allSettled(
      toRefresh.map(async (cal) => {
        const parsed = await fetchAndParse(cal);
        setCachedEvents(cal.id, parsed, cal.ownerEmail);
        return parsed;
      })
    );

    // Assemble final result: freshly fetched + still-valid cached for the others.
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
        const cached = getCachedEvents(cal.id, cal.ownerEmail);
        if (cached) results.push(...cached);
      }
    }

    setEvents(results);
    setErrors(newErrors);
    setLoading(false);
  }, []);

  // Key depends only on URL/email changes, not on visibility — avoids reloads on toggle.
  const calKey = calendars
    .filter((c) => c.url)
    .map((c) => `${c.id}:${c.url}:${c.ownerEmail ?? ''}`)
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
