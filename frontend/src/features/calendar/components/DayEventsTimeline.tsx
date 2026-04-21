import { useMemo } from 'react';
import { CalendarEvent, CalendarConfig } from '../../../shared/types';
import './DayEventsTimeline.css';

// Timeline covers 07:00 → 23:00
const HOUR_START = 7;
const HOUR_END = 23;
const TOTAL_HOURS = HOUR_END - HOUR_START; // 16
const ROW_PX = 32; // pixels per hour
const TOTAL_PX = TOTAL_HOURS * ROW_PX; // 512px
const PX_PER_MIN = TOTAL_PX / (TOTAL_HOURS * 60); // 32/60 ≈ 0.533

function hexToRgba(hex: string, alpha: number): string {
  const re = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
  const m = re.exec(hex.trim());
  if (!m) return hex;
  return `rgba(${Number.parseInt(m[1], 16)}, ${Number.parseInt(m[2], 16)}, ${Number.parseInt(m[3], 16)}, ${alpha})`;
}

function toMinFromStart(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes() - HOUR_START * 60;
}

/** Clamp [min, max] */
function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

interface Placed {
  ev: CalendarEvent;
  topPx: number;
  heightPx: number;
  color: string;
  isHighlighted: boolean;
  leftPct: number;
  widthPct: number;
  bgColor: string;
  textColor: string;
}

/** Assign non-overlapping column indices */
function assignColumns(
  items: { startMin: number; endMin: number }[]
): Array<{ col: number; maxCol: number }> {
  const cols: number[] = new Array(items.length).fill(0);

  for (let i = 0; i < items.length; i++) {
    const usedBefore = new Set<number>();
    for (let j = 0; j < i; j++) {
      if (items[j].endMin > items[i].startMin && items[j].startMin < items[i].endMin) {
        usedBefore.add(cols[j]);
      }
    }
    let c = 0;
    while (usedBefore.has(c)) c++;
    cols[i] = c;
  }

  return items.map((_, i) => {
    let maxCol = cols[i];
    for (let j = 0; j < items.length; j++) {
      if (items[j].endMin > items[i].startMin && items[j].startMin < items[i].endMin) {
        maxCol = Math.max(maxCol, cols[j]);
      }
    }
    return { col: cols[i], maxCol };
  });
}

export interface DayEventsTimelineProps {
  readonly events: CalendarEvent[];
  readonly calendars: CalendarConfig[];
  readonly targetDate: Date;
  /** ID of the calendar event matching the ICS invitation — shown with a distinct frame */
  readonly highlightedEventId?: string;
  readonly loading?: boolean;
}

export function DayEventsTimeline({
  events, calendars, targetDate, highlightedEventId, loading,
}: DayEventsTimelineProps) {
  const hours = useMemo(() => {
    const h: number[] = [];
    for (let i = HOUR_START; i <= HOUR_END; i++) h.push(i);
    return h;
  }, []);

  const placed = useMemo((): Placed[] => {
    const dayStart = new Date(targetDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(targetDate);
    dayEnd.setHours(23, 59, 59, 999);

    const timed = events.filter(ev => {
      if (ev.isAllday) return false;
      const s = new Date(ev.start);
      const e = new Date(ev.end);
      // Overlaps with the target day
      return s < dayEnd && e > dayStart
        // And at least starts on the target day (skip multi-day events that just overflow)
        && s.toDateString() === targetDate.toDateString();
    });

    const sorted = [...timed].sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
    );

    const spans = sorted.map(ev => ({
      startMin: clamp(toMinFromStart(ev.start), 0, TOTAL_HOURS * 60),
      endMin:   clamp(toMinFromStart(ev.end),   0, TOTAL_HOURS * 60),
    }));

    const colInfo = assignColumns(spans);
    const now = new Date();

    return sorted.map((ev, i) => {
      const { startMin, endMin } = spans[i];
      const { col, maxCol } = colInfo[i];
      const totalCols = maxCol + 1;

      const cal = calendars.find(c => c.id === ev.calendarId);
      const color = cal?.color ?? '#888';
      const isHighlighted = ev.id === highlightedEventId;
      const isPast = new Date(ev.end) < now;

      let bgColor: string;
      let textColor: string;
      if (isHighlighted) {
        bgColor = 'transparent';
        textColor = color;
      } else if (isPast) {
        bgColor = hexToRgba(color, 0.22);
        textColor = color;
      } else {
        bgColor = color;
        textColor = '#fff';
      }

      const topPx    = startMin * PX_PER_MIN;
      const heightPx = Math.max(ROW_PX * 0.4, (endMin - startMin) * PX_PER_MIN);
      const widthPct = 100 / totalCols;
      const leftPct  = col * widthPct;

      return { ev, topPx, heightPx, color, isHighlighted, leftPct, widthPct, bgColor, textColor };
    });
  }, [events, calendars, targetDate, highlightedEventId]);

  if (loading) {
    return (
      <div className="det-container">
        <div className="det-skeleton" />
      </div>
    );
  }

  const dateLabel = targetDate.toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  return (
    <div className="det-container">
      <div className="det-date-label">{dateLabel}</div>
      <div className="det-scroll">
        <div className="det-inner" style={{ height: `${TOTAL_PX + ROW_PX}px` }}>
          {/* Hour lines */}
          <div className="det-hours">
            {hours.map(h => (
              <div key={h} className="det-hour-row" style={{ height: `${ROW_PX}px` }}>
                <span className="det-hour-label">
                  {String(h).padStart(2, '0')}h
                </span>
                <div className="det-hour-line" />
              </div>
            ))}
          </div>

          {/* Absolute events layer */}
          <div className="det-events-layer">
            {placed.map(({ ev, topPx, heightPx, color, isHighlighted, leftPct, widthPct, bgColor, textColor }) => (
              <div
                key={ev.id}
                className={`det-event${isHighlighted ? ' det-event--highlighted' : ''}`}
                title={`${ev.title}\n${new Date(ev.start).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} – ${new Date(ev.end).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`}
                style={{
                  top: `${topPx}px`,
                  height: `${heightPx}px`,
                  left: `calc(${leftPct}% + 1px)`,
                  width: `calc(${widthPct}% - 3px)`,
                  backgroundColor: bgColor,
                  color: textColor,
                  borderColor: color,
                  outlineColor: isHighlighted ? color : undefined,
                }}
              >
                <span className="det-event-title">{ev.title}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
