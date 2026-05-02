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
  /** Identifies this field for cross-field drag & drop (e.g. 'to', 'cc', 'bcc'). */
  readonly fieldId?: string;
  /** Called when a chip from another field is dropped here. */
  readonly onDropFromOtherField?: (entry: RecipientEntry, fromFieldId: string) => void;
}

/** Parse a raw string like "Name <email>" or plain "email" into a RecipientEntry. */
function parseRecipientText(raw: string): RecipientEntry | null {
  const text = raw.trim().replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  if (!text) return null;

  // "Name <email>" or "<email>"
  const angleMatch = text.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (angleMatch) {
    const name = angleMatch[1].trim().replace(/^["']|["']$/g, '');
    const email = angleMatch[2].trim();
    if (email.includes('@')) {
      return { email, name: name || undefined };
    }
  }

  // Plain email address
  if (text.includes('@')) {
    return { email: text };
  }

  return null;
}

/** Split a pasted/typed string by commas and semicolons, respecting angle-bracket groups. */
function splitRecipientString(input: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inAngle = false;
  for (const ch of input) {
    if (ch === '<') { inAngle = true; current += ch; }
    else if (ch === '>') { inAngle = false; current += ch; }
    else if ((ch === ',' || ch === ';') && !inAngle) {
      if (current.trim()) parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

export function RecipientInput({ value, onChange, contacts, autoFocus, fieldId, onDropFromOtherField }: RecipientInputProps) {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLUListElement>(null);
  const dragEnterCount = useRef(0);

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

  /** Click on a chip (not the × button) → put it back in the input for editing. */
  const editChip = (entry: RecipientEntry) => {
    removeRecipient(entry.email);
    const text = entry.name ? `${entry.name} <${entry.email}>` : entry.email;
    setInputValue(text);
    setOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleDragStart = (e: React.DragEvent, entry: RecipientEntry) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-recipient', JSON.stringify({ entry, fromFieldId: fieldId ?? '' }));
  };

  const handleDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-recipient')) return;
    e.preventDefault();
    dragEnterCount.current += 1;
    setIsDragOver(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-recipient')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDragLeave = () => {
    dragEnterCount.current -= 1;
    if (dragEnterCount.current === 0) setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragEnterCount.current = 0;
    setIsDragOver(false);
    const raw = e.dataTransfer.getData('application/x-recipient');
    if (!raw) return;
    try {
      const { entry, fromFieldId } = JSON.parse(raw) as { entry: RecipientEntry; fromFieldId: string };
      if (fromFieldId === fieldId) return;
      onDropFromOtherField?.(entry, fromFieldId);
    } catch {
      // ignore malformed drag data
    }
  };

  const commitText = (text: string) => {
    const parts = splitRecipientString(text);
    let added = false;
    let currentValue = value;
    for (const part of parts) {
      const entry = parseRecipientText(part);
      if (!entry) continue;
      // Check against contacts for a name match
      const known = contacts.find(c => c.email.toLowerCase() === entry.email.toLowerCase());
      const resolved = known ?? entry;
      const normalized = resolved.email.toLowerCase();
      if (!currentValue.some(r => r.email.toLowerCase() === normalized)) {
        currentValue = [...currentValue, resolved];
        added = true;
      }
    }
    if (added) {
      onChange(currentValue);
      setInputValue('');
      setOpen(false);
    }
  };

  const handleEnterKey = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    if (open && filtered.length > 0) {
      addRecipient(filtered[activeIndex] ?? parseRecipientText(trimmed) ?? { email: trimmed });
    } else {
      commitText(trimmed);
    }
  };

  const commitPending = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    commitText(trimmed);
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
      handleEnterKey();
    } else if (e.key === 'Tab') {
      if (inputValue.trim()) {
        e.preventDefault();
        commitPending();
      }
    } else if (e.key === ',' || e.key === ';') {
      e.preventDefault();
      commitPending();
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Backspace' && inputValue === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text');
    // Only intercept if the pasted text contains separator characters or angle brackets
    if (!pasted.includes(',') && !pasted.includes(';') && !pasted.includes('<')) return;
    e.preventDefault();
    commitText(pasted);
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
      <ul
        ref={chipsRef}
        className={`recipient-input__chips${isDragOver ? ' recipient-input__chips--drag-over' : ''}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {value.map(r => (
          <li
            key={r.email}
            className="recipient-chip"
            draggable
            onDragStart={e => handleDragStart(e, r)}
          >
            <button
              type="button"
              className="recipient-chip__label"
              onClick={() => editChip(r)}
              title={r.name ? r.email : undefined}
            >
              {r.name ?? r.email}
            </button>
            <button
              type="button"
              className="recipient-chip__remove"
              onClick={() => removeRecipient(r.email)}
              aria-label={t('mail.removeRecipient', 'Retirer')}
            >
              <X size={11} />
            </button>
          </li>
        ))}
        <li className="recipient-input__field-item"><input
          ref={inputRef}
          className="recipient-input__field"
          type="text"
          value={inputValue}
          onChange={e => { setInputValue(e.target.value); setOpen(e.target.value.length > 0); }}
          onKeyDown={handleKeyDown}
          onBlur={commitPending}
          onPaste={handlePaste}
          placeholder={value.length === 0 ? 'email@example.com' : ''}
          autoComplete="off"
          spellCheck={false}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={autoFocus}
        /></li>
      </ul>
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
