// @ts-ignore ical.js v1 has no bundled declarations
import ICAL from 'ical.js';
import { t } from 'i18next';
import { calendarApi } from '../../../shared/api/calendarApi';
import type { CalendarConfig, CalendarEvent } from '../../../shared/types';
import { sameOriginDavUrl } from './sharedCalendars';
import { parseCalDavTasks } from './parseCalDavTasks';

export interface CalDavTaskDraft { title: string; description: string; due?: string; start?: string; completed: boolean }

export async function moveCalDavTask(event: CalendarEvent, cal: CalendarConfig, target: Date): Promise<void> {
  const task = event.caldavTask!;
  const previous = new Date(event.start);
  const dayDelta = Math.round((Date.UTC(target.getFullYear(), target.getMonth(), target.getDate())
    - Date.UTC(previous.getFullYear(), previous.getMonth(), previous.getDate())) / 86400000);
  const shift = (value?: string) => {
    if (!value) return undefined;
    const time = ICAL.Time.fromString(value);
    if (event.isAllday || time.isDate) time.adjust(dayDelta, 0, 0, 0);
    else {
      // Shift wall-clock fields so floating and TZID dates retain their original representation.
      const minutes = dayDelta * 1440 + target.getHours() * 60 + target.getMinutes() - previous.getHours() * 60 - previous.getMinutes();
      time.adjust(0, 0, minutes, 0);
    }
    return time.toString();
  };
  await updateCalDavTask(event, cal, { title: task.title, description: event.description ?? '',
    due: shift(task.due), start: shift(task.start), completed: false });
}
export const canEditCalDavTask = (event: CalendarEvent, cal?: CalendarConfig | null) =>
  !!event.isTask && !event.readOnly && cal?.type === 'nextcloud' && !cal.shared && !!event.caldavTask?.resourceUrl && !!event.caldavTask.etag && !event.caldavTask.etag.startsWith('W/');

function credentials(event: CalendarEvent, cal: CalendarConfig) {
  if (!canEditCalDavTask(event, cal)) throw new Error(t('config.caldavTaskReadOnly'));
  return { url: sameOriginDavUrl(cal.url, event.caldavTask!.resourceUrl), username: cal.nextcloudUsername ?? '', password: cal.nextcloudPassword ?? '' };
}

export async function reloadCalDavTask(event: CalendarEvent, cal: CalendarConfig): Promise<CalendarEvent> {
  const resource = await calendarApi.fetchCalDavResource(credentials(event, cal));
  const task = parseCalDavTasks(resource.text, cal).find(candidate => candidate.caldavTask?.uid === event.caldavTask!.uid);
  if (!task || !resource.etag || resource.etag.startsWith('W/')) throw new Error(t('caldavTask.unavailable'));
  return { ...task, id: event.id, readOnly: false,
    caldavTask: { ...task.caldavTask!, resourceUrl: event.caldavTask!.resourceUrl, etag: resource.etag, project: event.caldavTask!.project } };
}

export async function updateCalDavTask(event: CalendarEvent, cal: CalendarConfig, draft: CalDavTaskDraft): Promise<void> {
  const auth = credentials(event, cal);
  if (!draft.title.trim() || (!draft.due && !draft.start)) throw new Error(t('caldavTask.required'));
  const resource = await calendarApi.fetchCalDavResource(auth);
  if (!resource.etag || resource.etag !== event.caldavTask!.etag) throw new Error('caldav_task_conflict');
  const calendar = new ICAL.Component(ICAL.parse(resource.text));
  const task = calendar.getAllSubcomponents('vtodo').find((component: any) =>
    component.getFirstPropertyValue('uid') === event.caldavTask!.uid && !component.hasProperty('recurrence-id'));
  if (!task) throw new Error(t('caldavTask.unavailable'));
  task.updatePropertyWithValue('summary', draft.title.trim());
  task.updatePropertyWithValue('description', draft.description);
  const originalDue = task.getFirstPropertyValue('due')?.toString();
  const originalStart = task.getFirstPropertyValue('dtstart')?.toString();
  const dates = { due: draft.due, dtstart: draft.start };
  if (originalDue && originalDue === originalStart && draft.start === originalStart) dates.dtstart = draft.due;
  for (const [name, value] of Object.entries(dates)) {
    const original = task.getFirstPropertyValue(name);
    if (value === original?.toString()) continue;
    if (!value) { task.removeAllProperties(name); continue; }
    const time = ICAL.Time.fromString(value);
    if (!time.isDate && original && !original.isDate) time.zone = original.zone;
    task.updatePropertyWithValue(name, time);
    if (time.isDate) task.getFirstProperty(name).removeParameter('tzid');
  }
  const start = task.getFirstPropertyValue('dtstart');
  const due = task.getFirstPropertyValue('due');
  if (start && due && start.compare(due) > 0) throw new Error(t('caldavTask.dateOrder'));
  if (draft.completed) {
    task.updatePropertyWithValue('status', 'COMPLETED');
    task.updatePropertyWithValue('completed', ICAL.Time.fromJSDate(new Date(), true));
    task.updatePropertyWithValue('percent-complete', 100);
  }
  task.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), true));
  await calendarApi.putCalDav(auth, calendar.toString(), resource.etag);
}

export function isCalDavTaskConflict(error: unknown): boolean {
  const detail = error instanceof Error ? error.message : typeof error === 'string' ? error
    : error && typeof error === 'object' && 'detail' in error ? String(error.detail) : '';
  return detail === 'caldav_task_conflict' || /provider_http_412/.test(detail);
}
