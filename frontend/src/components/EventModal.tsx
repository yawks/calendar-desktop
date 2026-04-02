import React, { useEffect, useRef, useState } from 'react';
import {
  X, Pencil, Trash2, Clock, MapPin, CalendarDays, FileText,
  HelpCircle, History, Users, Check, Ban, Minus, Forward, UserCheck, Loader2, Video, ChevronDown, Copy,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { CalendarConfig, CalendarEvent, Attendee, AttendeeStatus } from '../types';
import i18n from '../i18n';
import { useTags } from '../store/TagStore';

function openExternal(url: string) {
  invoke('open_url', { url }).catch(console.error);
}

const URL_RE = /https?:\/\/[^\s<>"']+/g;
const HTML_RE = /<[a-z][\s\S]*?>/i;

function linkify(text: string) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const url = match[0];
    parts.push(
      <a
        key={match.index}
        href={url}
        onClick={(e) => { e.preventDefault(); openExternal(url); }}
        style={{ color: 'var(--primary)', wordBreak: 'break-all', cursor: 'pointer' }}
      >
        {url}
      </a>
    );
    last = match.index + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function HtmlDescription({ html }: { readonly html: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest('a');
      if (anchor) {
        e.preventDefault();
        const href = anchor.getAttribute('href');
        if (href) openExternal(href);
      }
    };
    el.addEventListener('click', handler);
    return () => el.removeEventListener('click', handler);
  }, [html]);

  return <div ref={ref} className="modal-description" dangerouslySetInnerHTML={{ __html: html }} />;
}

type RsvpStatus = 'ACCEPTED' | 'DECLINED' | 'TENTATIVE';

interface Props {
  readonly event: CalendarEvent | null;
  readonly calendar: CalendarConfig | null;
  readonly onClose: () => void;
  readonly onEdit?: () => void;
  readonly onDelete?: () => Promise<void>;
  readonly onRsvp?: (status: RsvpStatus) => Promise<void>;
  readonly isOrganizer?: boolean;
}

