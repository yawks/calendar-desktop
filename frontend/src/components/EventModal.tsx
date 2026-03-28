import React, { useEffect, useRef, useState } from 'react';
import {
  X, Pencil, Clock, MapPin, CalendarDays, FileText,
  HelpCircle, History, Users, Check, Ban, Minus, Forward, UserCheck, Loader2,
} from 'lucide-react';
import { CalendarConfig, CalendarEvent, Attendee, AttendeeStatus } from '../types';

const URL_RE = /https?:\/\/[^\s<>"']+/g;

function linkify(text: string) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const url = match[0];
    parts.push(<a key={match.index} href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', wordBreak: 'break-all' }}>{url}</a>);
    last = match.index + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

type RsvpStatus = 'ACCEPTED' | 'DECLINED' | 'TENTATIVE';

interface Props {
  readonly event: CalendarEvent | null;
  readonly calendar: CalendarConfig | null;
  readonly onClose: () => void;
  readonly onEdit?: () => void;
  readonly onRsvp?: (status: RsvpStatus) => Promise<void>;
}

const RSVP_OPTIONS: { status: RsvpStatus; label: string; icon: React.ReactNode }[] = [
  { status: 'ACCEPTED',  label: 'Accepté',   icon: <Check size={13} /> },
  { status: 'TENTATIVE', label: 'Peut-être',  icon: <HelpCircle size={13} /> },
  { status: 'DECLINED',  label: 'Refusé',     icon: <Ban size={13} /> },
];

function RsvpRow({ current, onRsvp }: {
  readonly current: AttendeeStatus;
  readonly onRsvp: (status: RsvpStatus) => Promise<void>;
}) {
  const [loading, setLoading] = useState<RsvpStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async (status: RsvpStatus) => {
    if (loading) return;
    setError(null);
    setLoading(status);
    try {
      await onRsvp(status);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de la mise à jour');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="rsvp-buttons">
        {RSVP_OPTIONS.map(({ status, label, icon }) => {
          const isActive = current === status;
          const isLoading = loading === status;
          return (
            <button
              key={status}
              type="button"
              className={`rsvp-btn rsvp-btn--${status.toLowerCase()}${isActive ? ' rsvp-btn--active' : ''}`}
              onClick={() => handleClick(status)}
              disabled={!!loading}
              aria-pressed={isActive}
            >
              {isLoading ? <Loader2 size={13} className="rsvp-spinner" /> : icon}
              {label}
            </button>
          );
        })}
      </div>
      {error && <span className="rsvp-error">{error}</span>}
    </div>
  );
}

function formatEventDate(event: CalendarEvent): string {
  const locale = 'fr-FR';
  const start = new Date(event.start);
  const end = new Date(event.end);

  if (event.isAllday) {
    const endDisplay = new Date(end);
    endDisplay.setDate(endDisplay.getDate() - 1);
    const sameDay = start.toDateString() === endDisplay.toDateString();
    if (sameDay) {
      return start.toLocaleDateString(locale, {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      });
    }
    return `${start.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} – ${endDisplay.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }

  const dateStr = start.toLocaleDateString(locale, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const startTime = start.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const endTime = end.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return `${dateStr} · ${startTime} – ${endTime}`;
}

function AttendeeStatusIcon({ status }: { readonly status: AttendeeStatus }) {
  switch (status) {
    case 'ACCEPTED':     return <Check size={13} style={{ color: '#34a853' }} />;
    case 'DECLINED':     return <Ban size={13} style={{ color: '#ea4335' }} />;
    case 'TENTATIVE':    return <HelpCircle size={13} style={{ color: '#fbbc04' }} />;
    case 'DELEGATED':    return <Forward size={13} style={{ color: '#9c27b0' }} />;
    default:             return <Minus size={13} style={{ color: 'var(--text-muted)' }} />;
  }
}

const STATUS_LABELS: Record<AttendeeStatus, string> = {
  'ACCEPTED':     'Accepté',
  'DECLINED':     'Refusé',
  'TENTATIVE':    'Peut-être',
  'NEEDS-ACTION': 'En attente',
  'DELEGATED':    'Délégué',
};

function AttendeeRow({ attendee }: { readonly attendee: Attendee }) {
  return (
    <div className="attendee-row" title={`${attendee.email} — ${STATUS_LABELS[attendee.status]}`}>
      <AttendeeStatusIcon status={attendee.status} />
      <span className="attendee-name">
        {attendee.name}
        {attendee.isOrganizer && <span className="attendee-organizer">organisateur</span>}
      </span>
    </div>
  );
}

export default function EventModal({ event, calendar, onClose, onEdit, onRsvp }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (event) {
      dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [event]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const onCancel = () => onClose();
    const onBackdropClick = (e: MouseEvent) => {
      const rect = dialog.getBoundingClientRect();
      const clickedOutside =
        e.clientX < rect.left || e.clientX > rect.right ||
        e.clientY < rect.top  || e.clientY > rect.bottom;
      if (clickedOutside) onClose();
    };

    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('click', onBackdropClick);
    return () => {
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('click', onBackdropClick);
    };
  }, [onClose]);

  const isPast = event ? new Date(event.end) < new Date() : false;

  // Sort: organizer first, then by status
  const STATUS_ORDER: Record<AttendeeStatus, number> = {
    'ACCEPTED': 1, 'TENTATIVE': 2, 'NEEDS-ACTION': 3, 'DELEGATED': 4, 'DECLINED': 5,
  };
  const sortedAttendees = event?.attendees
    ? [...event.attendees].sort((a, b) => {
        if (a.isOrganizer) return -1;
        if (b.isOrganizer) return 1;
        return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      })
    : [];

  return (
    <dialog ref={dialogRef} className="modal-dialog">
      {event && (
        <div className="modal">
          <div className="modal-header" style={{ background: calendar?.color || '#888' }}>
            <span className="modal-title">{event.title}</span>
            {onEdit && (
              <button className="btn-icon modal-close" onClick={onEdit} aria-label="Modifier">
                <Pencil size={16} />
              </button>
            )}
            <button className="btn-icon modal-close" onClick={onClose} aria-label="Fermer">
              <X size={18} />
            </button>
          </div>

          <div className="modal-body">
            <div className="modal-row">
              <Clock size={16} className="modal-icon" />
              <span>{formatEventDate(event)}</span>
            </div>

            {event.location && (
              <div className="modal-row">
                <MapPin size={16} className="modal-icon" />
                <span>{event.location}</span>
              </div>
            )}

            {calendar && (
              <div className="modal-row">
                <CalendarDays size={16} className="modal-icon" />
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: calendar.color, flexShrink: 0,
                  }} />
                  {calendar.name}
                </span>
              </div>
            )}

            {(() => {
              if (event.selfRsvpStatus && onRsvp) {
                return (
                  <div className="modal-row">
                    <UserCheck size={16} className="modal-icon" style={{ marginTop: 3 }} />
                    <RsvpRow current={event.selfRsvpStatus} onRsvp={onRsvp} />
                  </div>
                );
              }
              if (event.isUnaccepted) {
                return (
                  <div className="modal-row modal-tentative">
                    <HelpCircle size={16} className="modal-icon" />
                    <span>Invitation en attente de réponse</span>
                  </div>
                );
              }
              return null;
            })()}

            {isPast && !event.isUnaccepted && !(event.selfRsvpStatus && onRsvp) && (
              <div className="modal-row modal-past">
                <History size={16} className="modal-icon" />
                <span>Événement passé</span>
              </div>
            )}

            {sortedAttendees.length > 0 && (
              <div className="modal-row modal-attendees-row">
                <Users size={16} className="modal-icon" style={{ marginTop: 3 }} />
                <div className="attendee-list">
                  <span className="attendee-count">{sortedAttendees.length} invité{sortedAttendees.length > 1 ? 's' : ''}</span>
                  {sortedAttendees.map((a) => (
                    <AttendeeRow key={a.email} attendee={a} />
                  ))}
                </div>
              </div>
            )}

            {event.description && (
              <div className="modal-row modal-description-row">
                <FileText size={16} className="modal-icon" style={{ marginTop: 2 }} />
                <span className="modal-description">{linkify(event.description)}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}
