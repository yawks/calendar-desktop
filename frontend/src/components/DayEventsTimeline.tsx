import { useMemo } from 'react';
import { CalendarEvent, CalendarConfig } from '../types';

interface DayEventsTimelineProps {
  readonly date: Date;
  readonly events: CalendarEvent[];
  readonly calendars?: CalendarConfig[];
  readonly highlightedEventId?: string;
  readonly accentColor?: string;
}

export function DayEventsTimeline({ date, events, calendars, highlightedEventId, accentColor }: DayEventsTimelineProps) {
  const dayEvents = useMemo(() => {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    return events
      .filter(ev => {
        const s = new Date(ev.start);
        const e = new Date(ev.end);
        return s < endOfDay && e > startOfDay;
      })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  }, [date, events]);

  return (
    <div className="day-events-timeline">
      {dayEvents.length === 0 ? (
        <div className="day-events-timeline__empty">Aucun événement</div>
      ) : (
        dayEvents.map(ev => {
          const cal = calendars?.find(c => c.id === ev.calendarId);
          const color = cal?.color || accentColor || 'var(--primary)';
          const isHighlighted = highlightedEventId === ev.id;
          return (
            <div key={ev.id} className={`day-events-timeline__item${isHighlighted ? ' highlighted' : ''}`}>
               <div className="day-events-timeline__time">
                 {new Date(ev.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
               </div>
               <div className="day-events-timeline__title" style={{ borderLeftColor: color }}>{ev.title}</div>
            </div>
          );
        })
      )}
    </div>
  );
}
