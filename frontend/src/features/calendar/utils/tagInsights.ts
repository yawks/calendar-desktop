import { CalendarConfig, CalendarEvent, EventTagMapping, Tag } from '../../../shared/types';

export function calculateTagInsights(
  events: CalendarEvent[],
  eventTags: EventTagMapping,
  tags: Tag[],
  range?: { start: Date; end: Date },
  calendars?: CalendarConfig[],
) {
  const intervals = events.flatMap((event) => {
    if (calendars?.some(cal => cal.id === event.calendarId && cal.shared)) return [];
    if (event.isAllday || event.isCancelled || event.isDeclined || event.isUnaccepted
      || (event.selfRsvpStatus && event.selfRsvpStatus !== 'ACCEPTED')) return [];
    const start = Math.max(Date.parse(event.start), range?.start.getTime() ?? -Infinity);
    const end = Math.min(Date.parse(event.end), range?.end.getTime() ?? Infinity);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return [];
    const key = event.seriesId || event.sourceId || event.id;
    const tagId = eventTags[key] ?? event.tagId;
    return [{ start, end, tagId }];
  });
  const boundaries = intervals.flatMap(({ start, end }, index) => [
    { time: start, index, start: true },
    { time: end, index, start: false },
  ]).sort((a, b) => a.time - b.time);
  const active = new Set<number>();
  const durations = new Map<string | null | undefined, number>();
  let totalMs = 0;
  let previousTime = boundaries[0]?.time ?? 0;
  for (const boundary of boundaries) {
    if (active.size > 0 && boundary.time > previousTime) {
      // Input order breaks ties: each occupied slot belongs to just one event.
      const tagId = intervals[Math.min(...active)].tagId;
      const duration = boundary.time - previousTime;
      durations.set(tagId, (durations.get(tagId) ?? 0) + duration);
      totalMs += duration;
    }
    if (boundary.start) active.add(boundary.index);
    else active.delete(boundary.index);
    previousTime = boundary.time;
  }
  const rows = tags.map((tag) => ({ tag, durationMs: durations.get(tag.id) ?? 0 }))
    .filter(({ durationMs }) => durationMs > 0)
    .sort((a, b) => b.durationMs - a.durationMs);
  const untaggedMs = (durations.get(undefined) ?? 0) + (durations.get(null) ?? 0);
  return { rows, untaggedMs, totalMs, eventCount: intervals.length };
}
