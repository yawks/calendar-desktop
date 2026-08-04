import { useState, useRef, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CalendarEvent } from '../../../shared/types';
import { ContactAvatar } from '../../mail/components/ContactAvatar';

interface AttendeeEntry {
  email: string;
  name?: string;
}

interface Props {
  value: AttendeeEntry[];
  onChange: (attendees: AttendeeEntry[]) => void;
  allEvents: CalendarEvent[];
}

function buildSuggestions(allEvents: CalendarEvent[]): AttendeeEntry[] {
  const freq = new Map<string, { name?: string; count: number }>();
  for (const ev of allEvents) {
    for (const a of ev.attendees ?? []) {
      if (!a.email) continue;
      const key = a.email.toLowerCase();
      const existing = freq.get(key);
      const displayName = a.name !== a.email ? a.name : undefined;
      if (existing) {
        existing.count++;
        if (!existing.name && displayName) existing.name = displayName;
      } else {
        freq.set(key, { name: displayName, count: 1 });
      }
    }
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .map(([email, { name }]) => ({ email, name }));
}

export default function AttendeeInput({ value, onChange, allEvents }: Props) {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);

  const suggestions = useMemo(() => buildSuggestions(allEvents), [allEvents]);

  const filtered = useMemo(() => {
    const q = inputValue.trim().toLowerCase();
    const base = q
      ? suggestions.filter(
          (s) =>
            s.email.toLowerCase().includes(q) ||
            (s.name?.toLowerCase().includes(q) ?? false)
        )
      : suggestions;
    const added = new Set(value.map((a) => a.email.toLowerCase()));
    return base.filter((s) => !added.has(s.email.toLowerCase())).slice(0, 8);
  }, [inputValue, suggestions, value]);

  useEffect(() => { setActiveIndex(0); }, [filtered]);

  useEffect(() => {
    if (!activeRef.current || !listRef.current) return;
    const list = listRef.current;
    const item = activeRef.current;
    if (item.offsetTop < list.scrollTop) {
      list.scrollTop = item.offsetTop;
    } else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
    }
  }, [activeIndex]);

  const addAttendee = (entry: AttendeeEntry) => {
    const normalized = entry.email.toLowerCase();
    if (value.some((a) => a.email.toLowerCase() === normalized)) {
      setInputValue('');
      setOpen(false);
      return;
    }
    onChange([...value, entry]);
    setInputValue('');
    setOpen(false);
    inputRef.current?.focus();
  };

  const removeAttendee = (email: string) => {
    onChange(value.filter((a) => a.email.toLowerCase() !== email.toLowerCase()));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open && filtered.length > 0) { setOpen(true); }
      else { setActiveIndex(i => Math.min(i + 1, filtered.length - 1)); }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = inputValue.trim();
      if (!trimmed) return;
      if (open && filtered.length > 0) {
        addAttendee(filtered[activeIndex] ?? { email: trimmed });
      } else {
        const exact = filtered.find((s) => s.email.toLowerCase() === trimmed.toLowerCase());
        addAttendee(exact ?? { email: trimmed });
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => { setInputValue(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={t('attendeeInput.placeholder')}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <ul ref={listRef} className="attendee-dropdown">
          {filtered.map((s, i) => (
            <li
              key={s.email}
              ref={i === activeIndex ? activeRef : null}
              className={`attendee-dropdown-item${i === activeIndex ? ' attendee-dropdown-item--active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); addAttendee(s); }}
            >
              <ContactAvatar email={s.email} name={s.name} size={28} />
              {s.name ? (
                <>
                  <span className="attendee-dropdown-name">{s.name}</span>
                  <span className="attendee-dropdown-email">{s.email}</span>
                </>
              ) : (
                <span className="attendee-dropdown-name">{s.email}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {value.length > 0 && (
        <div className="attendee-chips">
          {value.map((a) => (
            <div key={a.email} className="attendee-chip">
              <div className="attendee-chip-text">
                <span className="attendee-chip-label">{a.name ?? a.email}</span>
                {a.name && <span className="attendee-chip-email">{a.email}</span>}
              </div>
              <button
                type="button"
                className="attendee-chip-remove"
                onClick={() => removeAttendee(a.email)}
                aria-label={t('attendeeInput.remove', { name: a.name ?? a.email })}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
