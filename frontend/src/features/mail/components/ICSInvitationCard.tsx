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
import { CalendarConfig, CalendarEvent, AttendeeStatus } from '../../../types';
import { MailAttachment } from '../types';
import { useCalendars } from '../../../store/CalendarStore';
import { useGoogleAuth } from '../../../store/GoogleAuthStore';
import { useExchangeAuth } from '../../../store/ExchangeAuthStore';
import { useGoogleEvents } from '../../../hooks/useGoogleEvents';
import { useNextcloudEvents } from '../../../hooks/useNextcloudEvents';
import { useEventKitEvents } from '../../../hooks/useEventKitEvents';
import { useEWSEvents } from '../../../hooks/useEWSEvents';
import { useICSEvents } from '../../../hooks/useICSEvents';
import { DayEventsTimeline } from '../../../components/DayEventsTimeline';
import { respondToGoogleEvent, createEvent as createGoogleEvent } from '../../../utils/googleCalendarApi';
import { respondToNextcloudEvent, createNextcloudEvent } from '../../../utils/nextcloudCalendarApi';
import { patchCachedEventRsvp } from '../../../utils/eventCache';
import './ICSInvitationCard.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function patchEWSCachedRsvp(calId: string, eventId: string, status: AttendeeStatus) {
  await patchCachedEventRsvp(`ews-events:ews1:${calId}`, eventId, status);
}

async function patchGoogleCachedRsvp(calId: string, eventId: string, status: AttendeeStatus) {
  await patchCachedEventRsvp(`google-events:google1:${calId}`, eventId, status);
}

async function patchNextcloudCachedRsvp(calId: string, eventId: string, status: AttendeeStatus) {
    await patchCachedEventRsvp(`nextcloud-events:nextcloud1:${calId}`, eventId, status);
}

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

/** Match an ICS event against an array of CalendarEvent based on title, date and time. */
function matchEvent(title: string | undefined, start: string | undefined, events: CalendarEvent[]): CalendarEvent | null {
  const nt = normTitle(title || '');
  return events.find(e => normTitle(e.title) === nt && dateAreSimilar(e.start, start || '')) ?? null;
}

function supportsRsvp(type: CalendarConfig['type']): boolean {
  return ['google', 'exchange', 'nextcloud'].includes(type as string);
}

function statusClass(s: AttendeeStatus): string {
  if (s === 'ACCEPTED') return 'ics-status--accepted';
  if (s === 'DECLINED') return 'ics-status--declined';
  if (s === 'TENTATIVE') return 'ics-status--tentative';
  return '';
}

function statusLabel(s: AttendeeStatus): string {
  if (s === 'ACCEPTED') return 'Accepté';
  if (s === 'DECLINED') return 'Refusé';
  if (s === 'TENTATIVE') return 'Peut-être';
  return '';
}

// ── Persistence ──────────────────────────────────────────────────────────────

function getRsvpKey(ics: ICSData): string {
  return `ics-rsvp:${ics.title}:${ics.start}`;
}

function saveStoredRsvp(ics: ICSData, status: AttendeeStatus) {
  localStorage.setItem(getRsvpKey(ics), status);
}

function loadStoredRsvp(ics: ICSData): AttendeeStatus | undefined {
  return localStorage.getItem(getRsvpKey(ics)) as AttendeeStatus || undefined;
}

// ── ICS Parsing ──────────────────────────────────────────────────────────────

interface ICSData {
  title: string;
  start: string;
  end: string;
  isAllday: boolean;
  location?: string;
  description?: string;
  attendees: Array<{ name: string; email: string; isOrganizer: boolean }>;
}

async function parseICSAttachment(att: MailAttachment, getAttachmentData: (att: MailAttachment) => Promise<string>): Promise<ICSData> {
  const b64 = await getAttachmentData(att);
  const icsText = decodeBase64Utf8(b64);
  return parseICSText(icsText);
}

function parseICSText(icsText: string): ICSData {
  const jcal = ICAL.parse(icsText);
  const comp = new ICAL.Component(jcal);
  const vevent = comp.getFirstSubcomponent('vevent');
  if (!vevent) throw new Error("Format d'invitation invalide.");

  const event = new ICAL.Event(vevent);
  const attendees = vevent.getAllProperties('attendee').map((p: any) => {
    const cn = p.getParameter('cn');
    const email = p.getFirstValue().replace('mailto:', '');
    const role = p.getParameter('role');
    return { name: cn || email, email, isOrganizer: role?.toLowerCase() === 'organizer' };
  });

  return {
    title: event.summary,
    start: event.startDate.toString(),
    end: event.endDate.toString(),
    isAllday: event.startDate.isDate,
    location: event.location,
    description: event.description,
    attendees,
  };
}

