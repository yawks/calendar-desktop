export interface CalendarConfig {
  id: string;
  name: string;
  url: string;
  color: string;
  visible: boolean;
  ownerEmail?: string;
  /** 'ics' (default) | 'google' | 'eventkit' | 'nextcloud' */
  type?: 'ics' | 'google' | 'eventkit' | 'nextcloud';
  /** Google Calendar ID (e.g. "primary" or "user@group.calendar.google.com") */
  googleCalendarId?: string;
  /** Reference to GoogleAccount.id */
  googleAccountId?: string;
  /** EventKit calendarIdentifier (macOS only) */
  eventKitCalendarId?: string;
  /** Nextcloud server base URL (e.g. https://cloud.example.com) */
  nextcloudServerUrl?: string;
  /** Nextcloud username */
  nextcloudUsername?: string;
  /** Nextcloud app password */
  nextcloudPassword?: string;
}

export interface GoogleAccount {
  id: string;
  email: string;
  name: string;
  picture?: string;
  accessToken: string;
  refreshToken: string;
  /** Unix timestamp (ms) when the access token expires */
  expiresAt: number;
}

export interface CreateEventPayload {
  title: string;
  start: string; // ISO 8601
  end: string;   // ISO 8601
  isAllday: boolean;
  location?: string;
  description?: string;
  /** CalendarConfig.id of the target calendar (Google or EventKit) */
  calendarId: string;
  attendees?: Array<{ email: string; name?: string }>;
}

export type ViewType = 'day' | 'workweek' | 'week' | 'month';

export type AttendeeStatus =
  | 'ACCEPTED'
  | 'DECLINED'
  | 'TENTATIVE'
  | 'NEEDS-ACTION'
  | 'DELEGATED';

export interface Attendee {
  name: string;
  email: string;
  status: AttendeeStatus;
  isOrganizer?: boolean;
}

export interface CalendarEvent {
  id: string;
  /** Raw provider event ID (Google event ID or EventKit identifier) — used for updates */
  sourceId?: string;
  calendarId: string;
  title: string;
  start: string;
  end: string;
  isAllday: boolean;
  category: 'allday' | 'time';
  location?: string;
  description?: string;
  isUnaccepted?: boolean;
  isDeclined?: boolean;
  /** RSVP status of the current user (undefined if not an attendee or organizer) */
  selfRsvpStatus?: AttendeeStatus;
  attendees?: Attendee[];
}
