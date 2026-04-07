import { useEffect, useMemo, useRef, useState } from 'react';

import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface RecipientEntry {
  email: string;
  name?: string;
}

interface RecipientInputProps {
  readonly value: RecipientEntry[];
  readonly onChange: (recipients: RecipientEntry[]) => void;
  /** Accumulated contacts from all loaded mail messages. */
  readonly contacts: RecipientEntry[];
  readonly autoFocus?: boolean;
}

export function RecipientInput({ value, onChange, contacts, autoFocus }: RecipientInputProps) {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = inputValue.trim().toLowerCase();
    const added = new Set(value.map(r => r.email.toLowerCase()));
    const base = q
      ? contacts.filter(
          c => c.email.toLowerCase().includes(q) || (c.name?.toLowerCase().includes(q) ?? false)
        )
      : contacts;
    return base.filter(c => !added.has(c.email.toLowerCase())).slice(0, 8);
  }, [inputValue, contacts, value]);

  const addRecipient = (entry: RecipientEntry) => {
    const normalized = entry.email.toLowerCase();
    if (value.some(r => r.email.toLowerCase() === normalized)) {
      setInputValue('');
      setOpen(false);
      return;
    }
    onChange([...value, entry]);
    setInputValue('');
    setOpen(false);
    inputRef.current?.focus();
  };

  const removeRecipient = (email: string) => {
    onChange(value.filter(r => r.email.toLowerCase() !== email.toLowerCase()));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = inputValue.trim();
      if (!trimmed) return;
      const exact = filtered.find(c => c.email.toLowerCase() === trimmed.toLowerCase());
      addRecipient(exact ?? { email: trimmed });
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Backspace' && inputValue === '' && value.length > 0) {
      onChange(value.slice(0, -1));
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
    <div ref={containerRef} className="recipient-input">
      <div className="recipient-input__chips">
        {value.map(r => (
          <span key={r.email} className="recipient-chip">
            {r.name ?? r.email}
            <button
              type="button"
              className="recipient-chip__remove"
              onClick={() => removeRecipient(r.email)}
              aria-label={t('mail.removeRecipient', 'Retirer')}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="recipient-input__field"
          type="text"
          value={inputValue}
          onChange={e => { setInputValue(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={value.length === 0 ? 'email@example.com' : ''}
          autoComplete="off"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={autoFocus}
        />
      </div>
      {open && filtered.length > 0 && (
        <ul className="attendee-dropdown recipient-dropdown">
          {filtered.map(c => (
            <li
              key={c.email}
              className="attendee-dropdown-item"
              onMouseDown={e => { e.preventDefault(); addRecipient(c); }}
            >
              {c.name ? (
                <>
                  <span className="attendee-dropdown-name">{c.name}</span>
                  <span className="attendee-dropdown-email">{c.email}</span>
                </>
              ) : (
                <span className="attendee-dropdown-name">{c.email}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
