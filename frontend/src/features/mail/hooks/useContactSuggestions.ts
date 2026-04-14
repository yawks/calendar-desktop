import { useMemo } from 'react';

import { RecipientEntry } from '../components/RecipientInput';
import { useCalendars } from '../../../store/CalendarStore';
import { useEWSEvents } from '../../../hooks/useEWSEvents';
import { useEventKitEvents } from '../../../hooks/useEventKitEvents';
import { useGoogleEvents } from '../../../hooks/useGoogleEvents';
import { useICSEvents } from '../../../hooks/useICSEvents';
import { useNextcloudEvents } from '../../../hooks/useNextcloudEvents';

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
        if (!a.email) continue;
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
