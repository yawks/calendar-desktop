import { useMemo } from 'react';
import { AttendeeStatus, CalendarConfig } from '../../../shared/types';
import { patchCachedEventRsvp } from '../utils/eventCache';
import { useCalendarEvents } from './useCalendarQueries';

const CACHE_VERSION = 'ews1';

export function useEWSEvents(calendars: CalendarConfig[]) {
  const ewsCals = useMemo(() => calendars.filter(c => c.type === 'exchange'), [calendars]);
  const { events, isLoading, errors } = useCalendarEvents(ewsCals);

  // Return a stable object that matches the previous API
  return useMemo(() => ({
    events,
    loading: isLoading,
    errors: (errors as any[]).reduce((acc, err, idx) => {
      if (err) acc[ewsCals[idx]?.id || idx] = err.message;
      return acc;
    }, {} as Record<string, string>),
    refresh: () => {
      // In React Query, we can invalidate to refresh
      // For now, this is a placeholder if manual refresh is needed
    }
  }), [events, isLoading, errors, ewsCals]);
}

/** Patch a single EWS event's RSVP status in the IndexedDB cache. */
export function patchEWSCachedRsvp(calId: string, eventId: string, status: AttendeeStatus): Promise<void> {
  return patchCachedEventRsvp(`ews-events:${CACHE_VERSION}:${calId}`, eventId, status);
}
