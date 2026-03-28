import { useState, FormEvent, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { CalendarConfig, CalendarEvent, CreateEventPayload } from '../types';
import AttendeeInput from './AttendeeInput';

interface Props {
  readonly initialStart: string;
  readonly initialEnd: string;
  readonly writableCalendars: CalendarConfig[];
  readonly allEvents: CalendarEvent[];
  /** When provided, the modal operates in edit mode */
  readonly editEvent?: CalendarEvent;
  readonly onSubmit: (payload: CreateEventPayload) => Promise<void>;
  readonly onClose: () => void;
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

export default function CreateEventModal({ initialStart, initialEnd, writableCalendars, allEvents, editEvent, onSubmit, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isEditing = editEvent != null;

  const [title, setTitle] = useState(editEvent?.title ?? '');
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

  const selectedCalendar = writableCalendars.find((c) => c.id === calendarId);
  const headerColor = selectedCalendar?.color ?? '#888';

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
      await onSubmit({
        title: title.trim(),
        start: startIso,
        end: endIso,
        isAllday,
        location: location.trim() || undefined,
        description: description.trim() || undefined,
        calendarId,
        attendees: attendees.length > 0 ? attendees : undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la sauvegarde');
      setSaving(false);
    }
  };

  const googleCals = writableCalendars.filter((c) => c.type === 'google');
  const ekCals = writableCalendars.filter((c) => c.type === 'eventkit');

  let submitLabel: string;
  if (saving) {
    submitLabel = isEditing ? 'Sauvegarde…' : 'Création…';
  } else {
    submitLabel = isEditing ? 'Enregistrer' : 'Créer';
  }

  return (
    <dialog ref={dialogRef} className="modal-dialog modal-dialog--form">
      <div className="modal">
        <div className="modal-header" style={{ background: headerColor }}>
          <span className="modal-title">{isEditing ? "Modifier l'événement" : 'Nouvel événement'}</span>
          <button className="btn-icon modal-close" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body modal-form">
          <div className="form-row">
            <label htmlFor="ev-title">Titre</label>
            <input
              id="ev-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Titre de l'événement"
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
              <span>Toute la journée</span>
            </label>
          </div>

          {isAllday ? (
            <>
              <div className="form-row">
                <label htmlFor="ev-start-date">Début</label>
                <input id="ev-start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
              </div>
              <div className="form-row">
                <label htmlFor="ev-end-date">Fin</label>
                <input id="ev-end-date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
              </div>
            </>
          ) : (
            <>
              <div className="form-row">
                <label htmlFor="ev-start">Début</label>
                <input id="ev-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
              </div>
              <div className="form-row">
                <label htmlFor="ev-end">Fin</label>
                <input id="ev-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
              </div>
            </>
          )}

          <div className="form-row">
            <label htmlFor="ev-calendar">Calendrier</label>
            <select
              id="ev-calendar"
              value={calendarId}
              onChange={(e) => setCalendarId(e.target.value)}
              disabled={isEditing}
              required
            >
              {ekCals.length > 0 && googleCals.length > 0 ? (
                <>
                  <optgroup label="macOS">
                    {ekCals.map((cal) => (
                      <option key={cal.id} value={cal.id}>{cal.name}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Google Agenda">
                    {googleCals.map((cal) => (
                      <option key={cal.id} value={cal.id}>{cal.name}</option>
                    ))}
                  </optgroup>
                </>
              ) : (
                writableCalendars.map((cal) => (
                  <option key={cal.id} value={cal.id}>{cal.name}</option>
                ))
              )}
            </select>
          </div>

          <div className="form-row">
            <label htmlFor="ev-attendees">
              Participants <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optionnel)</span>
            </label>
            <AttendeeInput value={attendees} onChange={setAttendees} allEvents={allEvents} />
          </div>

          <div className="form-row">
            <label htmlFor="ev-location">
              Lieu <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optionnel)</span>
            </label>
            <input
              id="ev-location"
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Salle, adresse…"
            />
          </div>

          <div className="form-row">
            <label htmlFor="ev-desc">
              Description <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optionnel)</span>
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
            <button type="button" className="btn-cancel" onClick={onClose}>Annuler</button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
