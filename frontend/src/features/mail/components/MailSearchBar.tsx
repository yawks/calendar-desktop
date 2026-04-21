import { useEffect, useRef, useState, KeyboardEvent } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MailSearchQuery } from '../types';
import { ContactDropdown } from './ContactDropdown';
import type { RecipientEntry } from './RecipientInput';

// ── Token parsing ─────────────────────────────────────────────────────────────

const TOKEN_KEYS = ['from', 'to', 'cc', 'bcc', 'subject', 'in', 'date'] as const;
type TokenKey = typeof TOKEN_KEYS[number];

function tokenKeyToQueryKey(key: TokenKey): keyof MailSearchQuery {
  if (key === 'in') return 'folder';
  return key as keyof MailSearchQuery;
}

const TOKEN_RE = /\b(from|to|cc|bcc|subject|in|date):("([^"]*)"|([\S]+))/gi;

export function parseSearchInput(raw: string): MailSearchQuery {
  const query: MailSearchQuery = {};
  let remaining = raw;
  let match: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((match = TOKEN_RE.exec(raw)) !== null) {
    const key = match[1].toLowerCase() as TokenKey;
    const value = (match[3] ?? match[4] ?? '').trim();
    if (!value) continue;
    remaining = remaining.replace(match[0], '');
    (query[tokenKeyToQueryKey(key)] as string) = value;
  }
  const text = remaining.trim();
  if (text) query.text = text;
  return query;
}

export function resolveDateToken(value: string): string {
  const d = new Date();
  if (value === 'today') return d.toISOString().split('T')[0];
  if (value === 'yesterday') {
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  }
  return value;
}

function queryToString(query: MailSearchQuery): string {
  const parts: string[] = [];
  if (query.from)    parts.push(`from:${query.from}`);
  if (query.to)      parts.push(`to:${query.to}`);
  if (query.cc)      parts.push(`cc:${query.cc}`);
  if (query.bcc)     parts.push(`bcc:${query.bcc}`);
  if (query.subject) parts.push(query.subject.includes(' ') ? `subject:"${query.subject}"` : `subject:${query.subject}`);
  if (query.folder)  parts.push(`in:${query.folder}`);
  if (query.date)    parts.push(`date:${query.date}`);
  if (query.text)    parts.push(query.text);
  return parts.join(' ');
}

function isQueryEmpty(q: MailSearchQuery): boolean {
  return !q.from && !q.to && !q.cc && !q.bcc && !q.subject && !q.folder && !q.date && !q.text;
}

// ── Suggestions ───────────────────────────────────────────────────────────────

interface Suggestion {
  id: string;
  labelKey: string;
  labelDefault: string;
  suffix: string;
  insert: string;
  isDefault: boolean;
}

const SUGGESTIONS: Suggestion[] = [
  { id: 'inbox', labelKey: 'mail.search.inInbox', labelDefault: 'In Inbox', suffix: '',  insert: 'in:inbox ',   isDefault: true },
  { id: 'today', labelKey: 'mail.search.today',   labelDefault: 'Today',    suffix: '',  insert: 'date:today ', isDefault: true },
  { id: 'to',    labelKey: 'mail.search.to',       labelDefault: 'To',      suffix: ':', insert: 'to:',         isDefault: true },
  { id: 'from',  labelKey: 'mail.search.from',     labelDefault: 'From',    suffix: ':', insert: 'from:',       isDefault: true },
  { id: 'cc',    labelKey: 'mail.search.cc',       labelDefault: 'Cc',      suffix: ':', insert: 'cc:',         isDefault: false },
  { id: 'bcc',   labelKey: 'mail.search.bcc',      labelDefault: 'Bcc',     suffix: ':', insert: 'bcc:',        isDefault: false },
  { id: 'date',  labelKey: 'mail.search.date',     labelDefault: 'Date',    suffix: ':', insert: 'date:',       isDefault: false },
];

