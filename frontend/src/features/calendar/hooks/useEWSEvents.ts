import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AttendeeStatus, CalendarConfig } from '../../../shared/types';
import { patchCachedEventRsvp } from '../utils/eventCache';
import { useCalendarEvents, CALENDAR_KEYS } from './useCalendarQueries';

const CACHE_VERSION = 'ews1';

export function useEWSEvents(calendars: CalendarConfig[]) {
  const ewsCals = useMemo(() => calendars.filter(c => c.type === 'exchange'), [calendars]);
  const { events, isLoading, errors } = useCalendarEvents(ewsCals);
  const queryClient = useQueryClient();

  return useMemo(() => ({
    events,
    loading: isLoading,
    errors: (errors as any[]).reduce((acc, err, idx) => {
      if (err) acc[ewsCals[idx]?.id || idx] = err.message;
      return acc;
    }, {} as Record<string, string>),
    refresh: () => queryClient.refetchQueries({ queryKey: CALENDAR_KEYS.all }),
  }), [events, isLoading, errors, ewsCals, queryClient]);
}

/** Patch a single EWS event's RSVP status in the IndexedDB cache. */
export function patchEWSCachedRsvp(calId: string, eventId: string, status: AttendeeStatus): Promise<void> {
  return patchCachedEventRsvp(`ews-events:${CACHE_VERSION}:${calId}`, eventId, status);
}
