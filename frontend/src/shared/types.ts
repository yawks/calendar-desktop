export interface CalendarGroup {
  id: string;
  name: string;
  collapsed?: boolean;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export type EventTagMapping = Record<string, string>;

export interface CalendarConfig {
  id: string;
  name: string;
  url: string;
  color: string;
  visible: boolean;
  ownerEmail?: string;
  /** Group this calendar belongs to (default: 'default') */
  groupId?: string;
  /** 'ics' (default) | 'google' | 'eventkit' | 'nextcloud' | 'exchange' */
  type?: 'ics' | 'google' | 'eventkit' | 'nextcloud' | 'exchange';
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
  /** Reference to ExchangeAccount.id */
  exchangeAccountId?: string;
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
  /** UI color for this account (used in mail) */
  color?: string;
  /** Which capabilities are enabled. Defaults to both if absent (backwards compat). */
  enabledCapabilities?: ('calendar' | 'email')[];
}

export interface ImapAccount {
  id: string;
  email: string;
  displayName: string;
  imapServer: string;
  imapPort: number;
  imapUseSsl: boolean;
  imapUseStarttls: boolean;
  imapUsername: string;
  imapPassword: string;
  smtpServer: string;
  smtpPort: number;
  smtpUseSsl: boolean;
  smtpUseStarttls: boolean;
  smtpUsername: string;
  smtpPassword: string;
  /** UI color for this account (used in mail) */
  color?: string;
}

export interface JmapAccount {
  id: string;
  email: string;
  displayName: string;
  sessionUrl: string;
  /** Bearer API token OR app password (used with Basic auth when authType='basic') */
  token: string;
  /** 'bearer' (default) or 'basic' (email + app password) */
  authType?: 'bearer' | 'basic';
  /** UI color for this account (used in mail) */
  color?: string;
}

export interface ExchangeAccount {
  id: string;
  email: string;
  displayName: string;
  accessToken: string;
  refreshToken: string;
  /** Unix timestamp (ms) when the access token expires */
  expiresAt: number;
  /** UI color for this account (used in mail) */
  color?: string;
  /** Which capabilities are enabled. Defaults to both if absent (backwards compat). */
  enabledCapabilities?: ('calendar' | 'email')[];
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
  tagId?: string | null;
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
  /** Google Meet or other video conference URL */
  meetUrl?: string;
  /** Series ID used to identify recurring events or events that share the same root identifier */
  seriesId?: string;
  /** Tag assigned to this event locally */
  tagId?: string;
}
