import { CalendarEvent, CalendarConfig, CreateEventPayload } from '../types';

const BASE = 'https://www.googleapis.com/calendar/v3';

// ── Types returned by Google Calendar API ────────────────────────────────────

interface GoogleCalendarListEntry {
  id: string;
  summary: string;
  description?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  accessRole: 'freeBusyReader' | 'reader' | 'writer' | 'owner';
  primary?: boolean;
}

interface GoogleEventDateTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

interface GoogleAttendee {
  email: string;
  displayName?: string;
  responseStatus: 'accepted' | 'declined' | 'tentative' | 'needsAction';
  organizer?: boolean;
  self?: boolean;
}

interface GoogleConferenceEntryPoint {
  entryPointType: string;
  uri: string;
}

interface GoogleEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start: GoogleEventDateTime;
  end: GoogleEventDateTime;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  attendees?: GoogleAttendee[];
  organizer?: { email: string; displayName?: string };
  recurringEventId?: string;
  conferenceData?: {
    entryPoints?: GoogleConferenceEntryPoint[];
  };
}

interface GoogleEventList {
  items: GoogleEvent[];
  nextPageToken?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function gFetch<T>(token: string, path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google API ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

function mapResponseStatus(status: string): import('../types').AttendeeStatus {
  const map: Record<string, string> = {
    accepted: 'ACCEPTED',
    declined: 'DECLINED',
    tentative: 'TENTATIVE',
    needsAction: 'NEEDS-ACTION',
  };
  return (map[status] ?? 'NEEDS-ACTION') as ReturnType<typeof mapResponseStatus>;
}

function googleEventToCalendarEvent(gEvent: GoogleEvent, cal: CalendarConfig, ownerEmail?: string): CalendarEvent | null {
  if (gEvent.status === 'cancelled') return null;

  const isAllday = !gEvent.start.dateTime;
  const start = gEvent.start.dateTime ?? gEvent.start.date ?? '';
  const end = gEvent.end.dateTime ?? gEvent.end.date ?? '';

  if (!start || !end) return null;

  const attendees = gEvent.attendees?.map((a) => ({
    name: a.displayName ?? a.email,
    email: a.email,
    status: mapResponseStatus(a.responseStatus),
    isOrganizer: a.organizer ?? false,
  }));

  // Determine RSVP status from the owner's perspective
  let isUnaccepted = false;
  let isDeclined = false;
  let selfRsvpStatus: import('../types').AttendeeStatus | undefined;
  if (ownerEmail && attendees) {
    const self = attendees.find((a) => a.email.toLowerCase() === ownerEmail.toLowerCase());
    if (self && !self.isOrganizer) {
      isDeclined = self.status === 'DECLINED';
      isUnaccepted = self.status !== 'ACCEPTED';
      selfRsvpStatus = self.status;
    }
  }

  const meetUrl = gEvent.conferenceData?.entryPoints?.find(
    (ep) => ep.entryPointType === 'video'
  )?.uri;

  return {
    id: `${cal.id}-${gEvent.id}`,
    sourceId: gEvent.id,
    calendarId: cal.id,
    title: gEvent.summary ?? '(sans titre)',
    start,
    end,
    isAllday,
    category: isAllday ? 'allday' : 'time',
    location: gEvent.location,
    description: gEvent.description,
    isUnaccepted,
    isDeclined,
    selfRsvpStatus,
    attendees,
    meetUrl,
    seriesId: gEvent.recurringEventId ?? gEvent.id.split('_')[0],
  };
}

// ── FreeBusy types ────────────────────────────────────────────────────────────

interface FreeBusyApiResponse {
  calendars: Record<string, {
    busy: Array<{ start: string; end: string }>;
    errors?: Array<{ domain: string; reason: string }>;
  }>;
}

export interface FreeBusySlot {
  start: Date;
  end: Date;
}

export interface FreeBusyResult {
  busy: FreeBusySlot[];
  /** true if the calendar could not be queried (private or not found) */
  unavailable: boolean;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function listCalendars(token: string): Promise<GoogleCalendarListEntry[]> {
  const data = await gFetch<{ items: GoogleCalendarListEntry[] }>(token, '/users/me/calendarList');
  return data.items ?? [];
}

export async function listEvents(
  token: string,
  cal: CalendarConfig,
  timeMin: Date,
  timeMax: Date
): Promise<CalendarEvent[]> {
  const calendarId = encodeURIComponent(cal.googleCalendarId ?? 'primary');
  const results: CalendarEvent[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '2500',
      ...(pageToken ? { pageToken } : {}),
    });

    const data = await gFetch<GoogleEventList>(token, `/calendars/${calendarId}/events?${params}`);
    for (const gEvent of data.items ?? []) {
      const ev = googleEventToCalendarEvent(gEvent, cal, cal.ownerEmail);
      if (ev) results.push(ev);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return results;
}

function buildEventBody(payload: CreateEventPayload): Record<string, unknown> {
  const body: Record<string, unknown> = {
    summary: payload.title,
    location: payload.location ?? null,
    description: payload.description ?? null,
  };

  if (payload.isAllday) {
    body.start = { date: payload.start.slice(0, 10) };
    body.end = { date: payload.end.slice(0, 10) };
  } else {
    body.start = { dateTime: payload.start };
    body.end = { dateTime: payload.end };
  }

  if (payload.attendees && payload.attendees.length > 0) {
    body.attendees = payload.attendees.map((a) => {
      const entry: Record<string, string> = { email: a.email };
      if (a.name) entry.displayName = a.name;
      return entry;
    });
  }

  return body;
}

export async function createEvent(
  token: string,
  cal: CalendarConfig,
  payload: CreateEventPayload
): Promise<string> {
  const calendarId = encodeURIComponent(cal.googleCalendarId ?? 'primary');
  const res = await gFetch<GoogleEvent>(token, `/calendars/${calendarId}/events`, {
    method: 'POST',
    body: JSON.stringify(buildEventBody(payload)),
  });
  return res.recurringEventId ?? res.id.split('_')[0];
}

export async function updateEvent(
  token: string,
  cal: CalendarConfig,
  sourceId: string,
  payload: CreateEventPayload
): Promise<void> {
  const calendarId = encodeURIComponent(cal.googleCalendarId ?? 'primary');
  const eventId = encodeURIComponent(sourceId);
  await gFetch(token, `/calendars/${calendarId}/events/${eventId}`, {
    method: 'PUT',
    body: JSON.stringify(buildEventBody(payload)),
  });
}

export async function deleteGoogleEvent(
  token: string,
  cal: CalendarConfig,
  sourceId: string,
): Promise<void> {
  const calendarId = encodeURIComponent(cal.googleCalendarId ?? 'primary');
  const eventId = encodeURIComponent(sourceId);
  const res = await fetch(`${BASE}/calendars/${calendarId}/events/${eventId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const body = await res.text();
    throw new Error(`Google API ${res.status}: ${body}`);
  }
}

export async function queryFreeBusy(
  token: string,
  emails: string[],
  timeMin: Date,
  timeMax: Date,
): Promise<Record<string, FreeBusyResult>> {
  const body = {
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    items: emails.map((email) => ({ id: email })),
  };

  const data = await gFetch<FreeBusyApiResponse>(token, '/freeBusy', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const result: Record<string, FreeBusyResult> = {};
  for (const email of emails) {
    const cal = data.calendars[email];
    if (!cal) {
      result[email] = { busy: [], unavailable: true };
      continue;
    }
    result[email] = {
      busy: (cal.busy ?? []).map((s) => ({ start: new Date(s.start), end: new Date(s.end) })),
      unavailable: (cal.errors?.length ?? 0) > 0,
    };
  }
  return result;
}

export async function respondToGoogleEvent(
  token: string,
  cal: CalendarConfig,
  sourceId: string,
  ownerEmail: string,
  newStatus: 'ACCEPTED' | 'DECLINED' | 'TENTATIVE',
): Promise<void> {
  const calendarId = encodeURIComponent(cal.googleCalendarId ?? 'primary');
  const eventId = encodeURIComponent(sourceId);

  // Fetch current event to preserve all attendees
  const event = await gFetch<GoogleEvent>(token, `/calendars/${calendarId}/events/${eventId}`);

  const statusMap: Record<'ACCEPTED' | 'DECLINED' | 'TENTATIVE', GoogleAttendee['responseStatus']> = {
    ACCEPTED: 'accepted', DECLINED: 'declined', TENTATIVE: 'tentative',
  };
  const googleStatus = statusMap[newStatus];

  const updatedAttendees = (event.attendees ?? []).map((a) =>
    a.email.toLowerCase() === ownerEmail.toLowerCase()
      ? { ...a, responseStatus: googleStatus as GoogleAttendee['responseStatus'] }
      : a
  );

  await gFetch(token, `/calendars/${calendarId}/events/${eventId}?sendUpdates=none`, {
    method: 'PATCH',
    body: JSON.stringify({ attendees: updatedAttendees }),
  });
}
