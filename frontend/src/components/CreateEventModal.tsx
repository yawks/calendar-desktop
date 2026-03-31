import { useState, FormEvent, useEffect, useRef, useMemo } from 'react';
import { X, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CalendarConfig, CalendarEvent, CreateEventPayload } from '../types';
import AttendeeInput from './AttendeeInput';
import FreeBusyGrid, { FreeBusyRow } from './FreeBusyGrid';
import { queryFreeBusy, FreeBusyResult } from '../utils/googleCalendarApi';
import { useTags } from '../store/TagStore';

interface Props {
  readonly initialStart: string;
  readonly initialEnd: string;
  readonly writableCalendars: CalendarConfig[];
  readonly allEvents: CalendarEvent[];
  /** When provided, the modal operates in edit mode */
  readonly editEvent?: CalendarEvent;
  readonly onSubmit: (payload: CreateEventPayload) => Promise<void>;
  readonly onClose: () => void;
  /** Required to query freebusy for Google calendars */
  readonly getValidToken?: (accountId: string) => Promise<string | null>;
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toDateLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function CreateEventModal({ initialStart, initialEnd, writableCalendars, allEvents, editEvent, onSubmit, onClose, getValidToken }: Props) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isEditing = editEvent != null;
  const { tags, eventTags } = useTags();

  const editEventTagKey = editEvent ? editEvent.seriesId ?? editEvent.sourceId : undefined;
  const initialTagId = editEventTagKey ? eventTags[editEventTagKey] : undefined;