function RsvpRow({ current, onRsvp }: {
  readonly current: AttendeeStatus;
  readonly onRsvp: (status: RsvpStatus) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState<RsvpStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const RSVP_OPTIONS: { status: RsvpStatus; label: string; icon: React.ReactNode }[] = [
    { status: 'ACCEPTED',  label: t('eventModal.rsvp.ACCEPTED'),  icon: <Check size={13} /> },
    { status: 'TENTATIVE', label: t('eventModal.rsvp.TENTATIVE'), icon: <HelpCircle size={13} /> },
    { status: 'DECLINED',  label: t('eventModal.rsvp.DECLINED'),  icon: <Ban size={13} /> },
  ];

  const handleClick = async (status: RsvpStatus) => {
    if (loading) return;
    setError(null);
    setLoading(status);
    try {
      await onRsvp(status);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('eventModal.rsvp.updateError'));
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
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US';
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

function AttendeeRow({ attendee }: { readonly attendee: Attendee }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const statusLabel = t(`eventModal.attendeeStatus.${attendee.status}`);

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(attendee.email).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="attendee-row" title={attendee.email ? `${attendee.email} — ${statusLabel}` : statusLabel}>
      <AttendeeStatusIcon status={attendee.status} />
      <span className="attendee-name">
        {attendee.name}
        {attendee.email && (
          <button className="attendee-copy-btn" onClick={handleCopy} title={attendee.email}>
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
        )}
        {attendee.isOrganizer && <span className="attendee-organizer">{t('eventModal.organizer')}</span>}
      </span>
    </div>
  );
}

export default function EventModal({ event, calendar, onClose, onEdit, onDelete, onRsvp, isOrganizer }: Props) {
  const { t } = useTranslation();
  const { tags, eventTags, setEventTag, removeEventTag } = useTags();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showAllAttendees, setShowAllAttendees] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (event) {
      dialog.showModal();
      setShowDeleteConfirm(false);
      setDeleteError(null);
    } else if (dialog.open) {
      dialog.close();
    }
  }, [event]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const onCancel = () => onClose();
    const onBackdropClick = (e: MouseEvent) => {
      // If the click target is still inside the dialog DOM (e.g. dropdown overflow), don't close
      if (dialog.contains(e.target as Node)) return;
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

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!showTagDropdown) return;
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowTagDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showTagDropdown]);

  const tagKey = event ? event.seriesId || event.sourceId || event.id || undefined : undefined;
  if (event) console.log('[TAG] tagKey:', tagKey, '| seriesId:', event.seriesId, '| sourceId:', event.sourceId);
  const selectedTagId = tagKey ? eventTags[tagKey] : undefined;
  const selectedTag = selectedTagId ? tags.find((tag) => tag.id === selectedTagId) : undefined;
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
            {tags.length > 0 && event && (
              <div ref={dropdownRef} style={{ position: 'relative', marginLeft: 12 }}>
                <button
                  type="button"
                  className="event-modal-tag-button"
                  onClick={() => setShowTagDropdown((prev) => !prev)}
                  aria-label={t('eventModal.selectTag', 'Select tag')}
                  style={{ minWidth: 100 }}
                >
                  <span style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    backgroundColor: selectedTag?.color ?? 'transparent',
                    border: selectedTag ? 'none' : '1px solid var(--border)',
                    flexShrink: 0,
                  }} />
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 90 }}>
                    {selectedTag ? selectedTag.name : t('eventModal.noTag', 'No tag')}
                  </span>
                  <ChevronDown size={14} />
                </button>
                {showTagDropdown && (
                  <div className="event-modal-tag-dropdown">
                    <button
                      type="button"
                      onClick={() => {
                        if (tagKey) removeEventTag(tagKey);
                        setShowTagDropdown(false);
                      }}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        background: 'transparent',
                        border: 'none',
                        textAlign: 'left',
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        border: '1px solid var(--border)',
                        display: 'inline-block',
                      }} />
                      <span>{t('eventModal.noTag', 'No tag')}</span>
                    </button>
                    {tags.map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => {
                          if (tagKey) setEventTag(tagKey, tag.id);
                          setShowTagDropdown(false);
                        }}
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          background: 'transparent',
                          border: 'none',
                          textAlign: 'left',
                          cursor: 'pointer',
                        }}
                      >
                        <span style={{
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          backgroundColor: tag.color,
                          display: 'inline-block',
                        }} />
                        <span>{tag.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {onEdit && (
              <button className="btn-icon modal-close" onClick={onEdit} aria-label={t('eventModal.edit')}>
                <Pencil size={16} />
              </button>
            )}
            {onDelete && (
              <button
                className="btn-icon modal-close"
                onClick={() => { setShowDeleteConfirm(true); setDeleteError(null); }}
                aria-label={t('eventModal.delete')}
              >
                <Trash2 size={16} />
              </button>
            )}
            <button className="btn-icon modal-close" onClick={onClose} aria-label={t('eventModal.close')}>
              <X size={18} />
            </button>
          </div>

          {showDeleteConfirm && (
            <div className="modal-delete-bar">
              <span>{t('eventModal.deleteConfirm')}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn-delete-confirm"
                  onClick={() => { onDelete!(); onClose(); }}
                >
                  {t('eventModal.deleteConfirmYes')}
                </button>
                <button
                  type="button"
                  className="btn-delete-cancel"
                  onClick={() => setShowDeleteConfirm(false)}
                >
                  {t('eventModal.deleteConfirmNo')}
                </button>
              </div>
              {deleteError && <span className="rsvp-error">{deleteError}</span>}
            </div>
          )}

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

            {event.meetUrl && (
              <div className="modal-row">
                <Video size={16} className="modal-icon" />
                <a
                  href={event.meetUrl}
                  onClick={(e) => { e.preventDefault(); openExternal(event.meetUrl!); }}
                  style={{ color: 'var(--primary)', cursor: 'pointer' }}
                >
                  {t('eventModal.joinMeet')}
                </a>
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

            {!isOrganizer && event.selfRsvpStatus && onRsvp && (
              <div className="modal-row">
                <UserCheck size={16} className="modal-icon" style={{ marginTop: 3 }} />
                <RsvpRow current={event.selfRsvpStatus} onRsvp={onRsvp} />
              </div>
            )}

            {!isOrganizer && event.selfRsvpStatus && !onRsvp && (
              <div className={`modal-row${event.selfRsvpStatus === 'DECLINED' ? ' modal-declined' : event.selfRsvpStatus !== 'ACCEPTED' ? ' modal-tentative' : ''}`}>
                <UserCheck size={16} className="modal-icon" />
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AttendeeStatusIcon status={event.selfRsvpStatus} />
                  {t(`eventModal.attendeeStatus.${event.selfRsvpStatus}`)}
                </span>
              </div>
            )}

            {!event.selfRsvpStatus && event.isUnaccepted && (
              <div className="modal-row modal-tentative">
                <HelpCircle size={16} className="modal-icon" />
                <span>{t('eventModal.pendingInvitation')}</span>
              </div>
            )}

            {isPast && !event.isUnaccepted && !event.selfRsvpStatus && (
              <div className="modal-row modal-past">
                <History size={16} className="modal-icon" />
                <span>{t('eventModal.pastEvent')}</span>
              </div>
            )}

            {sortedAttendees.length > 0 && (
              <div className="modal-row modal-attendees-row">
                <Users size={16} className="modal-icon" style={{ marginTop: 3 }} />
                <div className="attendee-list">
                  <span className="attendee-count">
                    {t('eventModal.attendees', { count: sortedAttendees.length })}
                  </span>
                  <div className="attendee-scroll-list">
                    {(showAllAttendees ? sortedAttendees : sortedAttendees.slice(0, 5)).map((a) => (
                      <AttendeeRow key={a.email} attendee={a} />
                    ))}
                  </div>
                  {sortedAttendees.length > 5 && (
                    <button className="attendee-show-more" onClick={() => setShowAllAttendees(v => !v)}>
                      {showAllAttendees
                        ? t('eventModal.showLess')
                        : t('eventModal.showMore', { count: sortedAttendees.length - 5 })}
                    </button>
                  )}
                </div>
              </div>
            )}

            {event.description && (
              <div className="modal-row modal-description-row">
                <FileText size={16} className="modal-icon" style={{ marginTop: 2 }} />
                {HTML_RE.test(event.description)
                  ? <HtmlDescription html={event.description} />
                  : <span className="modal-description">{linkify(event.description)}</span>
                }
              </div>
            )}

          </div>
        </div>
      )}
    </dialog>
  );
}
