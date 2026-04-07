import { useMemo, useState } from 'react';
import { CalendarConfig, CalendarGroup, CalendarEvent, Tag, EventTagMapping } from '../../../shared/types';

interface Props {
  events: CalendarEvent[];
  eventTags: EventTagMapping;
  tags: Tag[];
  calendars: CalendarConfig[];
  groups: CalendarGroup[];
  viewRange?: { start: Date; end: Date };
}

function getEventKey(event: CalendarEvent): string | undefined {
  return event.seriesId || event.sourceId || event.id;
}

/** Merge overlapping [start, end] intervals and return total duration in ms. */
function mergedDurationMs(intervals: [number, number][]): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let totalMs = 0;
  let curStart = sorted[0][0];
  let curEnd = sorted[0][1];
  for (let i = 1; i < sorted.length; i++) {
    const [s, e] = sorted[i];
    if (s < curEnd) {
      // overlapping: extend current window
      curEnd = Math.max(curEnd, e);
    } else {
      totalMs += curEnd - curStart;
      curStart = s;
      curEnd = e;
    }
  }
  totalMs += curEnd - curStart;
  return totalMs;
}

function formatDuration(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 1) return '< 1min';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h${m < 10 ? '0' : ''}${m}`;
}

export default function TagInsightsView({ events, eventTags, tags, calendars, groups, viewRange }: Props) {
  const [selectedGroupId, setSelectedGroupId] = useState<string>(
    () => localStorage.getItem('insights-group') ?? ''
  );
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>(
    () => localStorage.getItem('insights-calendar') ?? ''
  );

  const availableCalendars = useMemo(() => {
    if (!selectedGroupId) return calendars;
    return calendars.filter((c) => (c.groupId ?? 'default') === selectedGroupId);
  }, [calendars, selectedGroupId]);

  const handleGroupChange = (groupId: string) => {
    setSelectedGroupId(groupId);
    localStorage.setItem('insights-group', groupId);
    if (selectedCalendarId) {
      const cal = calendars.find((c) => c.id === selectedCalendarId);
      if (cal && groupId && (cal.groupId ?? 'default') !== groupId) {
        setSelectedCalendarId('');
        localStorage.setItem('insights-calendar', '');
      }
    }
  };

  const filtered = useMemo(() => {
    return events.filter((event) => {
      if (event.isDeclined) return false;
      if (event.isAllday) return false;
      const cal = calendars.find((c) => c.id === event.calendarId);
      if (!cal) return false;
      if (selectedCalendarId && event.calendarId !== selectedCalendarId) return false;
      if (selectedGroupId && (cal.groupId ?? 'default') !== selectedGroupId) return false;
      if (viewRange) {
        const evStart = new Date(event.start).getTime();
        const evEnd = new Date(event.end).getTime();
        if (evStart > viewRange.end.getTime() || evEnd < viewRange.start.getTime()) return false;
      }
      return true;
    });
  }, [events, calendars, selectedGroupId, selectedCalendarId, viewRange]);

  const stats = useMemo(() => {
    // Collect intervals per tag (tagId → list of [startMs, endMs])
    const intervalsByTag: Record<string, [number, number][]> = {};
    const untaggedIntervals: [number, number][] = [];
    const allIntervals: [number, number][] = [];

    filtered.forEach((event) => {
      const key = getEventKey(event);
      const tagId = key ? eventTags[key] : undefined;
      const startMs = new Date(event.start).getTime();
      const endMs = new Date(event.end).getTime();
      if (startMs >= endMs) return; // skip zero-duration events

      allIntervals.push([startMs, endMs]);

      if (tagId) {
        if (!intervalsByTag[tagId]) intervalsByTag[tagId] = [];
        intervalsByTag[tagId].push([startMs, endMs]);
      } else {
        untaggedIntervals.push([startMs, endMs]);
      }
    });

    // Total = globally merged duration (stable regardless of tagging)
    const totalMs = mergedDurationMs(allIntervals);

    // Compute merged duration per tag
    const rows = tags
      .map((tag) => ({
        tag,
        durationMs: mergedDurationMs(intervalsByTag[tag.id] ?? []),
      }))
      .filter((r) => r.durationMs > 0)
      .sort((a, b) => b.durationMs - a.durationMs);

    const untaggedMs = mergedDurationMs(untaggedIntervals);

    return { rows, untaggedMs, totalMs, eventCount: filtered.length };
  }, [filtered, eventTags, tags]);

  const { rows, untaggedMs, totalMs, eventCount } = stats;
  const hasData = totalMs > 0;

  return (
    <div style={{ padding: '4px 8px 8px' }}>
      {/* Filters */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
        <select
          value={selectedGroupId}
          onChange={(e) => handleGroupChange(e.target.value)}
          className="insights-select"
        >
          <option value="">Tous les groupes</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
        <select
          value={selectedCalendarId}
          onChange={(e) => {
            setSelectedCalendarId(e.target.value);
            localStorage.setItem('insights-calendar', e.target.value);
          }}
          className="insights-select"
        >
          <option value="">Tous les calendriers</option>
          {availableCalendars.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* Summary */}
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
        {eventCount} événement{eventCount !== 1 ? 's' : ''}
        {hasData && <> · {formatDuration(totalMs)} au total</>}
      </div>

      {!hasData ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
          Aucun événement
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map(({ tag, durationMs }) => (
            <StatRow
              key={tag.id}
              color={tag.color}
              label={tag.name}
              durationMs={durationMs}
              totalMs={totalMs}
            />
          ))}
          {untaggedMs > 0 && (
            <StatRow
              color="var(--text-muted)"
              label="Sans tag"
              durationMs={untaggedMs}
              totalMs={totalMs}
              muted
            />
          )}
        </div>
      )}
    </div>
  );
}

interface StatRowProps {
  color: string;
  label: string;
  durationMs: number;
  totalMs: number;
  muted?: boolean;
}

function StatRow({ color, label, durationMs, totalMs, muted }: StatRowProps) {
  const pct = totalMs > 0 ? Math.round((durationMs / totalMs) * 100) : 0;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: color,
            flexShrink: 0,
            opacity: muted ? 0.5 : 1,
          }}
        />
        <span
          style={{
            fontSize: 12,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: muted ? 'var(--text-muted)' : undefined,
          }}
        >
          {label}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
          {formatDuration(durationMs)} <span style={{ opacity: 0.6 }}>({pct}%)</span>
        </span>
      </div>
      <div
        style={{
          height: 4,
          borderRadius: 2,
          backgroundColor: 'var(--border)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            borderRadius: 2,
            backgroundColor: color,
            opacity: muted ? 0.4 : 0.85,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
    </div>
  );
}
