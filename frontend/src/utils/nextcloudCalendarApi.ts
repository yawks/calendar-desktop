import { CalendarConfig, CreateEventPayload } from '../types';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore – ical.js has no bundled types for v1.x
import ICAL from 'ical.js';

// ── ICS text generation ───────────────────────────────────────────────────────

function escapeICS(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toICSDateTime(iso: string): string {
  const d = new Date(iso);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function toICSDate(iso: string): string {
  // Take the date part regardless of whether it's a full ISO or date-only string
  return iso.substring(0, 10).replace(/-/g, '');
}

function buildVCalendar(uid: string, payload: CreateEventPayload): string {
  const now = toICSDateTime(new Date().toISOString());

  const startProp = payload.isAllday
    ? `DTSTART;VALUE=DATE:${toICSDate(payload.start)}`
    : `DTSTART:${toICSDateTime(payload.start)}`;

  const endProp = payload.isAllday
    ? `DTEND;VALUE=DATE:${toICSDate(payload.end)}`
    : `DTEND:${toICSDateTime(payload.end)}`;

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CalendarDesktop//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    startProp,
    endProp,
    `SUMMARY:${escapeICS(payload.title)}`,
  ];

  if (payload.location?.trim()) {
    lines.push(`LOCATION:${escapeICS(payload.location)}`);
  }
  if (payload.description?.trim()) {
    lines.push(`DESCRIPTION:${escapeICS(payload.description)}`);
  }
  if (payload.attendees?.length) {
    for (const a of payload.attendees) {
      const cn = a.name ? `;CN=${escapeICS(a.name)}` : '';
      lines.push(
        `ATTENDEE${cn};CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.email}`
      );
    }
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

// ── Resource URL helpers ──────────────────────────────────────────────────────

function eventResourceUrl(cal: CalendarConfig, uid: string): string {
  const base = cal.url.endsWith('/') ? cal.url : `${cal.url}/`;
  return `${base}${encodeURIComponent(uid)}.ics`;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function createNextcloudEvent(cal: CalendarConfig, payload: CreateEventPayload): Promise<string> {
  const uid = crypto.randomUUID();
  const icsContent = buildVCalendar(uid, payload);
  const url = eventResourceUrl(cal, uid);

  const { invoke } = await import('@tauri-apps/api/core');
  console.debug('[nextcloud] createNextcloudEvent', { url, uid, payload, icsContent });
  await invoke('put_caldav_event', {
    url,
    username: cal.nextcloudUsername ?? '',
    password: cal.nextcloudPassword ?? '',
    icsContent,
  });
  return uid;
}

export async function updateNextcloudEvent(
  cal: CalendarConfig,
  uid: string,
  payload: CreateEventPayload,
): Promise<void> {
  const icsContent = buildVCalendar(uid, payload);
  const url = eventResourceUrl(cal, uid);

  const { invoke } = await import('@tauri-apps/api/core');
  console.debug('[nextcloud] updateNextcloudEvent', { url, uid, payload, icsContent });
  await invoke('put_caldav_event', {
    url,
    username: cal.nextcloudUsername ?? '',
    password: cal.nextcloudPassword ?? '',
    icsContent,
  });
}

export async function deleteNextcloudEvent(cal: CalendarConfig, uid: string): Promise<void> {
  const url = eventResourceUrl(cal, uid);
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('delete_caldav_event', {
    url,
    username: cal.nextcloudUsername ?? '',
    password: cal.nextcloudPassword ?? '',
  });
}

export async function respondToNextcloudEvent(
  cal: CalendarConfig,
  uid: string,
  selfEmail: string,
  newStatus: 'ACCEPTED' | 'DECLINED' | 'TENTATIVE',
  comment?: string,
): Promise<void> {
  const url = eventResourceUrl(cal, uid);
  const { invoke } = await import('@tauri-apps/api/core');

  const currentIcs = await invoke<string>('fetch_url_with_auth', {
    url,
    username: cal.nextcloudUsername ?? '',
    password: cal.nextcloudPassword ?? '',
  });

  const comp = new ICAL.Component(ICAL.parse(currentIcs));
  const vevent = comp.getFirstSubcomponent('vevent');
  if (!vevent) throw new Error('VEVENT introuvable dans le fichier ICS');

  const emailLower = selfEmail.toLowerCase();
  let found = false;
  for (const prop of vevent.getAllProperties('attendee')) {
    const email = (prop.getFirstValue() as string).replace(/^mailto:/i, '').toLowerCase();
    if (email === emailLower) {
      prop.setParameter('partstat', newStatus);
      found = true;
      break;
    }
  }
  if (!found) throw new Error(`Participant ${selfEmail} introuvable dans l'événement`);

  if (comment) {
    const commentProp = vevent.getFirstProperty('comment');
    if (commentProp) {
      commentProp.setValue(comment);
    } else {
      vevent.addPropertyWithValue('comment', comment);
    }
  }

  await invoke('put_caldav_event', {
    url,
    username: cal.nextcloudUsername ?? '',
    password: cal.nextcloudPassword ?? '',
    icsContent: comp.toString(),
  });
}
