import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import { RecipientEntry } from '../components/RecipientInput';
import type { MailProvider } from '../providers/MailProvider';
import { isValidEmail } from '../utils';
import { useCalendars } from '../../calendar/store/CalendarStore';
import { useEWSEvents } from '../../calendar/hooks/useEWSEvents';
import { useGoogleEvents } from '../../calendar/hooks/useGoogleEvents';
import { useICSEvents } from '../../calendar/hooks/useICSEvents';
import { useNextcloudEvents } from '../../calendar/hooks/useNextcloudEvents';
import { recordContactObservations, searchContactIndex, usableContactName, type ContactObservation } from '../utils/contactIndex';

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
  const ewsCals = useMemo(() => calendars.filter(c => c.type === 'exchange'), [calendars]);

  const { events: icsEvents } = useICSEvents(icsCals);
  const { events: googleEvents } = useGoogleEvents(googleCals);
  const { events: ncEvents } = useNextcloudEvents(ncCals);
  const { events: ewsEvents } = useEWSEvents(ewsCals);
  const queryClient = useQueryClient();
  const allCalEvents = useMemo(
    () => [...icsEvents, ...googleEvents, ...ncEvents, ...ewsEvents],
    [icsEvents, googleEvents, ncEvents, ewsEvents],
  );
  const eventObservations = useMemo(() => {
    const grouped = new Map<string, ContactObservation[]>();
    const calendarsById = new Map(calendars.map(calendar => [calendar.id, calendar]));
    for (const event of allCalEvents) {
      const calendar = calendarsById.get(event.calendarId);
      const accountId = calendar?.exchangeAccountId ?? calendar?.googleAccountId;
      if (!accountId) continue;
      const parsed = Date.parse(event.start);
      if (!Number.isFinite(parsed)) continue;
      const occurredAt = Math.floor(parsed / 1000);
      const ownerEmail = calendar?.ownerEmail?.toLowerCase();
      const eventId = `event:${event.calendarId}:${event.sourceId ?? event.id}:${occurredAt}`;
      const observations = grouped.get(accountId) ?? [];
      for (const attendee of event.attendees ?? []) {
        if (!attendee.email || attendee.email.toLowerCase() === ownerEmail) continue;
        observations.push({
          email: attendee.email,
          displayName: attendee.name !== attendee.email ? attendee.name : undefined,
          kind: 'event',
          occurredAt,
          eventId,
        });
      }
      grouped.set(accountId, observations);
    }
    return grouped;
  }, [allCalEvents, calendars]);
  useEffect(() => {
    let cancelled = false;
    Promise.all([...eventObservations].map(([accountId, observations]) =>
      recordContactObservations(accountId, observations)
    )).then(results => {
      if (!cancelled && results.some(count => count > 0)) {
        void queryClient.invalidateQueries({ queryKey: ['contact-index'] });
        void queryClient.invalidateQueries({ queryKey: ['contact-index-search'] });
      }
    }).catch(error => console.error('[contact-index] unable to record event attendees', error));
    return () => { cancelled = true; };
  }, [eventObservations, queryClient]);

  return useMemo(() => {
    const freq = new Map<string, { name?: string; count: number; source: RecipientEntry['source'] }>();

    // 1. Calendar events — count occurrences for sorting by frequency
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
          freq.set(key, { name, count: 1, source: 'calendar' });
        }
      }
    }

    // 2. Mail contacts — add those not already present, with count 0
    for (const c of mailContacts) {
      if (!isValidEmail(c.email)) continue;
      const key = c.email.toLowerCase();
      const existing = freq.get(key);
      if (existing) {
        existing.count++;
        if (!existing.name && c.name) existing.name = c.name;
        // A direct mail relationship is more useful provenance than merely
        // co-attending a calendar event.
        existing.source = 'mail';
      } else {
        freq.set(key, { name: c.name, count: 1, source: 'mail' });
      }
    }

    return Array.from(freq.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(([email, { name, source }]) => ({ email, name, source }));
  }, [allCalEvents, mailContacts]);
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
  const { data: providerData } = useQuery({
    queryKey: ['contact-search', provider?.accountId, trimmed],
    queryFn: () => provider!.searchContacts!(trimmed, 10),
    enabled: trimmed.length >= 1 && !!provider?.searchContacts,
    staleTime: 60 * 1000,
    placeholderData: [],
  });
  const { data: indexedData } = useQuery({
    queryKey: ['contact-index-search', provider?.accountId, trimmed],
    queryFn: () => searchContactIndex([provider!.accountId], trimmed, 20),
    enabled: trimmed.length >= 1 && !!provider?.accountId,
    staleTime: 30 * 1000,
    placeholderData: [],
  });
  return useMemo(() => {
    const merged = new Map<string, RecipientEntry>();
    // The local relevance index covers regular correspondents who are absent from
    // the provider's explicit address book or corporate directory.
    for (const contact of indexedData ?? []) {
      merged.set(contact.email.toLowerCase(), { email: contact.email, name: contact.name, source: 'mail' });
    }
    for (const contact of providerData ?? []) {
      const key = contact.email.toLowerCase();
      const local = merged.get(key);
      merged.set(key, {
        email: contact.email,
        name: usableContactName(contact.name, contact.email) ?? local?.name,
        source: contact.source,
      });
    }
    return [...merged.values()];
  }, [indexedData, providerData]);
}
