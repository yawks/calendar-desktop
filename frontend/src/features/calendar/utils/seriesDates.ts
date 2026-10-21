import { CreateEventPayload } from '../../../shared/types';

/** Keep the first occurrence's date when editing a series from a later occurrence. */
export function anchorSeriesDates(payload: CreateEventPayload, originalStart: string, masterStart: string): CreateEventPayload {
  const dateValue = (value: string) => new Date(payload.isAllday ? value.slice(0, 10) : value).getTime();
  const shift = dateValue(payload.start) - dateValue(originalStart);
  const duration = dateValue(payload.end) - dateValue(payload.start);
  const start = new Date(dateValue(masterStart) + shift);
  const end = new Date(start.getTime() + duration);
  return { ...payload, start: payload.isAllday ? start.toISOString().slice(0, 10) : start.toISOString(), end: payload.isAllday ? end.toISOString().slice(0, 10) : end.toISOString() };
}
