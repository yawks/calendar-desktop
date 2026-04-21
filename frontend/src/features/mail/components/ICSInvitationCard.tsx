/**
 * ICSInvitationCard
 *
 * Shown when a mail message contains a .ics attachment.
 * Parses the ICS file, displays the event invitation with RSVP actions,
 * and shows a read-only day timeline of the event's date on the side.
 */
// @ts-ignore – ical.js has no bundled types for v1.x
import ICAL from 'ical.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCheck, ChevronDown, MapPin, Clock, Users, Check, Minus, X, Plus, Loader2 } from 'lucide-react';
import { CalendarConfig, CalendarEvent, AttendeeStatus } from '../../../shared/types';
import { MailAttachment } from '../types';
import { useCalendars } from '../../calendar/store/CalendarStore';
import { useGoogleAuth } from '../../../shared/store/GoogleAuthStore';
import { useExchangeAuth } from '../../../shared/store/ExchangeAuthStore';
import { useGoogleEvents, patchGoogleCachedRsvp } from '../../calendar/hooks/useGoogleEvents';
import { useNextcloudEvents, patchNextcloudCachedRsvp } from '../../calendar/hooks/useNextcloudEvents';
import { useEventKitEvents } from '../../calendar/hooks/useEventKitEvents';
import { useEWSEvents, patchEWSCachedRsvp } from '../../calendar/hooks/useEWSEvents';
import { useICSEvents } from '../../calendar/hooks/useICSEvents';
import { DayEventsTimeline } from '../../calendar/components/DayEventsTimeline';
import { respondToGoogleEvent, createEvent as createGoogleEvent } from '../../calendar/utils/googleCalendarApi';
import { respondToNextcloudEvent, createNextcloudEvent } from '../../calendar/utils/nextcloudCalendarApi';
import './ICSInvitationCard.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

function decodeBase64Utf8(b64: string): string {
  const bytes = Uint8Array.from(atob(b64), c => c.codePointAt(0) ?? 0);
  return new TextDecoder().decode(bytes);
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function dateAreSimilar(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  // Same day + within 5 minutes (handles minor timezone diffs)
  return isSameDay(da, db) && Math.abs(da.getTime() - db.getTime()) < 5 * 60 * 1000;
}

function normTitle(t: string): string {
  return t.trim().toLowerCase().replaceAll(/\s+/g, ' ');
}

/** Find the best matching calendar event for the ICS invitation */
function matchEvent(
  icsTitle: string,
  icsStart: string,
  allEvents: CalendarEvent[],
): CalendarEvent | null {
  const title = normTitle(icsTitle);
  for (const ev of allEvents) {
    if (normTitle(ev.title) === title && dateAreSimilar(ev.start, icsStart)) {
      return ev;
    }
  }
  // Relax: same title + same day
  const icsDay = new Date(icsStart);
  for (const ev of allEvents) {
    if (normTitle(ev.title) === title && isSameDay(new Date(ev.start), icsDay)) {
      return ev;
    }
  }
  return null;
}

function supportsRsvp(type: CalendarConfig['type']): boolean {
  return type === 'google' || type === 'nextcloud' || type === 'exchange';
}

function statusLabel(status: AttendeeStatus | undefined): string {
  switch (status) {
    case 'ACCEPTED':     return 'Accepté';
    case 'DECLINED':     return 'Refusé';
    case 'TENTATIVE':    return 'Peut-être';
    case 'NEEDS-ACTION': return 'En attente';
    default:             return 'Non répondu';
  }
}

function statusClass(status: AttendeeStatus | undefined): string {
  switch (status) {
    case 'ACCEPTED':  return 'ics-status--accepted';
    case 'DECLINED':  return 'ics-status--declined';
    case 'TENTATIVE': return 'ics-status--tentative';
    default:          return 'ics-status--pending';
  }
}

// ── Raw ICS event data (provider-agnostic) ────────────────────────────────────

interface ICSEventData {
  title: string;
  start: string;       // ISO
  end: string;         // ISO
  isAllday: boolean;
  location?: string;
  description?: string;
  organizer?: { name: string; email: string };
  attendees: Array<{ name: string; email: string; status: AttendeeStatus; isOrganizer?: boolean }>;
  uid?: string;
  method?: string;     // VCALENDAR METHOD property (e.g. "CANCEL", "REQUEST", "REPLY")
}

function parseRawICS(icsText: string): ICSEventData | null {
  try {
    const comp = new ICAL.Component(ICAL.parse(icsText));
    const vevent = comp.getFirstSubcomponent('vevent');
    if (!vevent) return null;

    const ev = new ICAL.Event(vevent);

    const toISO = (t: unknown): string => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ict = t as any;
      if (ict?.isDate) {
        const y = ict.year, m = String(ict.month).padStart(2, '0'), d = String(ict.day).padStart(2, '0');
        return `${y}-${m}-${d}T00:00:00`;
      }
      return ict?.toJSDate?.()?.toISOString?.() ?? '';
    };

    const attendees: ICSEventData['attendees'] = [];

    const orgProp = vevent.getFirstProperty('organizer');
    let orgEmail = '';
    if (orgProp) {
      orgEmail = (orgProp.getFirstValue() as string).replace(/^mailto:/i, '').toLowerCase();
      const orgName = orgProp.getParameter('cn') ?? orgEmail;
      attendees.push({ name: orgName, email: orgEmail, status: 'ACCEPTED', isOrganizer: true });
    }

    const validStatuses = new Set(['ACCEPTED', 'DECLINED', 'TENTATIVE', 'NEEDS-ACTION', 'DELEGATED']);
    for (const prop of vevent.getAllProperties('attendee')) {
      const email = (prop.getFirstValue() as string).replace(/^mailto:/i, '').toLowerCase();
      if (email === orgEmail) continue;
      const name = prop.getParameter('cn') ?? email;
      const raw = ((prop.getParameter('partstat') as string | null) ?? 'NEEDS-ACTION').toUpperCase();
      const status = validStatuses.has(raw) ? (raw as AttendeeStatus) : 'NEEDS-ACTION';
      attendees.push({ name, email, status });
    }

    const methodProp = comp.getFirstProperty('method');
    const method = methodProp
      ? (methodProp.getFirstValue() as string).toUpperCase()
      : undefined;

    return {
      title:    ev.summary    ?? '(sans titre)',
      start:    toISO(ev.startDate),
      end:      toISO(ev.endDate),
      isAllday: ev.startDate?.isDate === true,
      location: ev.location   ?? undefined,
      description: ev.description ?? undefined,
      organizer: orgEmail ? { name: attendees[0]?.name ?? orgEmail, email: orgEmail } : undefined,
      attendees,
      uid: ev.uid ?? undefined,
      method,
    };
  } catch (e) {
    console.error('[ICSInvitationCard] parse error', e);
    return null;
  }
}

