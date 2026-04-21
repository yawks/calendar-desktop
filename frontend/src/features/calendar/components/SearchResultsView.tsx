import { ArrowLeft, Calendar, Clock, MapPin, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CalendarConfig, CalendarEvent } from '../../../shared/types';

interface Props {
  readonly query: string;
  readonly events: CalendarEvent[];
  readonly calendars: CalendarConfig[];
  readonly onClose: () => void;
  readonly onEventClick: (event: CalendarEvent) => void;
}

function matchesQuery(event: CalendarEvent, q: string): boolean {
  const lower = q.toLowerCase();
  if (event.title.toLowerCase().includes(lower)) return true;
  if (event.attendees?.some((a) =>
    a.name.toLowerCase().includes(lower) || a.email.toLowerCase().includes(lower)
  )) return true;
  return false;
}

function formatEventDateTime(event: CalendarEvent): string {
  const start = new Date(event.start);
  if (Number.isNaN(start.getTime())) return '';
  if (event.isAllday) {
    return start.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  const end = new Date(event.end);
  const datePart = start.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const startTime = start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const endTime = end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${datePart} · ${startTime} – ${endTime}`;
}

function groupByMonth(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const groups = new Map<string, CalendarEvent[]>();
  for (const ev of events) {
    const d = new Date(ev.start);
    const key = Number.isNaN(d.getTime())
      ? '?'
      : d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(ev);
  }
  return groups;
}

export default function SearchResultsView({ query, events, calendars, onClose, onEventClick }: Props) {
  const { t } = useTranslation();

  const results = events
    .filter((e) => matchesQuery(e, query))
    .sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());

  const groups = groupByMonth(results);

  return (
    <div className="search-results-view">
      <div className="search-results-header">
        <button className="search-results-back btn-icon" onClick={onClose} title={t('search.backToCalendar')}>
          <ArrowLeft size={20} />
        </button>
        <span className="search-results-title">
          {t('search.resultsTitle', { query })}
        </span>
        <span className="search-results-count">
          {t('search.resultsCount', { count: results.length })}
        </span>
      </div>

      {results.length === 0 ? (
        <div className="search-results-empty">
          <Calendar size={40} strokeWidth={1} />
          <p>{t('search.noResults', { query })}</p>
        </div>
      ) : (
        <div className="search-results-list">
          {[...groups.entries()].map(([month, evs]) => (
            <div key={month} className="search-results-group">
              <div className="search-results-month">{month}</div>
              {evs.map((ev) => {
                const cal = calendars.find((c) => c.id === ev.calendarId);
                return (
                  <button
                    key={ev.id}
                    className="search-result-item"
                    onClick={() => onEventClick(ev)}
                  >
                    <span
                      className="search-result-dot"
                      style={{ background: cal?.color ?? '#888' }}
                    />
                    <span className="search-result-body">
                      <span className="search-result-title">{ev.title}</span>
                      <span className="search-result-details">
                        <span className="search-result-detail">
                          <Clock size={12} />
                          {formatEventDateTime(ev)}
                        </span>
                        {ev.location && (
                          <span className="search-result-detail">
                            <MapPin size={12} />
                            {ev.location}
                          </span>
                        )}
                        {ev.attendees && ev.attendees.length > 0 && (
                          <span className="search-result-detail">
                            <Users size={12} />
                            {t('search.attendeeCount', { count: ev.attendees.length })}
                          </span>
                        )}
                        {cal && (
                          <span className="search-result-cal">{cal.name}</span>
                        )}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