// ── Calendar Operations ─────────────────────────────────────────────────────

async function executeRsvp(
  cal: CalendarConfig,
  event: CalendarEvent,
  status: 'ACCEPTED' | 'DECLINED' | 'TENTATIVE',
  getGoogleToken: (id: string) => Promise<string | null>,
  getExchangeToken: (id: string) => Promise<string | null>,
  currentUserEmail?: string,
) {
  if (cal.type === 'google' && cal.googleAccountId) {
    const token = await getGoogleToken(cal.googleAccountId);
    if (!token) throw new Error('Authentification Google expirée.');
    await respondToGoogleEvent(token, cal, event.sourceId || event.id, currentUserEmail || '', status);
  } else if (cal.type === 'exchange') {
    void getExchangeToken;
    // const token = await getExchangeToken(cal.exchangeAccountId!);
    // if (!token) throw new Error('Authentification Exchange expirée.');
    // await respondToExchangeEvent(token, event.id, status);
  } else if (cal.type === 'nextcloud') {
    await respondToNextcloudEvent(cal, event.sourceId || event.id, currentUserEmail || '', status);
  }
}

async function addToCalendar(
  cal: CalendarConfig,
  ics: ICSData,
  getGoogleToken: (id: string) => Promise<string | null>,
  getExchangeToken: (id: string) => Promise<string | null>,
) {
  if (cal.type === 'google' && cal.googleAccountId) {
    const token = await getGoogleToken(cal.googleAccountId);
    if (!token) throw new Error('Authentification Google expirée.');
    await createGoogleEvent(token, cal, {
      title: ics.title,
      start: ics.start,
      end: ics.end,
      isAllday: ics.isAllday,
      location: ics.location,
      description: ics.description,
      calendarId: cal.id,
    });
  } else if (cal.type === 'nextcloud') {
    void getExchangeToken;
    await createNextcloudEvent(cal as any, {
      calendarId: cal.id,
      title: ics.title,
      start: ics.start,
      end: ics.end,
      isAllday: ics.isAllday,
      location: ics.location,
      description: ics.description,
    });
  }
}

// ── Components ──────────────────────────────────────────────────────────────

