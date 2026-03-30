import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { FreeBusySlot } from '../utils/googleCalendarApi';

export interface FreeBusyRow {
  email: string;
  label: string;
  busy: FreeBusySlot[];
  /** Tentative / not-yet-accepted slots — shown with a hatched pattern */
  tentative: FreeBusySlot[];
  unavailable: boolean;
  isSelf: boolean;
}

interface Props {
  readonly rows: FreeBusyRow[];
  readonly windowStart: Date;
  readonly windowEnd: Date;
  readonly selectedStart: Date;
  readonly selectedEnd: Date;
  readonly loading: boolean;
  readonly onSelectTime?: (start: Date) => void;
}

function toPercent(date: Date, windowStart: Date, windowEnd: Date): number {
  const total = windowEnd.getTime() - windowStart.getTime();
  const offset = date.getTime() - windowStart.getTime();
  return Math.max(0, Math.min(100, (offset / total) * 100));
}

export default function FreeBusyGrid({
  rows,
  windowStart,
  windowEnd,
  selectedStart,
  selectedEnd,
  loading,
  onSelectTime,
}: Props) {
  const { t } = useTranslation();

  const hourMarkers = useMemo(() => {
    const markers: Array<{ label: string; percent: number }> = [];
    const cursor = new Date(windowStart);
    cursor.setMinutes(0, 0, 0);
    if (cursor.getTime() < windowStart.getTime()) {
      cursor.setHours(cursor.getHours() + 1);
    }
    while (cursor.getTime() <= windowEnd.getTime()) {
      const percent = toPercent(cursor, windowStart, windowEnd);
      markers.push({ label: `${String(cursor.getHours()).padStart(2, '0')}:00`, percent });
      cursor.setHours(cursor.getHours() + 2);
    }
    return markers;
  }, [windowStart, windowEnd]);

  const selectedLeft = toPercent(selectedStart, windowStart, windowEnd);
  const selectedRight = toPercent(selectedEnd, windowStart, windowEnd);
  const selectedWidth = Math.max(0, selectedRight - selectedLeft);

  function handleTimelineClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!onSelectTime) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const total = windowEnd.getTime() - windowStart.getTime();
    const clicked = new Date(windowStart.getTime() + ratio * total);
    // Round to nearest 15 minutes
    const rounded = new Date(Math.round(clicked.getTime() / (15 * 60 * 1000)) * (15 * 60 * 1000));
    onSelectTime(rounded);
  }

  return (
    <div className={`freebusy-grid${loading ? ' freebusy-grid--loading' : ''}`}>
      <div className="freebusy-section-title">
        {t('freeBusy.title')}
        {loading && <span className="freebusy-loading-dot" />}
      </div>

      {/* Time axis */}
      <div className="freebusy-axis">
        <div className="freebusy-label-col" />
        <div className="freebusy-timeline-col freebusy-axis-track">
          {hourMarkers.map((m) => (
            <span
              key={m.label}
              className="freebusy-axis-label"
              style={{ left: `${m.percent}%` }}
            >
              {m.label}
            </span>
          ))}
        </div>
      </div>

      {/* Person rows */}
      {rows.map((row) => (
        <div key={row.email} className="freebusy-row">
          <div className="freebusy-label-col" title={row.email}>
            <span className={`freebusy-label${row.isSelf ? ' freebusy-label--self' : ''}`}>
              {row.label}
            </span>
          </div>
          <div
            className={`freebusy-timeline-col freebusy-timeline${onSelectTime ? ' freebusy-timeline--clickable' : ''}`}
            onClick={handleTimelineClick}
            title={row.unavailable ? t('freeBusy.privateCalendar') : undefined}
          >
            {row.unavailable ? (
              <div className="freebusy-unavailable" title={t('freeBusy.privateCalendar')} />
            ) : (
              <>
                {row.busy.map((slot) => {
                  const left = toPercent(slot.start, windowStart, windowEnd);
                  const right = toPercent(slot.end, windowStart, windowEnd);
                  const width = right - left;
                  if (width <= 0) return null;
                  return (
                    <div
                      key={`busy-${slot.start.getTime()}`}
                      className="freebusy-busy"
                      style={{ left: `${left}%`, width: `${width}%` }}
                    />
                  );
                })}
                {row.tentative.map((slot) => {
                  const left = toPercent(slot.start, windowStart, windowEnd);
                  const right = toPercent(slot.end, windowStart, windowEnd);
                  const width = right - left;
                  if (width <= 0) return null;
                  return (
                    <div
                      key={`tentative-${slot.start.getTime()}`}
                      className="freebusy-tentative"
                      style={{ left: `${left}%`, width: `${width}%` }}
                    />
                  );
                })}
              </>
            )}
            {/* Selected time slot — spans full height via CSS */}
            {selectedWidth > 0 && (
              <div
                className="freebusy-selected"
                style={{ left: `${selectedLeft}%`, width: `${selectedWidth}%` }}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
