import { CalendarConfig, CalendarEvent, CreateEventPayload } from '../types';
import { ChevronDown, X } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { FreeBusyResult, queryFreeBusy } from '../utils/googleCalendarApi';
import AttendeeInput from './AttendeeInput';
import { getDefaultCalendarId } from '../store/defaultCalendarStore';
import { queryEWSFreeBusy } from '../utils/ewsApi';
import { useTags } from '../store/TagStore';
import { useTranslation } from 'react-i18next';
import { FreeBusySection } from './event/FreeBusySection';

interface Props {
  readonly initialStart: string;
  readonly initialEnd: string;
  readonly writableCalendars: CalendarConfig[];
  readonly allEvents: CalendarEvent[];
  readonly editEvent?: CalendarEvent;
  readonly onSubmit: (payload: CreateEventPayload) => Promise<void>;
  readonly onClose: () => void;
  readonly getValidToken?: (accountId: string) => Promise<string | null>;
  readonly getExchangeRefreshToken?: (accountId: string) => string | null;
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

export default function CreateEventModal({ initialStart, initialEnd, writableCalendars, allEvents, editEvent, onSubmit, onClose, getValidToken, getExchangeRefreshToken }: Props) {
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
  const [calendarId, setCalendarId] = useState(() => {
    if (editEvent?.calendarId) return editEvent.calendarId;
    const defaultId = getDefaultCalendarId();
    if (defaultId && writableCalendars.some((c) => c.id === defaultId)) return defaultId;
    return writableCalendars[0]?.id ?? '';
  });
  const [attendees, setAttendees] = useState<Array<{ email: string; name?: string }>>(
    editEvent?.attendees?.map((a) => ({ email: a.email, name: a.name })) ?? []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setShowTagDropdown(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const [freeBusyData, setFreeBusyData] = useState<Record<string, FreeBusyResult>>({});
  const [freeBusyLoading, setFreeBusyLoading] = useState(false);

  const selectedCalendar = writableCalendars.find((c) => c.id === calendarId);
  const showFreeBusy = (selectedCalendar?.type === 'google' || selectedCalendar?.type === 'exchange') && !isAllday && attendees.length > 0;

  const selfBusySlots = useMemo(() => {
    const eventDate = new Date(start);
    if (Number.isNaN(eventDate.getTime())) return { busy: [], tentative: [] };
    const dayStart = new Date(eventDate); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(eventDate); dayEnd.setHours(23, 59, 59, 999);
    const busy: Array<{ start: Date; end: Date }> = [];
    const tentative: Array<{ start: Date; end: Date }> = [];
    for (const ev of allEvents) {
      if (ev.isAllday || ev.isDeclined) continue;
      const evStart = new Date(ev.start);
      const evEnd = new Date(ev.end);
      if (Number.isNaN(evStart.getTime()) || Number.isNaN(evEnd.getTime()) || evStart >= dayEnd || evEnd <= dayStart) continue;
      if (ev.isUnaccepted) tentative.push({ start: evStart, end: evEnd });
      else busy.push({ start: evStart, end: evEnd });
    }
    return { busy, tentative };
  }, [allEvents, start]);

  useEffect(() => {
    if (!showFreeBusy || attendees.length === 0) return;
    const timer = setTimeout(async () => {
      const startDate = new Date(start);
      if (Number.isNaN(startDate.getTime())) return;
      const dayStart = new Date(startDate); dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(startDate); dayEnd.setHours(23, 59, 59, 999);
      const emails = attendees.map((a) => a.email).filter((e) => e !== selectedCalendar?.ownerEmail);
      if (emails.length === 0) return;
      setFreeBusyLoading(true);
      try {
        if (selectedCalendar?.type === 'google' && selectedCalendar?.googleAccountId && getValidToken) {
          const token = await getValidToken(selectedCalendar.googleAccountId);
          if (token) setFreeBusyData(await queryFreeBusy(token, emails, dayStart, dayEnd));
        } else if (selectedCalendar?.type === 'exchange' && selectedCalendar?.exchangeAccountId && getExchangeRefreshToken) {
          const refreshToken = getExchangeRefreshToken(selectedCalendar.exchangeAccountId);
          if (refreshToken) setFreeBusyData(await queryEWSFreeBusy(refreshToken, emails, dayStart, dayEnd, selectedCalendar?.ownerEmail));
        }
      } catch (err) { console.error('[FreeBusy] error:', err); } finally { setFreeBusyLoading(false); }
    }, 600);
    return () => clearTimeout(timer);
  }, [showFreeBusy, attendees, start, selectedCalendar, getValidToken, getExchangeRefreshToken]);

  useEffect(() => { if (selectedCalendar?.type !== 'google' && selectedCalendar?.type !== 'exchange') setFreeBusyData({}); }, [selectedCalendar]);

  function handleSelectTime(newStart: Date) {
    const currentStart = new Date(start);
    const currentEnd = new Date(end);
    const duration = Number.isNaN(currentEnd.getTime()) || Number.isNaN(currentStart.getTime()) ? 3600000 : currentEnd.getTime() - currentStart.getTime();
    setStart(toDatetimeLocal(newStart.toISOString()));
    setEnd(toDatetimeLocal(new Date(newStart.getTime() + duration).toISOString()));
  }

  useEffect(() => { dialogRef.current?.showModal(); }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onCancel = (e: Event) => { e.preventDefault(); onClose(); };
    const onBackdropClick = (e: MouseEvent) => {
      const rect = dialog.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) onClose();
    };
    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('click', onBackdropClick);
    return () => { dialog.removeEventListener('cancel', onCancel); dialog.removeEventListener('click', onBackdropClick); };
  }, [onClose]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !calendarId) return;
    setSaving(true);
    setError('');
    try {
      await onSubmit({
        title: title || t('createEvent.untitledEvent'),
        start: isAllday ? startDate : new Date(start).toISOString(),
        end: isAllday ? endDate : new Date(end).toISOString(),
        isAllday, location, description, calendarId, attendees, tagId: tagId || null,
      });
      onClose();
    } catch (err) { setError(err instanceof Error ? err.message : t('createEvent.saveError')); setSaving(false); }
  };