function CalendarSelector({ calendars, selectedId, onChange }: { calendars: CalendarConfig[], selectedId: string, onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = calendars.find(c => c.id === selectedId);

  return (
    <div className="ics-cal-selector">
      <button className="ics-cal-selector__btn" onClick={() => setOpen(!open)} type="button">
        <div className="ics-cal-selector__dot" style={{ backgroundColor: selected?.color }} />
        <span className="ics-cal-selector__name">{selected?.name}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="ics-cal-selector__dropdown">
          {calendars.map(c => (
            <button key={c.id} className="ics-cal-selector__option" onClick={() => { onChange(c.id); setOpen(false); }} type="button">
              <div className="ics-cal-selector__dot" style={{ backgroundColor: c.color }} />
              <span>{c.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface ICSInvitationCardProps {
  readonly attachment?: MailAttachment;
  readonly source?: { kind: 'attachment', attachment: MailAttachment, getAttachmentData: (att: MailAttachment) => Promise<string> }
                  | { kind: 'text', icsText: string };
  readonly currentUserEmail?: string;
  readonly mailProviderType?: 'gmail' | 'ews';
}

export function ICSInvitationCard({ attachment, source, currentUserEmail, mailProviderType }: ICSInvitationCardProps) {
  const [icsData, setIcsData]     = useState<ICSData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load all events to match against
  const { calendars: allCalendars } = useCalendars();
  const { events: gEvents }         = useGoogleEvents(allCalendars);
  const { events: nEvents }         = useNextcloudEvents(allCalendars);
  const { events: eEvents }         = useEventKitEvents(allCalendars);
  const { events: wEvents }         = useEWSEvents(allCalendars);
  const { events: iEvents }         = useICSEvents(allCalendars);

  const allEvents = useMemo(() => [
    ...gEvents, ...nEvents, ...eEvents, ...wEvents, ...iEvents,
  ], [gEvents, nEvents, eEvents, wEvents, iEvents]);

  const { getValidToken: getGoogleToken }   = useGoogleAuth();
  const { getValidToken: getExchangeToken } = useExchangeAuth();

  // Parse ICS on mount
  useEffect(() => {
    async function load() {
      try {
        if (source?.kind === 'attachment') {
          const data = await parseICSAttachment(source.attachment, source.getAttachmentData);
          setIcsData(data);
        } else if (source?.kind === 'text') {
          setIcsData(parseICSText(source.icsText));
        } else if (attachment) {
          // Legacy support (prop attachment) - but we don't have getAttachmentData here
          setLoadError("Impossible de lire l'attachement.");
        }
      } catch (e) {
        setLoadError(String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [attachment, source]);

  // Logic to find the best calendar to RSVP into
  const writableCalendars = useMemo(
    () => allCalendars.filter(c => !(c as any).readOnly && supportsRsvp(c.type)),
    [allCalendars],
  );

  const defaultCalendarId = useMemo(() => {
    if (!writableCalendars.length) return '';
    const email = currentUserEmail?.toLowerCase();
    if (!email) return writableCalendars[0].id;

    if (mailProviderType === 'gmail') {
      const match = writableCalendars.find(
        c => c.type === 'google' && c.googleAccountId?.toLowerCase() === email,
      );
      if (match) return match.id;
    }
    if (mailProviderType === 'ews') {
      const match = writableCalendars.find(
        c => c.type === 'exchange' && (c as any).exchangeAccountId?.toLowerCase() === email,
      );
      if (match) return match.id;
    }

    // Fallback: any calendar whose ownerEmail matches
    const byOwner = writableCalendars.find(
      c => (c as any).ownerEmail?.toLowerCase() === email,
    );
    return byOwner?.id ?? writableCalendars[0]?.id ?? '';
  }, [currentUserEmail, mailProviderType, writableCalendars]);

  const [selectedCalId, setSelectedCalId] = useState<string>('');

  // Initialise once default is known
  useEffect(() => {
    if (defaultCalendarId && !selectedCalId) setSelectedCalId(defaultCalendarId);
  }, [defaultCalendarId, selectedCalId]);

  const selectedCal = useMemo(
    () => writableCalendars.find(c => c.id === selectedCalId) ?? null,
    [writableCalendars, selectedCalId],
  );

  // Match the ICS event against known calendar events
  const matchedEvent = useMemo(() => {
    if (!icsData) return null;
    return matchEvent(icsData.title, icsData.start || "", allEvents);
  }, [icsData, allEvents]);

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

  const currentStatus = storedStatus ?? matchedInSelected?.selfRsvpStatus;
  const canRsvp = selectedCal ? supportsRsvp(selectedCal.type) : false;
  const isInCalendar = matchedInSelected !== null;

  // Events for the day timeline
  const targetDate = useMemo(
    () => icsData ? new Date(icsData.start || "") : new Date(),
    [icsData],
  );

  const dayEvents = useMemo(() => {
    if (!icsData) return [];
    const day = new Date(icsData.start || "");
    day.setHours(0, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);
    return allEvents.filter(ev => {
      const s = new Date(ev.start);
      return s >= day && s <= dayEnd;
    });
  }, [allEvents, icsData]);

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
        await executeRsvp(selectedCal, matchedInSelected, status, getGoogleToken, getExchangeToken, currentUserEmail);
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
  }, [selectedCal, icsData, isInCalendar, matchedInSelected, getGoogleToken, getExchangeToken, currentUserEmail]);

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

  const eventDate = new Date(icsData.start || "");
  const eventEnd  = new Date(icsData.end || "");

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
          <span className="ics-card__label">Invitation</span>
        </div>

        <h3 className="ics-card__title">{icsData.title}</h3>

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

        {/* Calendar selector */}
        {writableCalendars.length > 0 && selectedCalId && (
          <div className="ics-card__cal-row">
            <span className="ics-card__cal-label">Calendrier :</span>
            <CalendarSelector
              calendars={writableCalendars}
              selectedId={selectedCalId}
              onChange={setSelectedCalId}
            />
          </div>
        )}

        {/* Actions */}
        <div className="ics-card__actions">
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
        </div>

        {actionError   && <p className="ics-card__feedback ics-card__feedback--error">{actionError}</p>}
        {actionSuccess && <p className="ics-card__feedback ics-card__feedback--success">{actionSuccess}</p>}
      </div>

      {/* ── Right: day timeline ── */}
      <DayEventsTimeline
        events={dayEvents}
        calendars={allCalendars}
        date={targetDate}
        highlightedEventId={matchedInSelected?.id}
      />
    </div>
  );
}
