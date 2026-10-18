import { useEffect, useMemo, useRef, useState } from 'react';
import { Cloud, Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCalendars } from '../store/CalendarStore';
import { useGoogleAuth } from '../../../shared/store/GoogleAuthStore';
import { useExchangeAuth } from '../../../shared/store/ExchangeAuthStore';
import { isValidEmail } from '../../mail/utils';
import { discoverSharedCalendars, sharedCalendarErrorKey, sameCalendar, searchSharedPeople, type SharedCalendarSource, type SharedPerson, type SharedDiscovery } from '../utils/sharedCalendars';

function SourceIcon({ source }: { source: SharedCalendarSource }) {
  const icon = source.type === 'google'
    ? <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true"><path d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.482h4.844a4.14 4.14 0 0 1-1.797 2.715v2.258h2.909c1.702-1.567 2.684-3.875 2.684-6.614ZM9 18c2.43 0 4.467-.806 5.956-2.181l-2.909-2.258c-.806.54-1.837.859-3.047.859-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A9 9 0 0 0 9 18ZM3.964 10.709A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.709V4.959H.957A9 9 0 0 0 0 9c0 1.452.347 2.827.957 4.041l3.007-2.332ZM9 3.58c1.321 0 2.507.454 3.44 1.346l2.581-2.581C13.463.892 11.43 0 9 0A9 9 0 0 0 .957 4.959l3.007 2.332C4.672 5.164 6.656 3.58 9 3.58Z" /></svg>
    : source.type === 'exchange'
      ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M10 4h11v16H10M11 8l5 4 5-4M2 5l10-2v18L2 19Z" /><ellipse cx="7" cy="12" rx="2.3" ry="3.2" /></svg>
      : <Cloud size={18} aria-hidden="true" />;
  return <span className="shared-calendar-source-icon" style={{ color: source.color }} title={source.name}>{icon}</span>;
}
interface Suggestion { source: SharedCalendarSource; person: SharedPerson }

