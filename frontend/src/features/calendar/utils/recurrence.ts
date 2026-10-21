export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
export interface RecurrenceOptions {
  frequency: Frequency;
  interval: number;
  days: string[];
  monthly: 'date' | 'weekday';
  ending: 'never' | 'until' | 'count';
  until: string;
  count: number;
}
export function recurrenceRule(options: RecurrenceOptions, start: string, allDay: boolean): string {
  const date = new Date(`${start.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime()) || !Number.isInteger(options.interval) || options.interval < 1 || options.interval > 999) throw new Error('Invalid recurrence');
  const parts = [`FREQ=${options.frequency}`, `INTERVAL=${options.interval}`];
  if (options.frequency === 'WEEKLY') {
    const days = WEEKDAYS.filter(day => options.days.includes(day));
    if (!days.length) throw new Error('Invalid weekdays');
    parts.push(`BYDAY=${days.join(',')}`);
  }
  if (options.frequency === 'MONTHLY' && options.monthly === 'weekday') {
    const ordinal = Math.ceil(date.getDate() / 7);
    parts.push(`BYDAY=${ordinal === 5 ? -1 : ordinal}${WEEKDAYS[(date.getDay() + 6) % 7]}`);
  }
  if (options.ending === 'count') {
    if (!Number.isInteger(options.count) || options.count < 1 || options.count > 999) throw new Error('Invalid count');
    parts.push(`COUNT=${options.count}`);
  }
  if (options.ending === 'until') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(options.until) || options.until < start.slice(0, 10)) throw new Error('Invalid end date');
    parts.push(`UNTIL=${options.until.replaceAll('-', '')}${allDay ? '' : 'T235959Z'}`);
  }
  return parts.join(';');
}

/** Only prefill rules we can round-trip; leave advanced imported rules untouched. */
export function parseRecurrence(rule: string, start: string): RecurrenceOptions | null {
  const fields: Record<string, string> = Object.fromEntries(rule.split(';').map(part => part.split('=')));
  if (Object.keys(fields).some(key => !['FREQ', 'INTERVAL', 'BYDAY', 'COUNT', 'UNTIL', 'BYMONTHDAY', 'WKST'].includes(key))) return null;
  if (fields.WKST && fields.WKST !== 'MO') return null;
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(fields.FREQ)) return null;
  const date = new Date(`${start.slice(0, 10)}T12:00:00`);
  if (fields.BYMONTHDAY && (fields.FREQ !== 'MONTHLY' || Number(fields.BYMONTHDAY) !== date.getDate())) return null;
  const days = fields.BYDAY?.split(',') ?? [WEEKDAYS[(date.getDay() + 6) % 7]];
  if (fields.FREQ === 'WEEKLY' && days.some(day => !WEEKDAYS.includes(day))) return null;
  if (fields.FREQ === 'MONTHLY' && fields.BYDAY) {
    const ordinal = Math.ceil(date.getDate() / 7);
    const expected = `${ordinal === 5 ? -1 : ordinal}${WEEKDAYS[(date.getDay() + 6) % 7]}`;
    if (fields.BYDAY !== expected) return null;
  } else if (fields.FREQ !== 'WEEKLY' && fields.BYDAY) return null;
  if (fields.COUNT && fields.UNTIL) return null;
  const until = fields.UNTIL?.slice(0, 8).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3') ?? start.slice(0, 10);
  const options: RecurrenceOptions = {
    frequency: fields.FREQ as Frequency, interval: Number(fields.INTERVAL ?? 1),
    days: fields.FREQ === 'WEEKLY' ? days : [WEEKDAYS[(date.getDay() + 6) % 7]],
    monthly: fields.FREQ === 'MONTHLY' && fields.BYDAY ? 'weekday' : 'date',
    ending: fields.COUNT ? 'count' : fields.UNTIL ? 'until' : 'never',
    until, count: Number(fields.COUNT ?? 13),
  };
  // A series can already have ended before the occurrence being edited.
  if (!Number.isInteger(options.interval) || options.interval < 1 || options.interval > 999 || !Number.isInteger(options.count) || options.count < 1 || options.count > 999) return null;
  return options;
}
