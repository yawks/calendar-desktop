import { useQueries } from '@tanstack/react-query';
import { CalendarConfig, CalendarEvent } from '../../../shared/types';
import { useExchangeAuth } from '../../../shared/store/ExchangeAuthStore';
import { invoke } from '@tauri-apps/api/core';
import { useMemo } from 'react';

export const CALENDAR_KEYS = {
  all: ['calendar'] as const,
  events: (calId: string) => [...CALENDAR_KEYS.all, calId, 'events'] as const,
};

// --- EWS FETCH ---
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
  attendees: Array<{ name?: string; email: string; response_type: string; }>;
  is_meeting: boolean;
  recurring_master_id?: string;
}

function ewsResponseToRsvp(ewsStatus: string): any {
  switch (ewsStatus) {
    case 'Accept':
    case 'Organizer': return 'ACCEPTED';
    case 'Decline': return 'DECLINED';
    case 'Tentative': return 'TENTATIVE';
    default: return 'NEEDS-ACTION';
  }
}

async function fetchEWSEvents(cal: CalendarConfig, accessToken: string): Promise<CalendarEvent[]> {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 26 * 7);
  const end = new Date(now);
  end.setDate(end.getDate() + 52 * 7);

  const raw = await invoke<EwsEventRaw[]>('ews_get_calendar_events', {
    accessToken,
    start: start.toISOString(),
    end: end.toISOString(),
  });

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
        status: 'ACCEPTED',
        isOrganizer: true,
      });
    }
    const selfStatus = ewsResponseToRsvp(ev.my_response_type);
    return {
      id: `${cal.id}::${ev.item_id}`,
      sourceId: `${ev.item_id}|${ev.change_key}`,
      seriesId: ev.recurring_master_id ?? ev.item_id,
      calendarId: cal.id,
      title: ev.subject,
      start: ev.start,
      end: ev.end,
      isAllday: ev.is_all_day,
      category: ev.is_all_day ? 'allday' : 'time',
      location: ev.location,
      isDeclined: selfStatus === 'DECLINED',
      isUnaccepted: selfStatus !== 'ACCEPTED' && ev.is_meeting,
      selfRsvpStatus: ev.is_meeting ? selfStatus : undefined,
      attendees: ev.is_meeting ? attendees : [],
    };
  });
}

// --- MAIN HOOK ---
export function useCalendarEvents(calendars: CalendarConfig[]) {
  const { getValidToken: getEwsToken } = useExchangeAuth();

  const results = useQueries({
    queries: calendars.map(cal => ({
      queryKey: CALENDAR_KEYS.events(cal.id),
      queryFn: async () => {
        if (cal.type === 'exchange') {
          const token = await getEwsToken(cal.exchangeAccountId!);
          if (!token) throw new Error('Unauthorized');
          return await fetchEWSEvents(cal, token);
        }
        // Fallback for others or stubs for now
        return [];
      },
      enabled: cal.type === 'exchange',
      staleTime: 5 * 60 * 1000,
    }))
  });

  const dataTimestamps = useMemo(() => results.map(r => r.dataUpdatedAt).join(','), [results]);

  const allEvents = useMemo(() => {
    return results.flatMap(r => r.data ?? []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataTimestamps]);

  return {
    events: allEvents,
    isLoading: results.some(r => r.isLoading),
    errors: results.map(r => r.error).filter(Boolean),
  };
}
