import { useEffect, useMemo, useRef, useState } from 'react';

import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ContactDropdown } from './ContactDropdown';

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
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = inputValue.trim().toLowerCase();
    const added = new Set(value.map(r => r.email.toLowerCase()));
    const base = q
      ? contacts.filter(
          c => c.email.toLowerCase().startsWith(q) || (c.name?.toLowerCase().startsWith(q) ?? false)
        )
      : contacts;
    return base.filter(c => !added.has(c.email.toLowerCase())).slice(0, 8);
  }, [inputValue, contacts, value]);

  // Reset active index when dropdown opens or filtered list changes
  useEffect(() => {
    setActiveIndex(0);
  }, [filtered]);

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
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open && filtered.length > 0) {
        setOpen(true);
      } else {
        setActiveIndex(i => Math.min(i + 1, filtered.length - 1));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = inputValue.trim();
      if (!trimmed) return;
      if (open && filtered.length > 0) {
        addRecipient(filtered[activeIndex] ?? { email: trimmed });
      } else {
        const exact = filtered.find(c => c.email.toLowerCase() === trimmed.toLowerCase());
        addRecipient(exact ?? { email: trimmed });
      }
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
          onChange={e => { setInputValue(e.target.value); setOpen(e.target.value.length > 0); }}
          onKeyDown={handleKeyDown}
          placeholder={value.length === 0 ? 'email@example.com' : ''}
          autoComplete="off"
          spellCheck={false}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={autoFocus}
        />
      </div>
      {open && filtered.length > 0 && (
        <ContactDropdown
          items={filtered}
          activeIndex={activeIndex}
          onSelect={addRecipient}
        />
      )}
    </div>
  );
}
