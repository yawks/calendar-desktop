// @ts-ignore ical.js v1 has no bundled declarations
import ICAL from 'ical.js';
import { t } from 'i18next';
import type { CalendarConfig, CalendarEvent } from '../../../shared/types';

export function parseCalDavTasks(ics: string, cal: CalendarConfig): CalendarEvent[] {
  const component = new ICAL.Component(ICAL.parse(ics));
  return component.getAllSubcomponents('vtodo').flatMap((task: any) => {
    const status = String(task.getFirstPropertyValue('status') ?? '').toUpperCase();
    if (status === 'COMPLETED' || status === 'CANCELLED' || task.hasProperty('completed')) return [];
    const date = task.getFirstPropertyValue('due') ?? task.getFirstPropertyValue('dtstart');
    if (!date) return [];
    const uid = task.getFirstPropertyValue('uid');
    if (!uid) return [];
    const end = date.clone();
    if (date.isDate) end.adjust(1, 0, 0, 0);
    else end.adjust(0, 0, 30, 0);
    const iso = (time: any) => time.isDate ? `${time.toString()}T00:00:00` : time.toJSDate().toISOString();
    const due = task.getFirstPropertyValue('due');
    const start = task.getFirstPropertyValue('dtstart');
    const zone = (name: string, time: any) => time && !time.isDate
      ? task.getFirstProperty(name)?.getParameter('tzid') || (time.toString().endsWith('Z') ? 'UTC' : undefined) : undefined;
    // OpenTodo advances recurring tasks when completed; show the current due date only.
    return [{
      id: `${cal.id}-task-${uid}`, calendarId: cal.id,
      title: t('config.caldavTaskTitle', { title: task.getFirstPropertyValue('summary') || t('config.caldavUntitledTask') }),
      start: iso(date), end: iso(end), isAllday: date.isDate,
      category: date.isDate ? 'allday' : 'time',
      description: task.getFirstPropertyValue('description') || undefined,
      location: task.getFirstPropertyValue('location') || undefined,
      readOnly: true, isTask: true,
      caldavTask: {
        uid, resourceUrl: '', etag: null,
        title: task.getFirstPropertyValue('summary') || '',
        due: due?.toString(), start: start?.toString(),
        dueZone: zone('due', due), startZone: zone('dtstart', start),
        categories: task.getAllProperties('categories').flatMap((property: any) => property.getValues().map(String)),
      },
    } satisfies CalendarEvent];
  });
}