  const submitLabel = saving ? (isEditing ? t('createEvent.savingEdit') : t('createEvent.savingNew')) : (isEditing ? t('createEvent.save') : t('createEvent.create'));

  return (
    <dialog ref={dialogRef} className="modal-dialog modal-dialog--form">
      <div className="modal">
        <div className="modal-header" style={{ background: selectedCalendar?.color || '#888' }}>
          <span className="modal-title">{isEditing ? t('createEvent.titleEdit') : t('createEvent.titleNew')}</span>
          <button className="btn-icon modal-close" onClick={onClose} aria-label={t('createEvent.close')}><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body modal-form">
          <div className="form-row">
            <label htmlFor="ev-title">{t('createEvent.titleLabel')}</label>
            <input id="ev-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('createEvent.titlePlaceholder')} autoFocus required />
          </div>

          <div className="form-row">
            <label htmlFor="ev-allday" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input id="ev-allday" type="checkbox" checked={isAllday} onChange={(e) => setIsAllday(e.target.checked)} />
              <span>{t('createEvent.allDay')}</span>
            </label>
          </div>

          <div className="form-row">
            <label htmlFor="ev-start">{t('createEvent.start')}</label>
            <input id="ev-start" type={isAllday ? 'date' : 'datetime-local'} value={isAllday ? startDate : start} onChange={(e) => isAllday ? setStartDate(e.target.value) : setStart(e.target.value)} required />
          </div>
          <div className="form-row">
            <label htmlFor="ev-end">{t('createEvent.end')}</label>
            <input id="ev-end" type={isAllday ? 'date' : 'endDate'} value={isAllday ? endDate : end} onChange={(e) => isAllday ? setEndDate(e.target.value) : setEnd(e.target.value)} required />
          </div>

          <div className="form-row">
            <label htmlFor="ev-calendar">{t('createEvent.calendar')}</label>
            <select id="ev-calendar" value={calendarId} onChange={(e) => setCalendarId(e.target.value)} disabled={isEditing} required>
              {writableCalendars.map((cal) => (
                <option key={cal.id} value={cal.id}>{cal.name}</option>
              ))}
            </select>
          </div>

          {tags.length > 0 && (
            <div className="form-row">
              <label htmlFor="ev-tag">{t('createEvent.tag', 'Tag / Insight')}</label>
              <div ref={dropdownRef} style={{ position: 'relative', flex: 1 }}>
                <div className="custom-select-trigger" onClick={() => setShowTagDropdown((p) => !p)} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer' }}>
                  <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: tagId ? tags.find(t => t.id === tagId)?.color : 'transparent', border: tagId ? 'none' : '1px solid var(--border)' }} />
                  <span style={{ flex: 1 }}>{tagId ? tags.find(t => t.id === tagId)?.name : t('createEvent.noTag', 'Aucun tag')}</span>
                  <ChevronDown size={14} />
                </div>
                {showTagDropdown && (
                  <div className="custom-select-dropdown" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '4px', marginTop: '4px', maxHeight: '200px', overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                    <div role="button" tabIndex={0} className="custom-select-option" onClick={() => { setTagId(''); setShowTagDropdown(false); }} onKeyDown={(e) => { if (e.key === 'Enter') { setTagId(''); setShowTagDropdown(false); } }} style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '12px', height: '12px', borderRadius: '50%', border: '1px solid var(--border)' }} />
                      {t('createEvent.noTag', 'Aucun tag')}
                    </div>
                    {tags.map((tag) => (
                      <div role="button" tabIndex={0} key={tag.id} className="custom-select-option" onClick={() => { setTagId(tag.id); setShowTagDropdown(false); }} onKeyDown={(e) => { if (e.key === 'Enter') { setTagId(tag.id); setShowTagDropdown(false); } }} style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
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
            <label htmlFor="ev-attendees">{t('createEvent.attendees')} <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>{t('createEvent.optional')}</span></label>
            <AttendeeInput value={attendees} onChange={setAttendees} allEvents={allEvents} />
          </div>

          {showFreeBusy && (
            <FreeBusySection
              start={start} end={end} attendees={attendees} freeBusyData={freeBusyData}
              freeBusyLoading={freeBusyLoading} selfBusySlots={selfBusySlots}
              ownerEmail={selectedCalendar?.ownerEmail} onSelectTime={handleSelectTime}
            />
          )}

          <div className="form-row">
            <label htmlFor="ev-location">{t('createEvent.location')} <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>{t('createEvent.optional')}</span></label>
            <input id="ev-location" type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t('createEvent.locationPlaceholder')} />
          </div>

          <div className="form-row">
            <label htmlFor="ev-desc">{t('createEvent.description')} <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>{t('createEvent.optional')}</span></label>
            <textarea id="ev-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>

          {error && <div style={{ color: 'var(--color-error, #d93025)', fontSize: 13 }}>{error}</div>}

          <div className="config-edit-actions">
            <button type="submit" className="btn-primary" disabled={saving || !title.trim()}>{submitLabel}</button>
            <button type="button" className="btn-cancel" onClick={onClose}>{t('createEvent.cancel')}</button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
