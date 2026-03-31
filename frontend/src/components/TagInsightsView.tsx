import { useMemo, useState } from 'react';
import { CalendarConfig, CalendarGroup, CalendarEvent, Tag, EventTagMapping } from '../types';

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

export default function TagInsightsView({ events, eventTags, tags, calendars, groups, viewRange }: Props) {
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>('');

  // Calendars available given selected group
  const availableCalendars = useMemo(() => {
    if (!selectedGroupId) return calendars;
    return calendars.filter((c) => (c.groupId ?? 'default') === selectedGroupId);
  }, [calendars, selectedGroupId]);

  // Reset calendar filter when group changes and current calendar no longer belongs
  const handleGroupChange = (groupId: string) => {
    setSelectedGroupId(groupId);
    if (selectedCalendarId) {
      const cal = calendars.find((c) => c.id === selectedCalendarId);
      if (cal && groupId && (cal.groupId ?? 'default') !== groupId) {
        setSelectedCalendarId('');
      }
    }
  };

  const filtered = useMemo(() => {
    return events.filter((event) => {
      if (event.isDeclined) return false;
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
    const counts: Record<string, number> = {};
    let untagged = 0;

    filtered.forEach((event) => {
      const key = getEventKey(event);
      const tagId = key ? eventTags[key] : undefined;
      if (tagId) {
        counts[tagId] = (counts[tagId] ?? 0) + 1;
      } else {
        untagged++;
      }
    });

    const total = filtered.length;

    const rows = tags
      .map((tag) => ({ tag, count: counts[tag.id] ?? 0 }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count);

    return { rows, untagged, total };
  }, [filtered, eventTags, tags]);

  const { rows, untagged, total } = stats;

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
          onChange={(e) => setSelectedCalendarId(e.target.value)}
          className="insights-select"
        >
          <option value="">Tous les calendriers</option>
          {availableCalendars.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* Total */}
      <div style={{ fontSize: 11, color: 'var(--text-secondary, #888)', marginBottom: 8 }}>
        {total} événement{total !== 1 ? 's' : ''} dans la vue courante
      </div>

      {total === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-secondary, #888)', fontStyle: 'italic' }}>
          Aucun événement
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map(({ tag, count }) => (
            <StatRow
              key={tag.id}
              color={tag.color}
              label={tag.name}
              count={count}
              total={total}
            />
          ))}
          {untagged > 0 && (
            <StatRow
              color="var(--text-secondary, #888)"
              label="Sans tag"
              count={untagged}
              total={total}
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
  count: number;
  total: number;
  muted?: boolean;
}

function StatRow({ color, label, count, total, muted }: StatRowProps) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
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
            color: muted ? 'var(--text-secondary, #888)' : undefined,
          }}
        >
          {label}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-secondary, #888)', flexShrink: 0 }}>
          {count} <span style={{ opacity: 0.6 }}>({pct}%)</span>
        </span>
      </div>
      <div
        style={{
          height: 4,
          borderRadius: 2,
          backgroundColor: 'var(--border-color, rgba(128,128,128,0.15))',
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