// ── RSVP execution ─────────────────────────────────────────────────────────────

async function executeRsvp(
  cal: CalendarConfig,
  event: CalendarEvent,
  status: 'ACCEPTED' | 'DECLINED' | 'TENTATIVE',
  getGoogleToken: (id: string) => Promise<string | null>,
  getExchangeToken: (id: string) => Promise<string | null>,
): Promise<void> {
  if (cal.type === 'google') {
    if (!cal.googleAccountId || !event.sourceId || !cal.ownerEmail) throw new Error('Informations manquantes');
    const token = await getGoogleToken(cal.googleAccountId);
    if (!token) throw new Error('Token Google invalide');
    await respondToGoogleEvent(token, cal, event.sourceId, cal.ownerEmail, status);
  } else if (cal.type === 'nextcloud') {
    if (!event.sourceId || !cal.ownerEmail) throw new Error('Informations manquantes');
    await respondToNextcloudEvent(cal, event.sourceId, cal.ownerEmail, status);
  } else if (cal.type === 'exchange') {
    if (!cal.exchangeAccountId || !event.sourceId) throw new Error('Informations manquantes');
    const token = await getExchangeToken(cal.exchangeAccountId);
    if (!token) throw new Error('Token Exchange invalide');
    const [itemId, changeKey] = event.sourceId.split('|');
    const responseTypeMap: Record<string, string> = { ACCEPTED: 'accept', DECLINED: 'decline', TENTATIVE: 'tentative' };
    const responseType = responseTypeMap[status];
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('ews_respond_to_invitation', {
      accessToken: token,
      itemId,
      changeKey,
      responseType,
      ownerEmail: cal.ownerEmail,
      body: null,
    });
  } else {
    throw new Error('Ce calendrier ne supporte pas le RSVP');
  }
}

