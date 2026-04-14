import { CalendarConfig, CalendarEvent, EventTagMapping, Tag, ViewType } from '../types';

export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function formatDateLabel(date: Date, view: ViewType): string {
  const locale = 'fr-FR';
  if (view === 'month') {
    return date.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  }
  if (view === 'week' || view === 'workweek') {
    const start = new Date(date);
    const day = start.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + diff);
    const end = new Date(start);
    end.setDate(end.getDate() + (view === 'workweek' ? 4 : 6));
    const s = start.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
    const e = end.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
    return `${s} – ${e}`;
  }
  return date.toLocaleDateString(locale, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

export function getViewRange(date: Date, view: ViewType): { start: Date; end: Date } {
  if (view === 'month') {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start, end };
  }
  if (view === 'week' || view === 'workweek') {
    const start = new Date(date);
    const day = start.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + diff);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + (view === 'workweek' ? 4 : 6));
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  // day
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export function formatTime(date: unknown): string {
  let d: Date;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (date instanceof Date) d = date;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  else if (date && typeof (date as any).toDate === 'function') d = (date as any).toDate();
  else if (typeof date === 'string') d = new Date(date);
  else return '';
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  const m = d.getMinutes();
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

export function toTUIEvents(
  events: CalendarEvent[],
  calendars: CalendarConfig[],
  isDark: boolean,
  tags: Tag[],
  eventTags: EventTagMapping
) {
  const now = new Date();
  const unacceptedBg = isDark ? '#1e1e2e' : '#ffffff';
  return events.map((ev) => {
    const cal = calendars.find((c) => c.id === ev.calendarId);
    const color = cal?.color || '#888';
    const eventKey = ev.seriesId || ev.sourceId;
    const tagId = eventKey ? eventTags[eventKey] : undefined;
    const tag = tagId ? tags.find((t) => t.id === tagId) : undefined;
    const isPast = new Date(ev.end) < now;
    const isUnaccepted = ev.isUnaccepted;
    const isDeclined = ev.isDeclined;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const customStyle: Record<string, any> = {};

    let backgroundColor: string;
    let textColor: string;
    let borderColor: string;

    if (isPast && isUnaccepted) {
      backgroundColor = unacceptedBg;
      textColor = color;
      borderColor = 'transparent';
      customStyle.outline = `1px dashed ${color}`;
      customStyle.outlineOffset = '-1px';
      customStyle.opacity = '0.6';
      customStyle.borderRadius = '4px';
    } else if (isPast) {
      backgroundColor = hexToRgba(color, 0.18);
      textColor = color;
      borderColor = 'transparent';
    } else if (isUnaccepted) {
      backgroundColor = unacceptedBg;
      textColor = color;
      borderColor = 'transparent';
      customStyle.outline = `1px dashed ${color}`;
      customStyle.outlineOffset = '-1px';
      customStyle.borderRadius = '4px';
    } else {
      backgroundColor = color;
      textColor = '#fff';
      borderColor = 'transparent';
    }

    if (isDeclined) {
      customStyle.textDecoration = 'line-through';
    }

    const tagColor = tag ? tag.color : undefined;

    let tuiEnd = ev.end;
    if (ev.isAllday && ev.end) {
      const d = new Date(ev.end);
      d.setDate(d.getDate() - 1);
      tuiEnd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    return {
      id: ev.id,
      calendarId: ev.calendarId,
      title: ev.title,
      start: ev.start,
      end: tuiEnd,
      isAllday: ev.isAllday,
      category: ev.category,
      location: ev.location,
      description: ev.description,
      color: textColor,
      backgroundColor,
      borderColor,
      ...(Object.keys(customStyle).length ? { customStyle } : {}),
      raw: { tagColor, isDeclined },
    };
  });
}
