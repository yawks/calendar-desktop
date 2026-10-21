import { validateEventOptions } from './eventOptions';
import { t } from 'i18next';
import { anchorSeriesDates } from './seriesDates';
import { CalendarEvent, CalendarConfig, CreateEventPayload } from '../../../shared/types';

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
  iCalUID?: string;
  id: string;
  summary?: string;
  visibility?: string;
  transparency?: string;
  eventType?: string;
  workingLocationProperties?: { type: string; customLocation?: { label?: string }; officeLocation?: { label?: string } };
  description?: string;
  location?: string;
  start?: GoogleEventDateTime;
  end?: GoogleEventDateTime;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  attendees?: GoogleAttendee[];
  organizer?: { email: string; displayName?: string };
  recurringEventId?: string;
  recurrence?: string[];
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

function mapResponseStatus(status: string): import('../../../shared/types').AttendeeStatus {
  const map: Record<string, string> = {
    accepted: 'ACCEPTED',
    declined: 'DECLINED',
    tentative: 'TENTATIVE',
    needsAction: 'NEEDS-ACTION',
  };
  return (map[status] ?? 'NEEDS-ACTION') as ReturnType<typeof mapResponseStatus>;
}

function googleEventToCalendarEvent(gEvent: GoogleEvent, cal: CalendarConfig, ownerEmail?: string): CalendarEvent | null {
  if (!gEvent.start || !gEvent.end) return null;
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
  // Prefer a.self === true (Google marks your own entry) over email matching which can fail with aliases
  let isUnaccepted = false;
  let isDeclined = false;
  let selfRsvpStatus: import('../../../shared/types').AttendeeStatus | undefined;
  const selfGoogleAttendee = gEvent.attendees?.find((a) => a.self === true)
    ?? (ownerEmail ? gEvent.attendees?.find((a) => a.email.toLowerCase() === ownerEmail.toLowerCase()) : undefined);
  if (selfGoogleAttendee && !selfGoogleAttendee.organizer) {
    isDeclined = selfGoogleAttendee.responseStatus === 'declined';
    isUnaccepted = selfGoogleAttendee.responseStatus !== 'accepted';
    selfRsvpStatus = mapResponseStatus(selfGoogleAttendee.responseStatus);
  }

  const meetUrl = gEvent.conferenceData?.entryPoints?.find(
    (ep) => ep.entryPointType === 'video'
  )?.uri;

  return {
    id: `${cal.id}-${gEvent.id}`,
    sourceId: gEvent.id,
    icalUid: gEvent.iCalUID,
    calendarId: cal.id,
    sensitivity: gEvent.visibility,
    availability: gEvent.transparency,
    eventType: gEvent.eventType,
    title: gEvent.summary ?? '(sans titre)',
    start,
    end,
    isAllday,
    category: isAllday ? 'allday' : 'time',
    location: gEvent.workingLocationProperties?.customLocation?.label ?? gEvent.workingLocationProperties?.officeLocation?.label ?? gEvent.location,
    description: gEvent.description,
    isCancelled: gEvent.status === 'cancelled',
    isUnaccepted,
    isDeclined,
    selfRsvpStatus,
    attendees,
    meetUrl,
    seriesId: gEvent.recurringEventId || gEvent.id.split('_')[0],
    isRecurringInstance: !!gEvent.recurringEventId,
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
  const items: GoogleCalendarListEntry[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ maxResults: '250', ...(pageToken ? { pageToken } : {}) });
    const data = await gFetch<{ items?: GoogleCalendarListEntry[]; nextPageToken?: string }>(token, `/users/me/calendarList?${params}`);
    items.push(...(data.items ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return items;
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
      showDeleted: 'true',
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
  validateEventOptions(payload, 'google');
  const body: Record<string, unknown> = {
    summary: payload.title,
    location: payload.location ?? null,
    description: payload.description ?? null,
  };

  if (payload.sensitivity !== undefined) body.visibility = payload.sensitivity;
  if (payload.availability !== undefined) body.transparency = payload.availability;

  if (payload.isAllday) {
    body.start = { date: payload.start.slice(0, 10) };
    body.end = { date: payload.end.slice(0, 10) };
  } else {
    body.start = { dateTime: payload.start, timeZone: payload.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone };
    body.end = { dateTime: payload.end, timeZone: payload.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone };
  }

  if (payload.attendees && payload.attendees.length > 0) {
    body.attendees = payload.attendees.map((a) => {
      const entry: Record<string, string> = { email: a.email };
      if (a.name) entry.displayName = a.name;
      return entry;
    });
  }

  if (payload.recurrence !== undefined) body.recurrence = payload.recurrence ? [`RRULE:${payload.recurrence}`] : [];
  return body;
}

function applyGoogleEventType(body: Record<string, unknown>, payload: CreateEventPayload, creating: boolean) {
  const type = payload.eventType ?? 'default';
  if (creating) body.eventType = type;
  if (type === 'outOfOffice' || type === 'focusTime') {
    if (payload.isAllday) throw new Error(t('eventOptions.timedOnly'));
    body.transparency = 'opaque';
    if (creating) body[`${type}Properties`] = { autoDeclineMode: 'declineNone' };
  }
  if (type === 'workingLocation') {
    delete body.location;
    body.visibility = 'public';
    body.transparency = 'transparent';
    if (creating) body.workingLocationProperties = { type: 'customLocation', customLocation: { label: payload.location || payload.title } };
    if (payload.isAllday && Date.parse(payload.end) - Date.parse(payload.start) !== 86400000) throw new Error(t('eventOptions.oneDayOnly'));
  }
  if (type === 'birthday') {
    if (!payload.isAllday || Date.parse(payload.end) - Date.parse(payload.start) !== 86400000) throw new Error(t('eventOptions.birthdayOnly'));
    if (creating) {
      body.birthdayProperties = { type: 'birthday' };
      body.recurrence = [payload.start.slice(5, 10) === '02-29' ? 'RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1' : 'RRULE:FREQ=YEARLY'];
    }
    body.visibility = 'private';
    for (const key of ['location', 'description', 'attendees']) delete body[key];
    body.transparency = 'transparent';
    if (!creating) { delete body.visibility; delete body.transparency; delete body.recurrence; }
  }
  if (['outOfOffice', 'focusTime', 'workingLocation', 'birthday'].includes(type)) delete body.attendees;
  if (type === 'fromGmail') {
    for (const key of Object.keys(body)) if (!['visibility', 'transparency', 'attendees'].includes(key)) delete body[key];
  }
}

export async function createEvent(
  token: string,
  cal: CalendarConfig,
  payload: CreateEventPayload
): Promise<string> {
  if (cal.shared) throw new Error(t('sharedCalendars.readOnly'));
  const calendarId = encodeURIComponent(cal.googleCalendarId ?? 'primary');
  const body = buildEventBody(payload);
  const type = payload.eventType ?? 'default';
  applyGoogleEventType(body, payload, true);
  if (payload.onlineMeeting && type === 'default') {
    body.conferenceData = { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  }
  const query = payload.onlineMeeting && type === 'default' ? '?conferenceDataVersion=1' : '';
  const res = await gFetch<GoogleEvent>(token, `/calendars/${calendarId}/events${query}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.recurringEventId ?? res.id.split('_')[0];
}

export async function updateEvent(
  token: string,
  cal: CalendarConfig,
  sourceId: string,
  payload: CreateEventPayload,
  originalOccurrenceStart?: string,
  sendUpdates = false,
): Promise<void> {
  if (cal.shared) throw new Error(t('sharedCalendars.readOnly'));
  const calendarId = encodeURIComponent(cal.googleCalendarId ?? 'primary');
  const eventId = encodeURIComponent(sourceId);
  if (originalOccurrenceStart) {
    const master = await gFetch<GoogleEvent>(token, `/calendars/${calendarId}/events/${eventId}`);
    const masterStart = master.start?.dateTime ?? master.start?.date;
    if (!masterStart) throw new Error('Recurring master start missing');
    payload = anchorSeriesDates(payload, originalOccurrenceStart, masterStart);
    if (master.start?.timeZone) payload.timeZone = master.start.timeZone;
  }
  const body = buildEventBody(payload);
  applyGoogleEventType(body, payload, false);
  if (payload.eventType === 'workingLocation') {
    const current = await gFetch<GoogleEvent>(token, `/calendars/${calendarId}/events/${eventId}`);
    const label = current.workingLocationProperties?.customLocation?.label ?? current.workingLocationProperties?.officeLocation?.label ?? current.location ?? '';
    if ((payload.location ?? '') !== label) {
      body.workingLocationProperties = { type: 'customLocation', customLocation: { label: payload.location || payload.title } };
    }
  }
  await gFetch(token, `/calendars/${calendarId}/events/${eventId}${sendUpdates ? '?sendUpdates=all' : ''}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function deleteGoogleEvent(
  token: string,
  cal: CalendarConfig,
  sourceId: string,
  sendUpdates = false,
): Promise<void> {
  if (cal.shared) throw new Error(t('sharedCalendars.readOnly'));
  const calendarId = encodeURIComponent(cal.googleCalendarId ?? 'primary');
  const eventId = encodeURIComponent(sourceId);
  const query = sendUpdates ? '?sendUpdates=all' : '';
  const res = await fetch(`${BASE}/calendars/${calendarId}/events/${eventId}${query}`, {
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
  _comment?: string,
): Promise<void> {
  if (cal.shared) throw new Error(t('sharedCalendars.readOnly'));
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

export async function getGoogleRecurrence(token: string, cal: CalendarConfig, seriesId: string): Promise<string | null> {
  const event = await gFetch<GoogleEvent>(token, `/calendars/${encodeURIComponent(cal.googleCalendarId ?? 'primary')}/events/${encodeURIComponent(seriesId)}`);
  if (event.recurrence?.some(line => !line.startsWith('RRULE:'))) return null;
  const rules = event.recurrence?.filter(line => line.startsWith('RRULE:')) ?? [];
  return rules.length === 1 ? rules[0].slice(6) : null;
}
