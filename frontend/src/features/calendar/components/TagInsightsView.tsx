import { useMemo, useState } from 'react';
import { calculateTagInsights } from '../utils/tagInsights';
import { CalendarConfig, CalendarGroup, CalendarEvent, Tag, EventTagMapping } from '../../../shared/types';
import { useTranslation } from 'react-i18next';

interface Props {
  events: CalendarEvent[];
  eventTags: EventTagMapping;
  tags: Tag[];
  calendars: CalendarConfig[];
  groups: CalendarGroup[];
  viewRange?: { start: Date; end: Date };
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
  const { t } = useTranslation();
  const [selectedGroupId, setSelectedGroupId] = useState<string>(
    () => localStorage.getItem('insights-group') ?? ''
  );
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>(
    () => localStorage.getItem('insights-calendar') ?? ''
  );

  const availableCalendars = useMemo(() => {
    if (!selectedGroupId) return calendars.filter(cal => !cal.shared);
    return calendars.filter((c) => !c.shared && (c.groupId ?? 'default') === selectedGroupId);
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
      const cal = calendars.find((c) => c.id === event.calendarId);
      if (!cal || cal.shared) return false;
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

  const stats = useMemo(
    () => calculateTagInsights(filtered, eventTags, tags, viewRange, calendars),
    [filtered, eventTags, tags, viewRange, calendars]
  );

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
          <option value="">{t('insights.allGroups')}</option>
          {groups.filter(g => g.id !== 'other-calendars').map((g) => (
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
          <option value="">{t('insights.allCalendars')}</option>
          {availableCalendars.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* Summary */}
      <div style={{ fontSize: 'calc(11px * var(--font-scale, 1))', color: 'var(--text-muted)', marginBottom: 8 }}>
        {t('insights.eventCount', { count: eventCount })}
        {hasData && <> · {t('insights.totalDuration', { duration: formatDuration(totalMs) })}</>}
      </div>

      {!hasData ? (
        <div style={{ fontSize: 'calc(12px * var(--font-scale, 1))', color: 'var(--text-muted)', fontStyle: 'italic' }}>
          {t('insights.noEvents')}
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
              label={t('insights.withoutTag')}
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
            fontSize: 'calc(12px * var(--font-scale, 1))',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: muted ? 'var(--text-muted)' : undefined,
          }}
        >
          {label}
        </span>
        <span style={{ fontSize: 'calc(11px * var(--font-scale, 1))', color: 'var(--text-muted)', flexShrink: 0 }}>
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
