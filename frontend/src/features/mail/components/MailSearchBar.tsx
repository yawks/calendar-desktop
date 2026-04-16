import { useEffect, useRef, useState, KeyboardEvent } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MailSearchQuery } from '../types';

// ── Token parsing ─────────────────────────────────────────────────────────────

const TOKEN_KEYS = ['from', 'to', 'cc', 'bcc', 'subject', 'in', 'date'] as const;
type TokenKey = typeof TOKEN_KEYS[number];

/** Map "in:" token value to the MailSearchQuery.folder field */
function tokenKeyToQueryKey(key: TokenKey): keyof MailSearchQuery {
  if (key === 'in') return 'folder';
  return key as keyof MailSearchQuery;
}

const TOKEN_RE = /\b(from|to|cc|bcc|subject|in|date):("([^"]*)"|([\S]+))/gi;

/** Parse a raw search string into a MailSearchQuery + remaining free text. */
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

/** Resolve 'today' / 'yesterday' labels to a YYYY-MM-DD date string. */
export function resolveDateToken(value: string): string {
  const d = new Date();
  if (value === 'today') return d.toISOString().split('T')[0];
  if (value === 'yesterday') {
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  }
  return value;
}

/** Build the canonical display string for a MailSearchQuery. */
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

// ── Component ─────────────────────────────────────────────────────────────────

export interface MailSearchBarProps {
  /** Current active query (null = not in search mode). */
  activeQuery: MailSearchQuery | null;
  onSearch: (query: MailSearchQuery | null) => void;
}

interface Chip {
  key: string;
  label: string;
  queryKey: keyof MailSearchQuery;
}

export function MailSearchBar({ activeQuery, onSearch }: MailSearchBarProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState('');
  const [focused, setFocused] = useState(false);

  // Keep input in sync when activeQuery changes externally (e.g. clear)
  useEffect(() => {
    if (!activeQuery) {
      setInputValue('');
    }
  }, [activeQuery]);

  // Global keyboard shortcut: ⌘F / Ctrl+F → focus the search bar
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
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Build chip list from the active query
  const chips: Chip[] = [];
  if (activeQuery) {
    const labels: Array<[keyof MailSearchQuery, string]> = [
      ['from',    t('mail.search.from',    'From')],
      ['to',      t('mail.search.to',      'To')],
      ['cc',      t('mail.search.cc',      'Cc')],
      ['bcc',     t('mail.search.bcc',     'Bcc')],
      ['subject', t('mail.search.subject', 'Subject')],
      ['folder',  t('mail.search.in',      'In')],
      ['date',    t('mail.search.date',    'Date')],
      ['text',    t('mail.search.text',    'Text')],
    ];
    for (const [qk, lbl] of labels) {
      const val = activeQuery[qk];
      if (val) chips.push({ key: `${qk}:${val}`, label: `${lbl}: ${val}`, queryKey: qk });
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const parsed = parseSearchInput(inputValue);
      // Resolve date aliases before passing to providers
      if (parsed.date) parsed.date = resolveDateToken(parsed.date);
      console.log('[MailSearch] input:', JSON.stringify(inputValue));
      console.log('[MailSearch] parsed query:', JSON.stringify(parsed));
      console.log('[MailSearch] isEmpty:', isQueryEmpty(parsed));
      if (isQueryEmpty(parsed)) {
        onSearch(null);
      } else {
        onSearch(parsed);
      }
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      onSearch(null);
      setInputValue('');
      inputRef.current?.blur();
    }
  };

  const removeChip = (queryKey: keyof MailSearchQuery) => {
    if (!activeQuery) return;
    const next = { ...activeQuery };
    delete next[queryKey];
    if (isQueryEmpty(next)) {
      onSearch(null);
      setInputValue('');
    } else {
      onSearch(next);
      setInputValue(queryToString(next));
    }
  };

  const clearAll = () => {
    onSearch(null);
    setInputValue('');
    inputRef.current?.focus();
  };

  const isActive = activeQuery && !isQueryEmpty(activeQuery);
  const showChips = isActive && chips.length > 0;
  const showShortcut = !focused && !isActive && !inputValue;

  return (
    <div className={`mail-search-bar${isActive ? ' mail-search-bar--active' : ''}${focused ? ' mail-search-bar--focused' : ''}`}>
      <Search size={14} className="mail-search-bar__icon" />

      {showChips ? (
        <div className="mail-search-bar__chips">
          {chips.map(chip => (
            <span key={chip.key} className="mail-search-chip">
              {chip.label}
              <button
                type="button"
                className="mail-search-chip__remove"
                onClick={() => removeChip(chip.queryKey)}
                aria-label={t('mail.search.removeFilter', 'Remove filter')}
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <input
          ref={inputRef}
          type="text"
          className="mail-search-bar__input"
          value={inputValue}
          placeholder={t('mail.search.placeholder', 'Search… (from:, to:, cc:, in:, date:)')}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          aria-label={t('mail.search.label', 'Search mail')}
        />
      )}

      {showShortcut && (
        <span className="mail-search-bar__shortcut">⌘F</span>
      )}

      {(isActive || inputValue) && (
        <button
          type="button"
          className="mail-search-bar__clear"
          onClick={clearAll}
          aria-label={t('mail.search.clear', 'Clear search')}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
