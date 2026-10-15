import { describe, expect, it } from 'vitest';
import { recurrenceRule, parseRecurrence, RecurrenceOptions } from './recurrence';
import { anchorSeriesDates } from './seriesDates';
const base: RecurrenceOptions = { frequency: 'WEEKLY', interval: 2, days: ['TH', 'MO'], monthly: 'date', ending: 'never', until: '2027-01-14', count: 13 };
describe('recurrence editor rules', () => {
  it('orders weekdays and serializes count or inclusive end dates', () => {
    expect(recurrenceRule(base, '2026-10-15', false)).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH');
    expect(recurrenceRule({ ...base, ending: 'count' }, '2026-10-15', false)).toContain('COUNT=13');
    expect(recurrenceRule({ ...base, ending: 'until' }, '2026-10-15', false)).toContain('UNTIL=20270114T235959Z');
    expect(recurrenceRule({ ...base, ending: 'until' }, '2026-10-15', true)).toContain('UNTIL=20270114');
  });
  it('uses the ordinal weekday and the last weekday for fifth weeks', () => {
    expect(recurrenceRule({ ...base, frequency: 'MONTHLY', monthly: 'weekday' }, '2026-10-15', false)).toContain('BYDAY=3TH');
    expect(recurrenceRule({ ...base, frequency: 'MONTHLY', monthly: 'weekday' }, '2026-10-29', false)).toContain('BYDAY=-1TH');
  });
  it('rejects an empty week, invalid intervals and a past end date', () => {
    for (const options of [{ ...base, days: [] }, { ...base, interval: 0 }, { ...base, interval: 1.5 }, { ...base, ending: 'until' as const, until: '2020-01-01' }]) expect(() => recurrenceRule(options, '2026-10-15', false)).toThrow();
  });
  it('keeps the first occurrence date and applies the edited duration to a series', () => {
    const payload = { title: 'Meeting', calendarId: 'cal', start: '2026-10-22T15:00:00Z', end: '2026-10-22T17:00:00Z', isAllday: false };
    const anchored = anchorSeriesDates(payload, '2026-10-22T14:00:00Z', '2026-10-01T14:00:00Z');
    expect(anchored.start).toBe('2026-10-01T15:00:00.000Z');
    expect(anchored.end).toBe('2026-10-01T17:00:00.000Z');
  });
  it('prefills supported rules while preserving advanced imported rules', () => {
    expect(parseRecurrence('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;COUNT=13', '2026-10-15')).toMatchObject({ interval: 2, days: ['MO', 'TH'], ending: 'count', count: 13 });
    expect(parseRecurrence('FREQ=MONTHLY;BYDAY=3TH', '2026-10-15')?.monthly).toBe('weekday');
    expect(parseRecurrence('FREQ=MONTHLY;BYSETPOS=-1;BYDAY=MO,TU,WE,TH,FR', '2026-10-15')).toBeNull();
    expect(parseRecurrence('FREQ=YEARLY;BYMONTH=2', '2026-10-15')).toBeNull();
  });
  it('anchors all-day events without a local-midnight timezone shift', () => {
    const payload = { title: 'Holiday', calendarId: 'cal', start: '2026-10-22', end: '2026-10-23', isAllday: true };
    const anchored = anchorSeriesDates(payload, '2026-10-22T00:00:00', '2026-10-01');
    expect(anchored.start).toBe('2026-10-01');
    expect(anchored.end).toBe('2026-10-02');
  });

});
