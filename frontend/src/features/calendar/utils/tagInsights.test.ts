import { describe, expect, it } from 'vitest';
import { CalendarEvent, Tag } from '../../../shared/types';
import { calculateTagInsights } from './tagInsights';

const hour = 3_600_000;
const tags: Tag[] = [
  { id: 'A', name: 'A', color: '#123456' },
  { id: 'B', name: 'B', color: '#abcdef' },
];
function event(id: string, start = '10:00', end = '11:30', extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id, calendarId: 'calendar', title: id, start: `2026-10-12T${start}:00Z`,
    end: `2026-10-12T${end}:00Z`, isAllday: false, category: 'time', selfRsvpStatus: 'ACCEPTED', ...extra };
}

describe('calculateTagInsights', () => {
  it('excludes cancelled, declined and unaccepted events from all durations', () => {
    const excluded: Partial<CalendarEvent>[] = [
      { isCancelled: true }, { isDeclined: true }, { isUnaccepted: true },
      { selfRsvpStatus: 'DECLINED' }, { selfRsvpStatus: 'NEEDS-ACTION' },
      { selfRsvpStatus: 'TENTATIVE' }, { selfRsvpStatus: 'DELEGATED' }, { isAllday: true },
    ];
    const result = calculateTagInsights(excluded.map((extra, i) => event(String(i), undefined, undefined, extra)), {}, tags);
    expect(result).toEqual({ rows: [], totalMs: 0, untaggedMs: 0, eventCount: 0 });
  });

  it('assigns overlaps to the first event and counts the remaining tail only once', () => {
    const a = event('a', '10:00', '11:30', { tagId: 'A' });
    const b = event('b', '10:00', '11:00', { tagId: 'B' });
    const first = calculateTagInsights([a, b], {}, tags);
    expect(first.rows.map(r => [r.tag.id, r.durationMs])).toEqual([['A', 1.5 * hour]]);
    const reversed = calculateTagInsights([b, a], {}, tags);
    expect(reversed.rows.map(r => [r.tag.id, r.durationMs])).toEqual([['B', hour], ['A', 0.5 * hour]]);
    expect(reversed.totalMs).toBe(1.5 * hour);
  });

  it('uses series, source and embedded tags, allowing the mapping to override the embedded tag', () => {
    const result = calculateTagInsights([
      event('1', '09:00', '10:00', { seriesId: 'series', tagId: 'B' }),
      event('2', '10:00', '11:00', { sourceId: 'source' }),
      event('3', '11:00', '12:00', { tagId: 'A' }),
    ], { series: 'A', source: 'A' }, tags);
    expect(result.rows[0].durationMs).toBe(3 * hour);
    expect(result.untaggedMs).toBe(0);
  });

  it('clips to the visible range and never counts overlaps twice across untagged and tagged events', () => {
    const result = calculateTagInsights([
      event('untagged', '09:00', '11:00'),
      event('tagged', '10:00', '12:00', { tagId: 'A' }),
      event('outside', '13:00', '14:00'),
    ], {}, tags, { start: new Date('2026-10-12T10:00:00Z'), end: new Date('2026-10-12T11:30:00Z') });
    expect(result.untaggedMs).toBe(hour);
    expect(result.rows[0].durationMs).toBe(0.5 * hour);
    expect(result.totalMs).toBe(result.untaggedMs + result.rows[0].durationMs);
    expect(result.eventCount).toBe(2);
  });

  it('includes personal events with no RSVP and ignores invalid or empty intervals', () => {
    const result = calculateTagInsights([
      event('own', undefined, undefined, { selfRsvpStatus: undefined }),
      event('empty', '10:00', '10:00'), event('invalid', 'invalid'),
    ], {}, tags);
    expect(result.untaggedMs).toBe(1.5 * hour);
    expect(result.eventCount).toBe(1);
  });
});

it('excludes shared calendar copies even when a personal copy of the series has a tag', () => {
  const personal = event('personal', '10:00', '11:00', { seriesId: 'same-series' });
  const shared = event('shared', '09:00', '12:00', { calendarId: 'other', seriesId: 'same-series', tagId: 'A' });
  const result = calculateTagInsights([shared, personal], { 'same-series': 'A' }, tags, undefined, [
    { id: 'other', name: 'Other', url: '', color: '#123456', visible: true, shared: { ownerEmail: 'other@example.com' } },
  ]);
  expect(result.totalMs).toBe(hour);
  expect(result.eventCount).toBe(1);
  expect(result.rows[0].durationMs).toBe(hour);
});
