import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { RecipientEntry } from '../components/RecipientInput';
import type { MailProvider } from '../providers/MailProvider';
import { isValidEmail } from '../utils';
import { useCalendars } from '../../calendar/store/CalendarStore';
import { useEWSEvents } from '../../calendar/hooks/useEWSEvents';
import { useEventKitEvents } from '../../calendar/hooks/useEventKitEvents';
import { useGoogleEvents } from '../../calendar/hooks/useGoogleEvents';
import { useICSEvents } from '../../calendar/hooks/useICSEvents';
import { useNextcloudEvents } from '../../calendar/hooks/useNextcloudEvents';

/**
 * Returns a deduplicated, frequency-sorted list of contacts from:
 * 1. Calendar event attendees (all providers)
 * 2. Mail contacts accumulated while browsing threads (passed as `mailContacts`)
 */
export function useContactSuggestions(
  mailContacts: RecipientEntry[]
): RecipientEntry[] {
  const { calendars } = useCalendars();

  const icsCals = useMemo(() => calendars.filter(c => !c.type || c.type === 'ics'), [calendars]);
  const googleCals = useMemo(() => calendars.filter(c => c.type === 'google'), [calendars]);
  const ncCals = useMemo(() => calendars.filter(c => c.type === 'nextcloud'), [calendars]);
  const ekCals = useMemo(() => calendars.filter(c => c.type === 'eventkit'), [calendars]);
  const ewsCals = useMemo(() => calendars.filter(c => c.type === 'exchange'), [calendars]);

  const { events: icsEvents } = useICSEvents(icsCals);
  const { events: googleEvents } = useGoogleEvents(googleCals);
  const { events: ncEvents } = useNextcloudEvents(ncCals);
  const { events: ekEvents } = useEventKitEvents(ekCals);
  const { events: ewsEvents } = useEWSEvents(ewsCals);

  return useMemo(() => {
    const freq = new Map<string, { name?: string; count: number }>();

    // 1. Calendar events — count occurrences for sorting by frequency
    const allCalEvents = [...icsEvents, ...googleEvents, ...ncEvents, ...ekEvents, ...ewsEvents];
    for (const ev of allCalEvents) {
      for (const a of ev.attendees ?? []) {
        if (!a.email || !isValidEmail(a.email)) continue;
        const key = a.email.toLowerCase();
        const existing = freq.get(key);
        const name = a.name !== a.email ? a.name : undefined;
        if (existing) {
          existing.count++;
          if (!existing.name && name) existing.name = name;
        } else {
          freq.set(key, { name, count: 1 });
        }
      }
    }

    // 2. Mail contacts — add those not already present, with count 0
    for (const c of mailContacts) {
      if (!isValidEmail(c.email)) continue;
      const key = c.email.toLowerCase();
      if (!freq.has(key)) {
        freq.set(key, { name: c.name, count: 0 });
      }
    }

    return Array.from(freq.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(([email, { name }]) => ({ email, name }));
  }, [icsEvents, googleEvents, ncEvents, ekEvents, ewsEvents, mailContacts]);
}

/**
 * Searches contacts from the given provider for the given query string.
 * Results are cached by React Query; returns [] while loading or if unsupported.
 */
export function useProviderContactSearch(
  query: string,
  provider: MailProvider | null | undefined
): RecipientEntry[] {
  const trimmed = query.trim();
  const { data } = useQuery({
    queryKey: ['contact-search', provider?.accountId, trimmed],
    queryFn: () => provider!.searchContacts!(trimmed, 10),
    enabled: trimmed.length >= 2 && !!provider?.searchContacts,
    staleTime: 60 * 1000,
    placeholderData: [],
  });
  return (data ?? []).map(c => ({ email: c.email, name: c.name }));
}