/** Returns the word currently being typed at the cursor (after last space). */
function getPartialWord(value: string, cursor: number): string {
  const beforeCursor = value.slice(0, cursor);
  const lastSpace = beforeCursor.lastIndexOf(' ');
  return beforeCursor.slice(lastSpace + 1);
}

function filterSuggestions(partial: string, getLabel: (s: Suggestion) => string): Suggestion[] {
  if (!partial) return SUGGESTIONS.filter(s => s.isDefault);
  const lower = partial.toLowerCase();
  return SUGGESTIONS.filter(s => {
    return s.insert.toLowerCase().startsWith(lower) || getLabel(s).toLowerCase().startsWith(lower);
  });
}

// ── Contact keyword detection ─────────────────────────────────────────────────

const CONTACT_KEYWORDS = new Set(['to', 'from', 'cc', 'bcc']);

interface ContactMode {
  keyword: string; // 'to' | 'from' | 'cc' | 'bcc'
  query: string;   // what was typed after the colon
}

function parseContactMode(partial: string): ContactMode | null {
  const colonIdx = partial.indexOf(':');
  if (colonIdx === -1) return null;
  const keyword = partial.slice(0, colonIdx).toLowerCase();
  if (!CONTACT_KEYWORDS.has(keyword)) return null;
  return { keyword, query: partial.slice(colonIdx + 1) };
}