  const [title, setTitle] = useState(editEvent?.title ?? '');
  const [tagId, setTagId] = useState(initialTagId ?? '');
  const [isAllday, setIsAllday] = useState(editEvent?.isAllday ?? false);
  const [start, setStart] = useState(() => toDatetimeLocal(editEvent?.start ?? initialStart));
  const [end, setEnd] = useState(() => toDatetimeLocal(editEvent?.end ?? initialEnd));
  const [startDate, setStartDate] = useState(() => toDateLocal(editEvent?.start ?? initialStart));
  const [endDate, setEndDate] = useState(() => toDateLocal(editEvent?.end ?? initialEnd));
  const [location, setLocation] = useState(editEvent?.location ?? '');
  const [description, setDescription] = useState(editEvent?.description ?? '');
  const [calendarId, setCalendarId] = useState(
    editEvent?.calendarId ?? writableCalendars[0]?.id ?? ''
  );
  const [attendees, setAttendees] = useState<Array<{ email: string; name?: string }>>(
    editEvent?.attendees?.map((a) => ({ email: a.email, name: a.name })) ?? []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowTagDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // FreeBusy state
  const [freeBusyData, setFreeBusyData] = useState<Record<string, FreeBusyResult>>({});
  const [freeBusyLoading, setFreeBusyLoading] = useState(false);

  const selectedCalendar = writableCalendars.find((c) => c.id === calendarId);
  const headerColor = selectedCalendar?.color ?? '#888';

  // Show freebusy only for Google calendars with at least one attendee and a specific time
  const isGoogleCalendar = selectedCalendar?.type === 'google';
  const showFreeBusy = isGoogleCalendar && !isAllday && attendees.length > 0;

  // "Me" busy slots — computed locally from allEvents so ALL synced calendars are included
  // (Google, EventKit, ICS, Nextcloud, etc.)
  const selfBusySlots = useMemo((): { busy: Array<{ start: Date; end: Date }>; tentative: Array<{ start: Date; end: Date }> } => {
    const eventDate = new Date(start);
    if (Number.isNaN(eventDate.getTime())) return { busy: [], tentative: [] };

    const dayStart = new Date(eventDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(eventDate);
    dayEnd.setHours(23, 59, 59, 999);

    const busy: Array<{ start: Date; end: Date }> = [];
    const tentative: Array<{ start: Date; end: Date }> = [];

    for (const ev of allEvents) {
      if (ev.isAllday) continue;
      if (ev.isDeclined) continue;

      const evStart = new Date(ev.start);
      const evEnd = new Date(ev.end);
      if (Number.isNaN(evStart.getTime()) || Number.isNaN(evEnd.getTime())) continue;
      if (evStart >= dayEnd || evEnd <= dayStart) continue;

      const slot = { start: evStart, end: evEnd };
      if (ev.isUnaccepted) {
        tentative.push(slot);
      } else {
        busy.push(slot);
      }
    }

    return { busy, tentative };
  }, [allEvents, start]);

  // Query freebusy for attendees only (self is covered by allEvents above)
  useEffect(() => {
    if (!showFreeBusy || !selectedCalendar?.googleAccountId || !getValidToken || attendees.length === 0) return;

    const timer = setTimeout(async () => {
      const startDate = new Date(start);
      if (Number.isNaN(startDate.getTime())) return;

      const dayStart = new Date(startDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(startDate);
      dayEnd.setHours(23, 59, 59, 999);

      // Only query attendees — never the owner (self uses allEvents)
      const ownerEmail = selectedCalendar.ownerEmail;
      const emails = attendees
        .map((a) => a.email)
        .filter((e) => e !== ownerEmail);

      if (emails.length === 0) return;

      setFreeBusyLoading(true);
      try {
        const token = await getValidToken(selectedCalendar.googleAccountId!);
        if (!token) return;
        const data = await queryFreeBusy(token, emails, dayStart, dayEnd);
        setFreeBusyData(data);
      } catch {
        // Silently fail — freebusy is optional
      } finally {
        setFreeBusyLoading(false);
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [showFreeBusy, attendees, start, selectedCalendar?.googleAccountId, selectedCalendar?.ownerEmail, getValidToken]);

  // Reset freebusy data when calendar changes to non-Google
  useEffect(() => {
    if (!isGoogleCalendar) setFreeBusyData({});
  }, [isGoogleCalendar]);

  // Compute display window (07:00–21:00 on the event day, clamped to include the event)
  const freeBusyWindow = useMemo(() => {
    const d = new Date(start);
    if (Number.isNaN(d.getTime())) return null;
    const ws = new Date(d);
    ws.setHours(7, 0, 0, 0);
    const we = new Date(d);
    we.setHours(21, 0, 0, 0);
    // Expand window if event falls outside
    const eventStart = new Date(start);
    const eventEnd = new Date(end);
    if (!Number.isNaN(eventStart.getTime()) && eventStart < ws) ws.setTime(eventStart.getTime());
    if (!Number.isNaN(eventEnd.getTime()) && eventEnd > we) we.setTime(eventEnd.getTime());
    return { windowStart: ws, windowEnd: we };
  }, [start, end]);

  const freeBusyRows = useMemo((): FreeBusyRow[] => {
    const ownerEmail = selectedCalendar?.ownerEmail;
    const rows: FreeBusyRow[] = [];

    // Self row — always shown, computed from allEvents (all synced calendars)
    rows.push({
      email: ownerEmail ?? 'self',
      label: t('freeBusy.me'),
      busy: selfBusySlots.busy,
      tentative: selfBusySlots.tentative,
      unavailable: false,
      isSelf: true,
    });

    // Attendee rows — from Google freebusy API
    for (const attendee of attendees) {
      if (attendee.email === ownerEmail) continue;
      const data = freeBusyData[attendee.email];
      if (data) {
        rows.push({
          email: attendee.email,
          label: attendee.name ?? attendee.email,
          busy: data.busy,
          tentative: [],
          unavailable: data.unavailable,
          isSelf: false,
        });
      }
    }

    return rows;
  }, [selfBusySlots.busy, selfBusySlots.tentative, freeBusyData, attendees, selectedCalendar?.ownerEmail, t]);

  function handleSelectTime(newStart: Date) {
    const currentStart = new Date(start);
    const currentEnd = new Date(end);
    const duration = Number.isNaN(currentEnd.getTime()) || Number.isNaN(currentStart.getTime())
      ? 60 * 60 * 1000
      : currentEnd.getTime() - currentStart.getTime();
    const newEnd = new Date(newStart.getTime() + duration);
    setStart(toDatetimeLocal(newStart.toISOString()));
    setEnd(toDatetimeLocal(newEnd.toISOString()));
  }

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onCancel = (e: Event) => { e.preventDefault(); onClose(); };
    const onBackdropClick = (e: MouseEvent) => {
      const rect = dialog.getBoundingClientRect();
      const outside =
        e.clientX < rect.left || e.clientX > rect.right ||
        e.clientY < rect.top  || e.clientY > rect.bottom;
      if (outside) onClose();
    };
    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('click', onBackdropClick);
    return () => {
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('click', onBackdropClick);
    };
  }, [onClose]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !calendarId) return;

    const startIso = isAllday ? startDate : new Date(start).toISOString();
    const endIso   = isAllday ? endDate   : new Date(end).toISOString();

    setSaving(true);
    setError('');
    try {
      const payload: CreateEventPayload = {
        title: title || t('createEvent.untitledEvent'),
        start: startIso,
        end: endIso,
        isAllday,
        location,
        description,
        calendarId,
        attendees,
        tagId: tagId || null,
      };
      await onSubmit(payload);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('createEvent.saveError'));
      setSaving(false);
    }
  };

  const googleCals = writableCalendars.filter((c) => c.type === 'google');
  const ekCals = writableCalendars.filter((c) => c.type === 'eventkit');
  const nextcloudCals = writableCalendars.filter((c) => c.type === 'nextcloud');

  let submitLabel: string;
  if (saving) {
    submitLabel = isEditing ? t('createEvent.savingEdit') : t('createEvent.savingNew');
  } else {
    submitLabel = isEditing ? t('createEvent.save') : t('createEvent.create');
  }

  return (
    <dialog ref={dialogRef} className="modal-dialog modal-dialog--form">
      <div className="modal">
        <div className="modal-header" style={{ background: headerColor }}>
          <span className="modal-title">{isEditing ? t('createEvent.titleEdit') : t('createEvent.titleNew')}</span>
          <button className="btn-icon modal-close" onClick={onClose} aria-label={t('createEvent.close')}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body modal-form">
          <div className="form-row">
            <label htmlFor="ev-title">{t('createEvent.titleLabel')}</label>
            <input
              id="ev-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('createEvent.titlePlaceholder')}
              autoFocus
              required
            />
          </div>

          <div className="form-row">
            <label htmlFor="ev-allday" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                id="ev-allday"
                type="checkbox"
                checked={isAllday}
                onChange={(e) => setIsAllday(e.target.checked)}
              />
              <span>{t('createEvent.allDay')}</span>
            </label>
          </div>

          {isAllday ? (
            <>
              <div className="form-row">
                <label htmlFor="ev-start-date">{t('createEvent.start')}</label>
                <input id="ev-start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
              </div>
              <div className="form-row">
                <label htmlFor="ev-end-date">{t('createEvent.end')}</label>
                <input id="ev-end-date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
              </div>
            </>
          ) : (
            <>
              <div className="form-row">
                <label htmlFor="ev-start">{t('createEvent.start')}</label>
                <input id="ev-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
              </div>
              <div className="form-row">
                <label htmlFor="ev-end">{t('createEvent.end')}</label>
                <input id="ev-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
              </div>
            </>
          )}

          <div className="form-row">
            <label htmlFor="ev-calendar">{t('createEvent.calendar')}</label>
            <select
              id="ev-calendar"
              value={calendarId}
              onChange={(e) => setCalendarId(e.target.value)}
              disabled={isEditing}
              required
            >
              {ekCals.length > 0 || googleCals.length > 0 || nextcloudCals.length > 0 ? (
                <>
                  {ekCals.length > 0 && (
                    <optgroup label="macOS">
                      {ekCals.map((cal) => (
                        <option key={cal.id} value={cal.id}>{cal.name}</option>
                      ))}
                    </optgroup>
                  )}
                  {googleCals.length > 0 && (
                    <optgroup label="Google Agenda">
                      {googleCals.map((cal) => (
                        <option key={cal.id} value={cal.id}>{cal.name}</option>
                      ))}
                    </optgroup>
                  )}
                  {nextcloudCals.length > 0 && (
                    <optgroup label={t('config.nextcloudCalDAV')}>
                      {nextcloudCals.map((cal) => (
                        <option key={cal.id} value={cal.id}>{cal.name}</option>
                      ))}
                    </optgroup>
                  )}
                </>
              ) : (
                writableCalendars.map((cal) => (
                  <option key={cal.id} value={cal.id}>{cal.name}</option>
                ))
              )}
            </select>
          </div>

          {tags.length > 0 && (
            <div className="form-row">
              <label htmlFor="ev-tag">{t('createEvent.tag', 'Tag / Insight')}</label>
              <div ref={dropdownRef} style={{ position: 'relative', flex: 1 }}>
                <div
                  className="custom-select-trigger"
                  onClick={() => setShowTagDropdown((p) => !p)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '8px 12px', border: '1px solid var(--border)',
                    borderRadius: '4px', cursor: 'pointer', background: 'var(--bg-input)'
                  }}
                >
                  <div style={{
                    width: '12px', height: '12px', borderRadius: '50%',
                    backgroundColor: tagId ? tags.find(t => t.id === tagId)?.color : 'transparent',
                    border: tagId ? 'none' : '1px solid var(--border)'
                  }} />
                  <span style={{ flex: 1 }}>
                    {tagId ? tags.find(t => t.id === tagId)?.name : t('createEvent.noTag', 'Aucun tag')}
                  </span>
                  <ChevronDown size={14} />
                </div>
                {showTagDropdown && (
                  <div className="custom-select-dropdown" style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                    background: 'var(--bg-panel)', border: '1px solid var(--border)',
                    borderRadius: '4px', marginTop: '4px', maxHeight: '200px',
                    overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                  }}>
                    <div
                      role="button"
                      tabIndex={0}
                      className="custom-select-option"
                      onClick={() => { setTagId(''); setShowTagDropdown(false); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { setTagId(''); setShowTagDropdown(false); } }}
                      style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                      <div style={{ width: '12px', height: '12px', borderRadius: '50%', border: '1px solid var(--border)' }} />
                      {t('createEvent.noTag', 'Aucun tag')}
                    </div>
                    {tags.map((tag) => (
                      <div
                        role="button"
                        tabIndex={0}
                        key={tag.id}
                        className="custom-select-option"
                        onClick={() => { setTagId(tag.id); setShowTagDropdown(false); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { setTagId(tag.id); setShowTagDropdown(false); } }}
                        style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
                      >
                        <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: tag.color }} />
                        {tag.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="form-row">
            <label htmlFor="ev-attendees">
              {t('createEvent.attendees')} <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>{t('createEvent.optional')}</span>
            </label>
            <AttendeeInput value={attendees} onChange={setAttendees} allEvents={allEvents} />
          </div>

          {/* Free/busy grid — only for Google calendars with attendees */}
          {showFreeBusy && freeBusyWindow && (
            <div className="form-row form-row--freebusy">
              <FreeBusyGrid
                rows={freeBusyRows}
                windowStart={freeBusyWindow.windowStart}
                windowEnd={freeBusyWindow.windowEnd}
                selectedStart={new Date(start)}
                selectedEnd={new Date(end)}
                loading={freeBusyLoading}
                onSelectTime={handleSelectTime}
              />
            </div>
          )}

          <div className="form-row">
            <label htmlFor="ev-location">
              {t('createEvent.location')} <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>{t('createEvent.optional')}</span>
            </label>
            <input
              id="ev-location"
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder={t('createEvent.locationPlaceholder')}
            />
          </div>

          <div className="form-row">
            <label htmlFor="ev-desc">
              {t('createEvent.description')} <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>{t('createEvent.optional')}</span>
            </label>
            <textarea
              id="ev-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          {error && (
            <div style={{ color: 'var(--color-error, #d93025)', fontSize: 13 }}>{error}</div>
          )}

          <div className="config-edit-actions">
            <button type="submit" className="btn-primary" disabled={saving || !title.trim()}>
              {submitLabel}
            </button>
            <button type="button" className="btn-cancel" onClick={onClose}>{t('createEvent.cancel')}</button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
