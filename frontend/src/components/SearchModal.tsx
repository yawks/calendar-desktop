import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, Clock, MapPin, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CalendarConfig, CalendarEvent } from '../types';

interface Props {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly events: CalendarEvent[];
  readonly calendars: CalendarConfig[];
  readonly onSearch: (query: string) => void;
}

function formatEventDate(start: string): string {
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function matchesQuery(event: CalendarEvent, q: string): boolean {
  const lower = q.toLowerCase();
  if (event.title.toLowerCase().includes(lower)) return true;
  if (event.attendees?.some((a) =>
    a.name.toLowerCase().includes(lower) || a.email.toLowerCase().includes(lower)
  )) return true;
  return false;
}

export default function SearchModal({ open, onClose, events, calendars, onSearch }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const suggestions = query.trim().length > 0
    ? events.filter((e) => matchesQuery(e, query)).slice(0, 7)
    : [];

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 30);
      dialogRef.current?.showModal();
    } else {
      dialogRef.current?.close();
    }
  }, [open]);

  // Close on backdrop click
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClick = (e: MouseEvent) => {
      const rect = dialog.getBoundingClientRect();
      const outside =
        e.clientX < rect.left || e.clientX > rect.right ||
        e.clientY < rect.top || e.clientY > rect.bottom;
      if (outside) onClose();
    };
    dialog.addEventListener('click', handleClick);
    return () => dialog.removeEventListener('click', handleClick);
  }, [onClose]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, suggestions.length));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = query.trim();
      if (!trimmed) return;
      onSearch(trimmed);
      onClose();
    }
  };

  const handleSuggestionClick = (event: CalendarEvent) => {
    onSearch(event.title);
    onClose();
  };

  if (!open) return null;

  const modal = (
    <dialog
      ref={dialogRef}
      className="search-dialog"
      onClose={onClose}
    >
      <div className="search-modal">
        <div className="search-input-row">
          <Search size={18} className="search-input-icon" />
          <input
            ref={inputRef}
            className="search-input"
            type="text"
            placeholder={t('search.placeholder')}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
            onKeyDown={handleKeyDown}
            autoComplete="off"
          />
          {query && (
            <button className="search-clear-btn" onClick={() => { setQuery(''); inputRef.current?.focus(); }}>
              <X size={15} />
            </button>
          )}
          <kbd className="search-kbd">Esc</kbd>
        </div>

        {suggestions.length > 0 && (
          <ul className="search-suggestions" role="listbox">
            {suggestions.map((ev, i) => {
              const cal = calendars.find((c) => c.id === ev.calendarId);
              return (
                <li
                  key={ev.id}
                  role="option"
                  aria-selected={i === activeIndex}
                  className={`search-suggestion-item${i === activeIndex ? ' active' : ''}`}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => handleSuggestionClick(ev)}
                >
                  <span
                    className="search-suggestion-dot"
                    style={{ background: cal?.color ?? '#888' }}
                  />
                  <span className="search-suggestion-title">{ev.title}</span>
                  <span className="search-suggestion-meta">
                    <Clock size={12} />
                    {formatEventDate(ev.start)}
                    {ev.location && (
                      <>
                        <MapPin size={12} />
                        {ev.location}
                      </>
                    )}
                    {ev.attendees && ev.attendees.length > 0 && (
                      <>
                        <Users size={12} />
                        {ev.attendees.length}
                      </>
                    )}
                  </span>
                </li>
              );
            })}
            <li className="search-suggestion-footer" onClick={() => { if (query.trim()) { onSearch(query.trim()); onClose(); } }}>
              <Search size={13} />
              {t('search.searchAll', { query })}
              <kbd className="search-kbd-small">↵</kbd>
            </li>
          </ul>
        )}

        {query.trim().length > 0 && suggestions.length === 0 && (
          <div className="search-no-results">{t('search.noSuggestions')}</div>
        )}

        {query.trim().length === 0 && (
          <div className="search-hint">{t('search.hint')}</div>
        )}
      </div>
    </dialog>
  );

  return createPortal(modal, document.body);
}