export default function SharedCalendarModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { calendars, addCalendar } = useCalendars();
  const google = useGoogleAuth();
  const exchange = useExchangeAuth();
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ discovery: SharedDiscovery; source: SharedCalendarSource; person: SharedPerson } | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [added, setAdded] = useState(0);
  const requestId = useRef(0);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const tokenGetters = useRef({ google: google.getValidToken, exchange: exchange.getValidToken });
  tokenGetters.current = { google: google.getValidToken, exchange: exchange.getValidToken };
  // Account token refreshes must not restart a pending directory search.
  const sourceKey = JSON.stringify([
    google.accounts.map(({ id, email, color, enabledCapabilities }) => ({ id, email, color, enabledCapabilities })),
    exchange.accounts.map(({ id, email, color, enabledCapabilities }) => ({ id, email, color, enabledCapabilities })),
    calendars.filter(cal => cal.type === 'nextcloud' && !cal.shared),
  ]);
  const sources = useMemo<SharedCalendarSource[]>(() => [
    ...google.accounts.filter(account => !account.enabledCapabilities || account.enabledCapabilities.includes('calendar')).map(account => ({
      id: account.id, type: 'google' as const, name: `Google — ${account.email}`, color: account.color || calendars.find(cal => cal.googleAccountId === account.id)?.color || 'var(--primary)',
      getToken: () => tokenGetters.current.google(account.id),
    })),
    ...exchange.accounts.filter(account => !account.enabledCapabilities || account.enabledCapabilities.includes('calendar')).map(account => ({
      id: account.id, type: 'exchange' as const, name: `Exchange — ${account.email}`, color: account.color || calendars.find(cal => cal.exchangeAccountId === account.id)?.color || 'var(--primary)',
      getToken: () => tokenGetters.current.exchange(account.id),
    })),
    ...calendars.filter(cal => cal.type === 'nextcloud' && !cal.shared).filter((cal, index, all) => all.findIndex(other => other.nextcloudServerUrl === cal.nextcloudServerUrl && other.nextcloudUsername === cal.nextcloudUsername && (other.nextcloudServerUrl || other.url === cal.url)) === index).map(cal => ({
      id: cal.id, type: 'nextcloud' as const, name: `CalDAV — ${cal.name}`, color: cal.color, calendar: cal,
    })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [sourceKey]);

  useEffect(() => {
    const node = dialog.current!;
    const opener = document.activeElement as HTMLElement | null;
    node.showModal();
    return () => { requestId.current++; node.close(); opener?.focus(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const trimmed = query.trim();
    setSuggestions([]); setFailedSources([]); setActiveIndex(-1);
    if (trimmed.length < 2 || result || !sources.length) { setSearching(false); return; }
    setSearching(true);
    const timer = setTimeout(async () => {
      const responses = await Promise.allSettled(sources.map(source => searchSharedPeople(source, trimmed)));
      if (cancelled) return;
      setSuggestions(responses.flatMap((response, index) => response.status === 'fulfilled'
        ? response.value.people.filter(person => isValidEmail(person.email)).slice(0, 10).map(person => ({ source: sources[index], person })) : []));
      setFailedSources(responses.flatMap((response, index) => response.status === 'rejected' || response.value.directoryUnavailable ? [sources[index].name] : []));
      setSearching(false);
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, sources, result]);

  const choices = useMemo(() => {
    const contacts = [...suggestions];
    if (isValidEmail(query.trim())) for (const source of sources) {
      if (!contacts.some(choice => choice.source.id === source.id && choice.source.type === source.type && choice.person.email.toLowerCase() === query.trim().toLowerCase())) {
        contacts.push({ source, person: { email: query.trim() } });
      }
    }
    return contacts;
  }, [query, suggestions, sources]);

  useEffect(() => {
    if (activeIndex >= 0) document.getElementById(`shared-calendar-suggestion-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const lookup = async ({ source, person }: Suggestion) => {
    const id = ++requestId.current;
    setLoading(true); setError(''); setResult(null); setSelected({}); setAdded(0);
    try {
      const discovery = await discoverSharedCalendars(source, person);
      if (id !== requestId.current) return;
      setResult({ discovery, source, person });
      setTimeout(() => resultRef.current?.focus(), 0);
    } catch (error) {
      if (id === requestId.current) setError(t(sharedCalendarErrorKey(source, error)));
    } finally { if (id === requestId.current) setLoading(false); }
  };
  const save = () => {
    if (!result) return;
    let count = 0;
    for (const choice of result.discovery.calendars) {
      if (!selected[choice.key] || calendars.some(cal => sameCalendar(cal, choice.calendar))) continue;
      addCalendar({ ...choice.calendar, color: selected[choice.key] }); count++;
    }
    setAdded(count); setSelected({});
  };
  const reset = () => { requestId.current++; setResult(null); setError(''); setAdded(0); setSelected({}); setActiveIndex(-1); };

  return (
    <dialog ref={dialog} className="shared-calendar-dialog" onCancel={onClose} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }} onClick={event => { if (event.target === event.currentTarget) onClose(); }} aria-labelledby="shared-calendar-title">
      <div className="shared-calendar-modal">
        <header className="shared-calendar-header">
          <h2 id="shared-calendar-title">{t('sharedCalendars.add')}</h2>
          <button type="button" className="btn-ghost" aria-label={t('sharedCalendars.close')} title={t('sharedCalendars.close')} onClick={onClose}><X size={18} /></button>
        </header>
        <div className="shared-calendar-body config-form">
          <p className="shared-calendar-help">{t('sharedCalendars.description')}</p>
          {!sources.length && <p role="status">{t('sharedCalendars.noSources')}</p>}
          <label className="shared-calendar-field" htmlFor="shared-calendar-search">
            <span>{t('sharedCalendars.search')}</span>
            <input id="shared-calendar-search" type="search" role="combobox" autoComplete="off" autoFocus value={query} disabled={!sources.length || loading}
              aria-autocomplete="list" aria-expanded={!result && choices.length > 0} aria-controls="shared-calendar-suggestions"
              aria-activedescendant={!result && activeIndex >= 0 ? `shared-calendar-suggestion-${activeIndex}` : undefined}
              onChange={event => { reset(); setQuery(event.target.value); }}
              onKeyDown={event => {
                if (result || !choices.length) return;
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault(); setActiveIndex(index => index < 0 ? event.key === 'ArrowDown' ? 0 : choices.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length);
                }
                if (event.key === 'Enter' && activeIndex >= 0) { event.preventDefault(); void lookup(choices[activeIndex]); }
              }} />
          </label>
          {!result && <div id="shared-calendar-suggestions" role="listbox" aria-label={t('sharedCalendars.suggestions')} className="shared-calendar-suggestions">
            {choices.map((choice, index) => <button type="button" role="option" aria-selected={activeIndex === index} id={`shared-calendar-suggestion-${index}`} key={`${choice.source.type}:${choice.source.id}:${choice.person.email}`}
              className="shared-calendar-suggestion" disabled={loading} aria-busy={loading} onClick={() => void lookup(choice)}>
              <SourceIcon source={choice.source} />
              <span><strong>{choice.person.name || choice.person.email}</strong><span>{choice.person.name ? `${choice.person.email} · ` : ''}{choice.source.name}</span></span>
            </button>)}
          </div>}
          {!result && <p className="shared-calendar-help" role="status">{loading ? t('sharedCalendars.discovering') : searching ? t('sharedCalendars.searching') : query.trim().length >= 2 && !choices.length && !failedSources.length ? t('sharedCalendars.noMatches') : t('sharedCalendars.emailHelp')}</p>}
          {!result && failedSources.length > 0 && !loading && <p className="shared-calendar-help">{t('sharedCalendars.directoryUnavailable', { sources: failedSources.join(', ') })}</p>}
          {loading && <Loader2 size={18} className="shared-calendar-spinner" aria-hidden="true" />}
          {error && <p className="shared-calendar-error" role="alert">{error}</p>}
          {result && <section className="shared-calendar-results" aria-labelledby="shared-calendar-result-title">
            <h3 id="shared-calendar-result-title" ref={resultRef} tabIndex={-1}>{t('sharedCalendars.available', { person: result.person.name || result.person.email })}</h3>
            <p className="shared-calendar-help">{result.source.name}</p>
            {result.discovery.limited && <p className="shared-calendar-help">{t(result.source.type === 'google' ? 'sharedCalendars.googleLimit' : 'sharedCalendars.discoveryLimit')}</p>}
            {result.discovery.calendars.map(choice => {
              const exists = calendars.some(cal => sameCalendar(cal, choice.calendar));
              return <div className="shared-calendar-choice" key={choice.key}>
                <label className="shared-calendar-check"><input type="checkbox" checked={exists || !!selected[choice.key]} disabled={exists} onChange={event => setSelected(current => {
                  const next = { ...current }; if (event.target.checked) next[choice.key] = /^#[\da-f]{6}$/i.test(choice.calendar.color) ? choice.calendar.color : '#1a73e8'; else delete next[choice.key]; return next;
                })} /><span>{choice.calendar.name}{exists && <small>{t('sharedCalendars.alreadyAdded')}</small>}</span></label>
                {!exists && <label className="shared-calendar-color"><span>{t('sharedCalendars.color')}</span><input type="color" aria-label={t('sharedCalendars.calendarColor', { name: choice.calendar.name })} value={selected[choice.key] || (/^#[\da-f]{6}$/i.test(choice.calendar.color) ? choice.calendar.color : '#1a73e8')} disabled={!selected[choice.key]} onChange={event => setSelected(current => ({ ...current, [choice.key]: event.target.value }))} /></label>}
              </div>;
            })}
            {added > 0 && <p role="status">{t('sharedCalendars.added', { count: added })}</p>}
          </section>}
        </div>
        <footer className="shared-calendar-actions">
          {result && <button type="button" className="btn-primary" disabled={!Object.keys(selected).length} onClick={save}>{t('sharedCalendars.addSelected')}</button>}
          {result && <button type="button" className="btn-ghost" onClick={reset}>{t('sharedCalendars.otherPerson')}</button>}
          <button type="button" className="btn-ghost" onClick={onClose}>{t('sharedCalendars.close')}</button>
        </footer>
      </div>
    </dialog>
  );
}