async function addToCalendar(
  cal: CalendarConfig,
  icsData: ICSEventData,
  getGoogleToken: (id: string) => Promise<string | null>,
  getExchangeToken: (id: string) => Promise<string | null>,
): Promise<void> {
  const payload = {
    title: icsData.title,
    start: icsData.start,
    end:   icsData.end,
    isAllday: icsData.isAllday,
    calendarId: cal.id,
    location: icsData.location,
    description: icsData.description,
    attendees: icsData.attendees.map(a => ({ email: a.email, name: a.name })),
  };

  if (cal.type === 'google') {
    if (!cal.googleAccountId) throw new Error('Compte Google introuvable');
    const token = await getGoogleToken(cal.googleAccountId);
    if (!token) throw new Error('Token Google invalide');
    await createGoogleEvent(token, cal, payload);
  } else if (cal.type === 'nextcloud') {
    await createNextcloudEvent(cal, payload);
  } else if (cal.type === 'exchange') {
    if (!cal.exchangeAccountId) throw new Error('Compte Exchange introuvable');
    const token = await getExchangeToken(cal.exchangeAccountId);
    if (!token) throw new Error('Token Exchange invalide');
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('ews_create_event', {
      accessToken: token,
      title: payload.title,
      start: payload.start,
      end: payload.end,
      isAllDay: payload.isAllday,
      location: payload.location ?? null,
      description: payload.description ?? null,
      attendees: null,
    });
  } else if (cal.type === 'eventkit') {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('create_eventkit_event', {
      payload: {
        calendar_id: cal.eventKitCalendarId,
        title: payload.title,
        start: payload.start,
        end: payload.end,
        is_all_day: payload.isAllday,
        location: payload.location ?? null,
        notes: payload.description ?? null,
        attendees: null,
      },
    });
  } else {
    throw new Error('Type de calendrier non supporté');
  }
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function CalendarSelector({
  calendars,
  selectedId,
  onChange,
}: {
  readonly calendars: CalendarConfig[];
  readonly selectedId: string;
  readonly onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = calendars.find(c => c.id === selectedId);

  return (
    <div className="ics-cal-selector">
      <button
        className="ics-cal-selector__btn"
        onClick={() => setOpen(v => !v)}
        type="button"
      >
        {selected && (
          <span className="ics-cal-dot" style={{ background: selected.color }} />
        )}
        <span className="ics-cal-selector__name">
          {selected?.name ?? 'Choisir un calendrier'}
        </span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <>
          <button
            type="button"
            className="ics-cal-selector__overlay"
            onClick={() => setOpen(false)}
            onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
            aria-label="Fermer"
          />
          <div className="ics-cal-selector__dropdown">
            {calendars.map(cal => (
              <button
                key={cal.id}
                className={`ics-cal-selector__option${cal.id === selectedId ? ' ics-cal-selector__option--active' : ''}`}
                onClick={() => { onChange(cal.id); setOpen(false); }}
                type="button"
              >
                <span className="ics-cal-dot" style={{ background: cal.color }} />
                <span>{cal.name}</span>
                {cal.ownerEmail && (
                  <span className="ics-cal-selector__owner">{cal.ownerEmail}</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── RSVP persistence (localStorage) ──────────────────────────────────────────

function rsvpStorageKey(icsData: ICSEventData): string {
  // Prefer UID if present; otherwise fall back to title + date
  const id = icsData.uid ?? `${icsData.title}::${icsData.start.split('T')[0]}`;
  return `ics-rsvp:${id}`;
}

function loadStoredRsvp(icsData: ICSEventData): AttendeeStatus | undefined {
  try {
    const raw = localStorage.getItem(rsvpStorageKey(icsData));
    return (raw as AttendeeStatus | null) ?? undefined;
  } catch {
    return undefined;
  }
}

function saveStoredRsvp(icsData: ICSEventData, status: AttendeeStatus): void {
  try {
    localStorage.setItem(rsvpStorageKey(icsData), status);
  } catch {
    // fail silently
  }
}

// ── Main component ─────────────────────────────────────────────────────────────

/** Source of the ICS content: either a file attachment or raw text from MIME */
type ICSSource =
  | { kind: 'attachment'; attachment: MailAttachment; getAttachmentData: (att: MailAttachment) => Promise<string> }
  | { kind: 'text'; icsText: string };

export interface ICSInvitationCardProps {
  readonly source: ICSSource;
  /** Email address of the mail account that received this message */
  readonly currentUserEmail?: string;
  /** Provider of the mail account (determines default calendar selection) */
  readonly mailProviderType?: 'gmail' | 'ews';
}

const ICS_PREVIEW_ID = '__ics_preview__';

export function ICSInvitationCard({
  source, currentUserEmail, mailProviderType,
}: ICSInvitationCardProps) {
  // ── Data loading ─────────────────────────────────────────────────────────
  const [icsData, setIcsData] = useState<ICSEventData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    const resolve = source.kind === 'text'
      ? Promise.resolve(source.icsText)
      : source.getAttachmentData(source.attachment).then(decodeBase64Utf8);

    resolve
      .then(text => {
        if (cancelled) return;
        const parsed = parseRawICS(text);
        if (parsed) {
          setIcsData(parsed);
        } else {
          setLoadError("Impossible de lire l'invitation.");
        }
      })
      .catch(e => {
        if (!cancelled) setLoadError(String(e));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [source]);

  // ── Calendar + event data ─────────────────────────────────────────────────
  const { calendars: allCalendars } = useCalendars();
  const { getValidToken: getGoogleToken } = useGoogleAuth();
  const { getValidToken: getExchangeToken } = useExchangeAuth();

  // Writable calendars only (ICS feeds are read-only)
  const writableCalendars = useMemo(
    () => allCalendars.filter(c => c.type !== 'ics'),
    [allCalendars],
  );

  // Load events from all providers (they use IndexedDB cache — cheap if already loaded)
  const { events: googleEvents }    = useGoogleEvents(allCalendars);
  const { events: ncEvents }        = useNextcloudEvents(allCalendars);
  const { events: ekEvents }        = useEventKitEvents(allCalendars);
  const { events: ewsEvents }       = useEWSEvents(allCalendars);
  const { events: icsEvents }       = useICSEvents(allCalendars);

  const allEvents = useMemo(
    () => [...googleEvents, ...ncEvents, ...ekEvents, ...ewsEvents, ...icsEvents],
    [googleEvents, ncEvents, ekEvents, ewsEvents, icsEvents],
  );

  // Default calendar: match the mail account email with a calendar account
  const defaultCalendarId = useMemo(() => {
    if (!currentUserEmail || writableCalendars.length === 0) return writableCalendars[0]?.id ?? '';
    const email = currentUserEmail.toLowerCase();

    // Try to match by provider type first
    if (mailProviderType === 'gmail') {
      const match = writableCalendars.find(
        c => c.type === 'google' && c.googleAccountId?.toLowerCase() === email,
      );
      if (match) return match.id;
    }
    if (mailProviderType === 'ews') {
      const match = writableCalendars.find(
        c => c.type === 'exchange' && c.exchangeAccountId?.toLowerCase() === email,
      );
      if (match) return match.id;
    }

    // Fallback: any calendar whose ownerEmail matches
    const byOwner = writableCalendars.find(
      c => c.ownerEmail?.toLowerCase() === email,
    );
    return byOwner?.id ?? writableCalendars[0]?.id ?? '';
  }, [currentUserEmail, mailProviderType, writableCalendars]);

  // Match the ICS event against known calendar events
  const matchedEvent = useMemo(() => {
    if (!icsData) return null;
    return matchEvent(icsData.title, icsData.start, allEvents);
  }, [icsData, allEvents]);

  const [selectedCalId, setSelectedCalId] = useState<string>('');
  const [userChangedCalendar, setUserChangedCalendar] = useState(false);

  // Auto-select the calendar containing the matched event; fall back to the
  // default calendar derived from the mail account. Once the user explicitly
  // picks a calendar we stop overriding their choice.
  useEffect(() => {
    if (userChangedCalendar) return;
    const id = matchedEvent?.calendarId ?? defaultCalendarId;
    if (id) setSelectedCalId(id);
  }, [defaultCalendarId, matchedEvent, userChangedCalendar]);

  const selectedCal = useMemo(
    () => writableCalendars.find(c => c.id === selectedCalId) ?? null,
    [writableCalendars, selectedCalId],
  );

  // Matched event for the selected calendar specifically
  const matchedInSelected = useMemo(() => {
    if (!matchedEvent || !selectedCal) return null;
    return matchedEvent.calendarId === selectedCal.id ? matchedEvent : null;
  }, [matchedEvent, selectedCal]);

  // Current RSVP status — localStorage takes priority over the calendar cache,
  // so the user's last explicit choice is always shown on remount.
  const [storedStatus, setStoredStatus] = useState<AttendeeStatus | undefined>(undefined);
  useEffect(() => {
    if (!icsData) return;
    const persisted = loadStoredRsvp(icsData);
    setStoredStatus(persisted);
  }, [icsData]);

  const isCancelled = icsData?.method === 'CANCEL';
  const currentStatus = storedStatus ?? matchedInSelected?.selfRsvpStatus;
  const canRsvp = !isCancelled && (selectedCal ? supportsRsvp(selectedCal.type) : false);
  const isInCalendar = matchedInSelected !== null;

  // Events for the day timeline
  const targetDate = useMemo(
    () => icsData ? new Date(icsData.start) : new Date(),
    [icsData],
  );

  const dayEvents = useMemo(() => {
    if (!icsData) return [];
    const day = new Date(icsData.start);
    day.setHours(0, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);
    const filtered = allEvents.filter(ev => {
      const s = new Date(ev.start);
      return s >= day && s <= dayEnd;
    });
    // If the event isn't in the calendar yet, inject a virtual pending event
    // so the timeline shows it as a dashed preview.
    if (!matchedInSelected && !icsData.isAllday) {
      const virtualEvent = {
        id: ICS_PREVIEW_ID,
        calendarId: selectedCalId || '',
        title: icsData.title,
        start: icsData.start,
        end: icsData.end,
        isAllday: false,
        category: 'time' as const,
      };
      return [...filtered, virtualEvent];
    }
    return filtered;
  }, [allEvents, icsData, matchedInSelected, selectedCalId]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError]     = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const handleRsvp = useCallback(async (status: 'ACCEPTED' | 'DECLINED' | 'TENTATIVE') => {
    if (!selectedCal || !icsData) return;
    setActionLoading(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      if (isInCalendar && matchedInSelected) {
        await executeRsvp(selectedCal, matchedInSelected, status, getGoogleToken, getExchangeToken);
        saveStoredRsvp(icsData, status);
        setStoredStatus(status);
        // Also patch the IndexedDB cache so the calendar view reflects the change
        const { id: eventId, calendarId } = matchedInSelected;
        if (selectedCal.type === 'exchange') {
          await patchEWSCachedRsvp(calendarId, eventId, status);
        } else if (selectedCal.type === 'google') {
          await patchGoogleCachedRsvp(calendarId, eventId, status);
        } else if (selectedCal.type === 'nextcloud') {
          await patchNextcloudCachedRsvp(calendarId, eventId, status);
        }
        const successMsgMap: Record<string, string> = { ACCEPTED: 'Accepté !', DECLINED: 'Refusé.', TENTATIVE: 'Peut-être.' };
        setActionSuccess(successMsgMap[status] ?? '');
      } else {
        // Event not yet in calendar: create it with the given status
        await addToCalendar(selectedCal, icsData, getGoogleToken, getExchangeToken);
        saveStoredRsvp(icsData, status);
        setStoredStatus(status);
        setActionSuccess('Ajouté au calendrier !');
      }
    } catch (e) {
      setActionError(String(e));
    } finally {
      setActionLoading(false);
    }
  }, [selectedCal, icsData, isInCalendar, matchedInSelected, getGoogleToken, getExchangeToken]);

  const handleAddToCalendar = useCallback(async () => {
    if (!selectedCal || !icsData) return;
    setActionLoading(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await addToCalendar(selectedCal, icsData, getGoogleToken, getExchangeToken);
      setActionSuccess('Ajouté au calendrier !');
    } catch (e) {
      setActionError(String(e));
    } finally {
      setActionLoading(false);
    }
  }, [selectedCal, icsData, getGoogleToken, getExchangeToken]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="ics-card ics-card--loading">
        <Loader2 size={18} className="ics-spinner" />
        <span>Chargement de l'invitation…</span>
      </div>
    );
  }

  if (loadError || !icsData) {
    return (
      <div className="ics-card ics-card--error">
        <CalendarCheck size={18} />
        <span>{loadError ?? "Impossible de lire l'invitation."}</span>
      </div>
    );
  }

  const eventDate = new Date(icsData.start);
  const eventEnd  = new Date(icsData.end);

  const dateStr = eventDate.toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const timeStr = icsData.isAllday
    ? 'Journée entière'
    : `${eventDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} – ${eventEnd.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;

  const organizer = icsData.attendees.find(a => a.isOrganizer);
  const otherAttendees = icsData.attendees.filter(a => !a.isOrganizer);

  return (
    <div className="ics-card">
      {/* ── Left: invitation details ── */}
      <div className="ics-card__main">
        <div className="ics-card__header">
          <CalendarCheck size={18} className="ics-card__icon" />
          <span className="ics-card__label">{isCancelled ? 'Annulation' : 'Invitation'}</span>
        </div>

        <h3 className="ics-card__title">{icsData.title}</h3>

        {isCancelled && (
          <div className="ics-status ics-status--cancelled">Évènement annulé</div>
        )}

        <div className="ics-card__meta">
          <div className="ics-card__meta-row">
            <Clock size={13} className="ics-card__meta-icon" />
            <span>{dateStr} · {timeStr}</span>
          </div>
          {icsData.location && (
            <div className="ics-card__meta-row">
              <MapPin size={13} className="ics-card__meta-icon" />
              <span>{icsData.location}</span>
            </div>
          )}
          {organizer && (
            <div className="ics-card__meta-row">
              <Users size={13} className="ics-card__meta-icon" />
              <span>
                Organisateur : <strong>{organizer.name}</strong>
                {otherAttendees.length > 0 && (
                  <> · {otherAttendees.length} participant{otherAttendees.length > 1 ? 's' : ''}</>
                )}
              </span>
            </div>
          )}
        </div>

        {/* Status badge */}
        {currentStatus && (
          <div className={`ics-status ${statusClass(currentStatus)}`}>
            {statusLabel(currentStatus)}
          </div>
        )}

        {/* Calendar selector — hidden for cancellations */}
        {!isCancelled && writableCalendars.length > 0 && selectedCalId && (
          <div className="ics-card__cal-row">
            <span className="ics-card__cal-label">Calendrier :</span>
            <CalendarSelector
              calendars={writableCalendars}
              selectedId={selectedCalId}
              onChange={id => { setSelectedCalId(id); setUserChangedCalendar(true); }}
            />
          </div>
        )}

        {/* Actions — hidden for cancellations */}
        {!isCancelled && (<div className="ics-card__actions">
          {actionLoading && <Loader2 size={14} className="ics-spinner" />}
          {canRsvp ? (
            <>
              <button
                className={`ics-btn ics-btn--accept${currentStatus === 'ACCEPTED' ? ' ics-btn--active' : ''}`}
                onClick={() => handleRsvp('ACCEPTED')}
                disabled={actionLoading}
                type="button"
              >
                <Check size={13} /> Accepter
              </button>
              <button
                className={`ics-btn ics-btn--tentative${currentStatus === 'TENTATIVE' ? ' ics-btn--active' : ''}`}
                onClick={() => handleRsvp('TENTATIVE')}
                disabled={actionLoading}
                type="button"
              >
                <Minus size={13} /> Peut-être
              </button>
              <button
                className={`ics-btn ics-btn--decline${currentStatus === 'DECLINED' ? ' ics-btn--active' : ''}`}
                onClick={() => handleRsvp('DECLINED')}
                disabled={actionLoading}
                type="button"
              >
                <X size={13} /> Refuser
              </button>
            </>
          ) : isInCalendar ? (
            <span className={`ics-status ${statusClass(currentStatus)}`}>
              {currentStatus ? statusLabel(currentStatus) : 'Dans le calendrier'}
            </span>
          ) : (
            <button
              className="ics-btn ics-btn--add"
              onClick={handleAddToCalendar}
              disabled={actionLoading || actionSuccess !== null}
              type="button"
            >
              <Plus size={13} /> Ajouter au calendrier
            </button>
          )}
        </div>)}

        {actionError   && <p className="ics-card__feedback ics-card__feedback--error">{actionError}</p>}
        {actionSuccess && <p className="ics-card__feedback ics-card__feedback--success">{actionSuccess}</p>}
      </div>

      {/* ── Right: day timeline ── */}
      <DayEventsTimeline
        events={dayEvents}
        calendars={allCalendars}
        targetDate={targetDate}
        highlightedEventId={matchedInSelected?.id ?? (!icsData?.isAllday ? ICS_PREVIEW_ID : undefined)}
      />
    </div>
  );
}
