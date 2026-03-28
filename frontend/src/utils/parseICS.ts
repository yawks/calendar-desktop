// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore – ical.js has no bundled types for v1.x
import ICAL from 'ical.js';
import { CalendarConfig, CalendarEvent, Attendee, AttendeeStatus } from '../types';

const RANGE_PAST_WEEKS = 52;
const RANGE_FUTURE_WEEKS = 104;
const MAX_RECURRENCES = 500;

const VALID_STATUSES = new Set<AttendeeStatus>([
  'ACCEPTED', 'DECLINED', 'TENTATIVE', 'NEEDS-ACTION', 'DELEGATED',
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toISO(icalTime: any): string {
  if (icalTime.isDate) {
    // All-day events have no time component. Avoid UTC conversion (toISOString)
    // which shifts the date backward in UTC+ timezones.
    const y = icalTime.year;
    const m = String(icalTime.month).padStart(2, '0');
    const d = String(icalTime.day).padStart(2, '0');
    return `${y}-${m}-${d}T00:00:00`;
  }
  return icalTime.toJSDate().toISOString();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseAttendees(vevent: any): Attendee[] {
  const attendees: Attendee[] = [];
  try {
    const organizerProp = vevent.getFirstProperty('organizer');
    let organizerEmail = '';
    if (organizerProp) {
      organizerEmail = (organizerProp.getFirstValue() as string).replace(/^mailto:/i, '').toLowerCase();
      const name = organizerProp.getParameter('cn') || organizerEmail;
      attendees.push({ name, email: organizerEmail, status: 'ACCEPTED', isOrganizer: true });
    }

    for (const prop of vevent.getAllProperties('attendee')) {
      const email = (prop.getFirstValue() as string).replace(/^mailto:/i, '').toLowerCase();
      if (email === organizerEmail) continue;
      const name = prop.getParameter('cn') || email;
      const raw = (prop.getParameter('partstat') as string | null)?.toUpperCase() ?? 'NEEDS-ACTION';
      const status: AttendeeStatus = VALID_STATUSES.has(raw as AttendeeStatus)
        ? (raw as AttendeeStatus)
        : 'NEEDS-ACTION';
      attendees.push({ name, email, status });
    }
  } catch {
    // best-effort
  }
  return attendees;
}

function getOwnerPartstat(vevent: unknown, ownerEmail?: string): 'ACCEPTED' | 'DECLINED' | 'TENTATIVE' | 'NEEDS-ACTION' | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = vevent as any;
  if (ownerEmail) {
    const email = ownerEmail.toLowerCase();
    for (const prop of v.getAllProperties?.('attendee') ?? []) {
      const attendeeEmail = (prop.getFirstValue() as string).replace(/^mailto:/i, '').toLowerCase();
      if (attendeeEmail === email) {
        const raw = (prop.getParameter('partstat') as string | null)?.toUpperCase() ?? 'NEEDS-ACTION';
        if (raw === 'DECLINED') return 'DECLINED';
        if (raw === 'TENTATIVE') return 'TENTATIVE';
        if (raw === 'NEEDS-ACTION') return 'NEEDS-ACTION';
        return 'ACCEPTED'; // ACCEPTED, DELEGATED, etc.
      }
    }
    // Organisateur → accepté
    const organizerProp = v.getFirstProperty?.('organizer');
    if (organizerProp) {
      const organizerEmail = (organizerProp.getFirstValue() as string).replace(/^mailto:/i, '').toLowerCase();
      if (organizerEmail === email) return 'ACCEPTED';
    }
  }
  // Fallback : STATUS du VEVENT
  const status = v.getFirstPropertyValue?.('status');
  return status === 'TENTATIVE' ? 'TENTATIVE' : null;
}

function buildEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  start: any, end: any, icalEvent: any, calendar: CalendarConfig, suffix = ''
): CalendarEvent {
  const isAllday = start.isDate === true;
  const attendees = parseAttendees(icalEvent.component);
  const partstat = getOwnerPartstat(icalEvent.component, calendar.ownerEmail);
  return {
    id: `${calendar.id}-${icalEvent.uid}-${suffix || start.toString()}`,
    sourceId: icalEvent.uid as string | undefined,
    calendarId: calendar.id,
    title: icalEvent.summary || '(sans titre)',
    start: toISO(start),
    end: toISO(end),
    isAllday,
    category: isAllday ? 'allday' : 'time',
    location: icalEvent.location || undefined,
    description: icalEvent.description || undefined,
    isUnaccepted: partstat !== null && partstat !== 'ACCEPTED',
    isDeclined: partstat === 'DECLINED',
    selfRsvpStatus: partstat ?? undefined,
    attendees: attendees.length > 0 ? attendees : undefined,
  };
}

function expandRecurring(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icalEvent: any, calendar: CalendarConfig, rangeStart: Date, rangeEnd: Date
): CalendarEvent[] {
  const results: CalendarEvent[] = [];
  try {
    const expand = new ICAL.RecurExpansion({
      component: icalEvent.component,
      dtstart: icalEvent.startDate,
    });
    let count = 0;
    let next = expand.next();
    while (next && count < MAX_RECURRENCES) {
      const d: Date = next.toJSDate();
      if (d > rangeEnd) break;
      if (d >= rangeStart) {
        const det = icalEvent.getOccurrenceDetails(next);
        results.push(buildEvent(det.startDate, det.endDate, det.item, calendar, next.toString()));
      }
      count++;
      next = expand.next();
    }
  } catch {
    const startDate: Date = icalEvent.startDate?.toJSDate();
    if (startDate && startDate >= rangeStart && startDate <= rangeEnd) {
      results.push(buildEvent(icalEvent.startDate, icalEvent.endDate, icalEvent, calendar));
    }
  }
  return results;
}

interface VEventGroup {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  master?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exceptions: any[];
}

function buildDateRange(): { rangeStart: Date; rangeEnd: Date } {
  const now = new Date();
  const rangeStart = new Date(now);
  rangeStart.setDate(rangeStart.getDate() - RANGE_PAST_WEEKS * 7);
  const rangeEnd = new Date(now);
  rangeEnd.setDate(rangeEnd.getDate() + RANGE_FUTURE_WEEKS * 7);
  return { rangeStart, rangeEnd };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function groupByUid(comp: any): Map<string, VEventGroup> {
  const byUid = new Map<string, VEventGroup>();
  for (const vevent of comp.getAllSubcomponents('vevent')) {
    const uid = (vevent.getFirstPropertyValue('uid') as string) ?? crypto.randomUUID();
    if (!byUid.has(uid)) byUid.set(uid, { exceptions: [] });
    const group = byUid.get(uid)!;
    if (vevent.hasProperty('recurrence-id')) {
      group.exceptions.push(vevent);
    } else {
      group.master = vevent;
    }
  }
  return byUid;
}

function processGroup(
  group: VEventGroup, calendar: CalendarConfig, rangeStart: Date, rangeEnd: Date
): CalendarEvent[] {
  if (group.master) {
    // Build ICAL.Event with its exceptions so RecurExpansion
    // replaces/skips modified occurrences instead of duplicating them.
    const icalEvent = new ICAL.Event(group.master, {
      strictExceptions: false,
      exceptions: group.exceptions,
    });
    if (icalEvent.isRecurring()) {
      return expandRecurring(icalEvent, calendar, rangeStart, rangeEnd);
    }
    const startDate: Date = icalEvent.startDate?.toJSDate();
    if (startDate && startDate >= rangeStart && startDate <= rangeEnd) {
      return [buildEvent(icalEvent.startDate, icalEvent.endDate, icalEvent, calendar)];
    }
    return [];
  }

  // No master VEVENT — process orphan exceptions individually
  return group.exceptions.flatMap((vevent) => {
    const icalEvent = new ICAL.Event(vevent);
    const startDate: Date = icalEvent.startDate?.toJSDate();
    if (startDate && startDate >= rangeStart && startDate <= rangeEnd) {
      return [buildEvent(icalEvent.startDate, icalEvent.endDate, icalEvent, calendar)];
    }
    return [];
  });
}

export function parseICS(icsText: string, calendar: CalendarConfig): CalendarEvent[] {
  try {
    const comp = new ICAL.Component(ICAL.parse(icsText));
    const { rangeStart, rangeEnd } = buildDateRange();
    const byUid = groupByUid(comp);
    return [...byUid.values()].flatMap((group) =>
      processGroup(group, calendar, rangeStart, rangeEnd)
    );
  } catch (e) {
    console.error(`[parseICS] Failed for "${calendar.name}":`, e);
    return [];
  }
}