function filterContacts(contacts: RecipientEntry[], query: string): RecipientEntry[] {
  const q = query.toLowerCase();
  const base = q
    ? contacts.filter(
        c => c.email.toLowerCase().startsWith(q) || (c.name?.toLowerCase().startsWith(q) ?? false)
      )
    : contacts;
  return base.slice(0, 8);
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface MailSearchBarProps {
  readonly activeQuery: MailSearchQuery | null;
  readonly onSearch: (query: MailSearchQuery | null) => void;
  readonly contacts?: RecipientEntry[];
}

export function MailSearchBar({ activeQuery, onSearch, contacts = [] }: MailSearchBarProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [partialWord, setPartialWord] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Sync input when activeQuery changes externally and user is not typing
  useEffect(() => {
    if (!activeQuery) {
      setInputValue('');
    } else if (!focused) {
      setInputValue(queryToString(activeQuery));
    }
  }, [activeQuery, focused]);

  // Global ⌘F / Ctrl+F shortcut
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const modifier = isMac ? e.metaKey : e.ctrlKey;
      if (modifier && e.key === 'f') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    globalThis.addEventListener('keydown', handler);
    return () => globalThis.removeEventListener('keydown', handler);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Determine what the dropdown should show
  const contactMode = parseContactMode(partialWord);
  const filteredContacts = contactMode ? filterContacts(contacts, contactMode.query) : [];
  const getLabel = (s: Suggestion) => t(s.labelKey, s.labelDefault);
  const filteredSuggestions = contactMode ? [] : filterSuggestions(partialWord, getLabel);
  const showContactDropdown = dropdownOpen && contactMode !== null && filteredContacts.length > 0;
  const showSuggestionDropdown = dropdownOpen && !contactMode && filteredSuggestions.length > 0;

  const updatePartialAndDropdown = (value: string, cursor: number) => {
    const partial = getPartialWord(value, cursor);
    setPartialWord(partial);
    const inContactMode = parseContactMode(partial) !== null;
    const hasSuggestions = filterSuggestions(partial, s => t(s.labelKey, s.labelDefault)).length > 0;
    setDropdownOpen(inContactMode || hasSuggestions);
  };

  /** Replace the partial word at the cursor with the given text and reposition cursor. */
  const replacePartial = (insert: string) => {
    const cursor = inputRef.current?.selectionStart ?? inputValue.length;
    const beforeCursor = inputValue.slice(0, cursor);
    const lastSpace = beforeCursor.lastIndexOf(' ');
    const beforePartial = inputValue.slice(0, lastSpace + 1);
    const afterCursor = inputValue.slice(cursor);
    const newValue = beforePartial + insert + afterCursor;
    const newCursor = beforePartial.length + insert.length;
    setInputValue(newValue);
    setPartialWord('');
    setDropdownOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.selectionStart = newCursor;
        inputRef.current.selectionEnd = newCursor;
      }
    }, 0);
  };

  const insertSuggestion = (s: Suggestion) => replacePartial(s.insert);

  const insertContact = (contact: RecipientEntry) => {
    if (!contactMode) return;
    replacePartial(`${contactMode.keyword}:${contact.email} `);
  };

  const activeListLength = showContactDropdown ? filteredContacts.length : filteredSuggestions.length;

  /** Returns true if the key was handled by dropdown navigation. */
  const handleDropdownKey = (e: KeyboardEvent<HTMLInputElement>): boolean => {
    if (!showContactDropdown && !showSuggestionDropdown) return false;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => (i + 1) % activeListLength);
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => (i - 1 + activeListLength) % activeListLength);
      return true;
    }
    if ((e.key === 'Tab' || e.key === 'Enter') && activeIndex >= 0) {
      e.preventDefault();
      if (showContactDropdown) insertContact(filteredContacts[activeIndex]);
      else insertSuggestion(filteredSuggestions[activeIndex]);
      return true;
    }
    return false;
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (handleDropdownKey(e)) return;

    if (e.key === 'Enter') {
      const parsed = parseSearchInput(inputValue);
      if (parsed.date) parsed.date = resolveDateToken(parsed.date);
      onSearch(isQueryEmpty(parsed) ? null : parsed);
      setDropdownOpen(false);
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      if (dropdownOpen) {
        setDropdownOpen(false);
      } else {
        onSearch(null);
        setInputValue('');
        inputRef.current?.blur();
      }
    }
  };

  const clearAll = () => {
    onSearch(null);
    setInputValue('');
    setDropdownOpen(false);
    inputRef.current?.focus();
  };

  const isActive = activeQuery && !isQueryEmpty(activeQuery);
  const showShortcut = !focused && !isActive && !inputValue;

  return (
    <div
      ref={containerRef}
      className={`mail-search-bar${isActive ? ' mail-search-bar--active' : ''}${focused ? ' mail-search-bar--focused' : ''}`}
      onClick={() => inputRef.current?.focus()}
    >
      <Search size={14} className="mail-search-bar__icon" />

      <input
        ref={inputRef}
        type="text"
        className="mail-search-bar__input"
        value={inputValue}
        placeholder={t('mail.search.placeholder', 'Search…')}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onChange={e => {
          const val = e.target.value;
          const cursor = e.target.selectionStart ?? val.length;
          setInputValue(val);
          setActiveIndex(-1);
          updatePartialAndDropdown(val, cursor);
        }}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          setFocused(true);
          const cursor = inputRef.current?.selectionStart ?? inputValue.length;
          updatePartialAndDropdown(inputValue, cursor);
        }}
        onBlur={() => {
          setFocused(false);
          setTimeout(() => setDropdownOpen(false), 150);
        }}
        aria-label={t('mail.search.label', 'Search mail')}
      />

      {showShortcut && (
        <span className="mail-search-bar__shortcut">⌘F</span>
      )}

      {(isActive || inputValue) && (
        <button
          type="button"
          className="mail-search-bar__clear"
          onMouseDown={e => { e.preventDefault(); e.stopPropagation(); clearAll(); }}
          aria-label={t('mail.search.clear', 'Clear search')}
        >
          <X size={14} />
        </button>
      )}

      {showContactDropdown && (
        <ContactDropdown
          items={filteredContacts}
          activeIndex={activeIndex}
          onSelect={insertContact}
        />
      )}

      {showSuggestionDropdown && (
        <div className="mail-search-dropdown">
          {filteredSuggestions.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`mail-search-suggestion${i === activeIndex ? ' mail-search-suggestion--active' : ''}`}
              onMouseDown={e => { e.preventDefault(); insertSuggestion(s); }}
            >
              <strong>{t(s.labelKey, s.labelDefault)}</strong>
              {s.suffix && <span className="mail-search-suggestion__suffix">{s.suffix}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
