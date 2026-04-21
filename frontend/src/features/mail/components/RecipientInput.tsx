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

  const handleDragStart = (e: React.DragEvent, entry: RecipientEntry) => {
    console.log('[DnD] dragStart', { entry, fieldId });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-recipient', JSON.stringify({ entry, fromFieldId: fieldId ?? '' }));
    console.log('[DnD] types after setData:', [...e.dataTransfer.types]);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    console.log('[DnD] dragEnter on field', fieldId, 'types:', [...e.dataTransfer.types]);
    if (!e.dataTransfer.types.includes('application/x-recipient')) {
      console.log('[DnD] dragEnter ignored — type not found');
      return;
    }
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
    console.log('[DnD] dragLeave on field', fieldId, 'count now:', dragEnterCount.current);
    if (dragEnterCount.current === 0) setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    console.log('[DnD] drop on field', fieldId, 'types:', [...e.dataTransfer.types]);
    e.preventDefault();
    dragEnterCount.current = 0;
    setIsDragOver(false);
    const raw = e.dataTransfer.getData('application/x-recipient');
    console.log('[DnD] raw data:', raw);
    if (!raw) return;
    try {
      const { entry, fromFieldId } = JSON.parse(raw) as { entry: RecipientEntry; fromFieldId: string };
      console.log('[DnD] parsed:', { entry, fromFieldId, targetField: fieldId });
      if (fromFieldId === fieldId) { console.log('[DnD] same field, no-op'); return; }
      onDropFromOtherField?.(entry, fromFieldId);
    } catch (err) {
      console.error('[DnD] parse error:', err);
    }
  };

  const handleEnterKey = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    if (open && filtered.length > 0) {
      addRecipient(filtered[activeIndex] ?? { email: trimmed });
    } else {
      const exact = filtered.find(c => c.email.toLowerCase() === trimmed.toLowerCase());
      addRecipient(exact ?? { email: trimmed });
    }
  };

  const commitPending = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    const exact = contacts.find(c => c.email.toLowerCase() === trimmed.toLowerCase());
    addRecipient(exact ?? { email: trimmed });
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
            {r.name ?? r.email}
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
