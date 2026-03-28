import { useState, useRef, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { CalendarEvent } from '../types';

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
  const [inputValue, setInputValue] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = inputValue.trim();
      if (!trimmed) return;
      const exact = filtered.find((s) => s.email.toLowerCase() === trimmed.toLowerCase());
      addAttendee(exact ?? { email: trimmed });
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
        placeholder="Nom ou adresse e-mail…"
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <ul className="attendee-dropdown">
          {filtered.map((s) => (
            <li
              key={s.email}
              className="attendee-dropdown-item"
              onMouseDown={(e) => { e.preventDefault(); addAttendee(s); }}
            >
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
                aria-label={`Supprimer ${a.name ?? a.email}`}
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
