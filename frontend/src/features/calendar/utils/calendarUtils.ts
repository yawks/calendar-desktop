import { CalendarConfig, CalendarEvent, ViewType, Tag, EventTagMapping } from '../../../shared/types';

// ── Color helpers ─────────────────────────────────────────────────────────────
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

type EventColorStyle = { backgroundColor: string; textColor: string };

const DARK_CALENDAR_SURFACE = '#111315';

function parseHexColor(hex: string): [number, number, number] | null {
  const value = hex.trim();
  const rgbMatch = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(value);
  if (rgbMatch) {
    const channels = rgbMatch.slice(1).map(Number);
    if (channels.every((channel) => channel >= 0 && channel <= 255)) {
      return channels as [number, number, number];
    }
    return null;
  }
  const clean = value.replace(/^#/, '');
  const full = clean.length === 3 ? clean.split('').map((part) => part + part).join('') : clean;
  if (!/^[\da-f]{6}$/i.test(full)) return null;
  return [0, 2, 4].map((offset) => Number.parseInt(full.slice(offset, offset + 2), 16)) as [number, number, number];
}

function mixHexColors(foreground: string, background: string, amount: number): string {
  const fg = parseHexColor(foreground);
  const bg = parseHexColor(background);
  if (!fg || !bg) return foreground;
  const channels = fg.map((channel, index) => Math.round(channel * amount + bg[index] * (1 - amount)));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function readableTextColor(background: string): string {
  const rgb = parseHexColor(background);
  if (!rgb) return '#ffffff';
  const [red, green, blue] = rgb;
  const isGoogleBlue = red === 26 && green === 115 && blue === 232;
  const isVividRed = red >= 220 && green <= 85 && blue <= 85;
  if (isGoogleBlue || isVividRed) return '#ffffff';
  const linear = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  const darkContrast = (luminance + 0.05) / 0.05;
  const lightContrast = 1.05 / (luminance + 0.05);

  // On saturated mid-tone colours such as Google blue (#1a73e8), both
  // choices pass AA. White reads more naturally and matches Calendar.
  if (lightContrast >= 4.5 && darkContrast < 5) return '#ffffff';
  return darkContrast >= lightContrast ? DARK_CALENDAR_SURFACE : '#ffffff';
}

/** Google Calendar-like event colours for both full and compact calendar views. */
export function getEventColorStyle(color: string, isPast: boolean, isDark: boolean): EventColorStyle {
  if (!isDark) {
    return isPast
      ? { backgroundColor: hexToRgba(color, 0.18), textColor: color }
      : { backgroundColor: color, textColor: '#ffffff' };
  }
  if (isPast) {
    return {
      backgroundColor: mixHexColors(color, DARK_CALENDAR_SURFACE, 0.52),
      textColor: mixHexColors(color, '#d7dadc', 0.48),
    };
  }
  return { backgroundColor: color, textColor: readableTextColor(color) };
}

// ── Date label ────────────────────────────────────────────────────────────────
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

// ── Time formatting ───────────────────────────────────────────────────────────
export function formatTime(date: unknown): string {
  let d: Date;
  if (date instanceof Date) d = date;
  else if (date && typeof (date as any).toDate === 'function') d = (date as any).toDate();
  else if (typeof date === 'string') d = new Date(date);
  else return '';
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  const m = d.getMinutes();
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

// ── Themes ────────────────────────────────────────────────────────────────────
export const LIGHT_THEME = {
  common: {
    backgroundColor: '#ffffff',
    border: '1px solid #dadce0',
    holiday: { color: '#d93025' },
    saturday: { color: '#1a73e8' },
    today: { color: '#ffffff', backgroundColor: '#1a73e8' },
    gridSelection: { backgroundColor: 'rgba(26,115,232,0.06)', border: '1px solid #1a73e8' },
  },
  week: {
    dayName: {
      borderLeft: 'none',
      borderTop: 'none',
      borderBottom: '1px solid #dadce0',
      backgroundColor: '#ffffff',
    },
    dayGrid: { borderRight: '1px solid #dadce0', backgroundColor: '' },
    dayGridLeft: { borderRight: '1px solid #dadce0', backgroundColor: '#ffffff', width: '72px' },
    timeGrid: { borderRight: '1px solid #dadce0' },
    timeGridLeft: { backgroundColor: '#ffffff', borderRight: '1px solid #dadce0', width: '72px' },
    timeGridHourLine: { borderBottom: '1px solid #dadce0' },
    timeGridHalfHourLine: { borderBottom: 'none' },
    weekend: { backgroundColor: '#fafafa' },
    today: { color: '#202124', backgroundColor: 'rgba(26,115,232,0.05)' },
    pastDay: { color: '#9aa0a6' },
    pastTime: { color: '#9aa0a6' },
    gridSelection: { backgroundColor: 'rgba(26,115,232,0.06)', border: '1px solid #1a73e8' },
  },
  month: {
    dayName: { borderLeft: 'none', backgroundColor: '#f8f9fa', color: '#70757a' },
    weekend: { backgroundColor: '#fafafa' },
    holidayExcessView: { color: '#d93025' },
    dayExcessView: { color: '#1a73e8' },
    moreView: { border: '1px solid #dadce0', backgroundColor: '#ffffff', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' },
    moreViewTitle: { backgroundColor: '#f8f9fa' },
  },
};

export const DARK_THEME = {
  common: {
    backgroundColor: DARK_CALENDAR_SURFACE,
    border: '1px solid #3c4043',
    holiday: { color: '#c8607a' },
    saturday: { color: '#6d9ee8' },
    dayName: { color: '#a8b4cc' },
    today: { color: DARK_CALENDAR_SURFACE, backgroundColor: '#8ab4f8' },
    gridSelection: { backgroundColor: 'rgba(109,158,232,0.1)', border: '1px solid #6d9ee8' },
  },
  week: {
    dayName: { borderLeft: 'none', borderTop: '1px solid #3c4043', borderBottom: '1px solid #3c4043', backgroundColor: DARK_CALENDAR_SURFACE },
    dayGrid: { borderRight: '1px solid #3c4043', backgroundColor: '' },
    dayGridLeft: { borderRight: '1px solid #3c4043', backgroundColor: DARK_CALENDAR_SURFACE, width: '72px' },
    timeGrid: { borderRight: '1px solid #3c4043' },
    timeGridLeft: { backgroundColor: DARK_CALENDAR_SURFACE, borderRight: '1px solid #3c4043', width: '72px' },
    timeGridHourLine: { borderBottom: '1px solid #3c4043' },
    timeGridHalfHourLine: { borderBottom: 'none' },
    weekend: { backgroundColor: '#141618' },
    today: { color: '#a8b4cc', backgroundColor: 'rgba(109,158,232,0.07)' },
    pastDay: { color: '#80868b' },
    pastTime: { color: '#80868b' },
    gridSelection: { backgroundColor: 'rgba(109,158,232,0.1)', border: '1px solid #6d9ee8' },
  },
  month: {
    dayName: { borderLeft: 'none', backgroundColor: DARK_CALENDAR_SURFACE, color: '#bdc1c6' },
    weekend: { backgroundColor: '#141618' },
    holidayExcessView: { color: '#c8607a' },
    dayExcessView: { color: '#a8b4cc' },
    moreView: { border: '1px solid #3c4043', backgroundColor: DARK_CALENDAR_SURFACE, boxShadow: '0 4px 12px rgba(0,0,0,0.6)' },
    moreViewTitle: { backgroundColor: '#202124' },
  },
};

// ── Map our events to TUI format with styling ─────────────────────────────────
export function toTUIEvents(events: CalendarEvent[], calendars: CalendarConfig[], isDark: boolean, tags: Tag[], eventTags: EventTagMapping) {
  const now = new Date();
  const unacceptedBg = isDark ? '#1e1e2e' : '#ffffff';
  return events.map((ev) => {
    const cal = calendars.find((c) => c.id === ev.calendarId);
    const color = cal?.color || '#888';
    const eventKey = ev.seriesId || ev.sourceId;
    // Newly-created optimistic events do not have a provider/series ID yet.
    // Keep using the tag carried by the event until the server ID is available
    // and the persistent mapping takes over.
    const tagId = (eventKey ? eventTags[eventKey] : undefined) ?? ev.tagId;
    const tag = tagId ? tags.find((t) => t.id === tagId) : undefined;
    const isPast = new Date(ev.end) < now;
    const isUnaccepted = ev.isUnaccepted;
    const isDeclined = ev.isDeclined;

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
      const eventColors = getEventColorStyle(color, true, isDark);
      backgroundColor = eventColors.backgroundColor;
      textColor = eventColors.textColor;
      borderColor = 'transparent';
    } else if (isUnaccepted) {
      backgroundColor = unacceptedBg;
      textColor = color;
      borderColor = 'transparent';
      customStyle.outline = `1px dashed ${color}`;
      customStyle.outlineOffset = '-1px';
      customStyle.borderRadius = '4px';
    } else {
      const eventColors = getEventColorStyle(color, false, isDark);
      backgroundColor = eventColors.backgroundColor;
      textColor = eventColors.textColor;
      borderColor = 'transparent';
    }

    if (isDeclined || ev.isCancelled) {
      customStyle.textDecoration = 'line-through';
    }

    if (ev.selfRsvpStatus === 'TENTATIVE' && !ev.isDeclined && !ev.isCancelled) {
      const hatchColor = hexToRgba(color, 0.3);
      // TUI's inner time-content can be shorter than the event container (for
      // example when the event carries duration segments). Paint the container
      // itself so the tentative pattern always covers the complete event.
      customStyle.backgroundImage = `repeating-linear-gradient(-45deg, ${hatchColor} 0, ${hatchColor} 4px, transparent 4px, transparent 8px)`;
    }

    const tagColor = tag ? tag.color : undefined;

    const calendarDate = (value: string): string => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value.slice(0, 10);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    };

    let tuiStart = ev.start;
    let tuiEnd = ev.end;
    if (ev.isAllday && ev.end) {
      // Providers expose all-day dates as calendar dates with an exclusive end.
      // Never run those values through the local timezone: an ISO midnight would
      // otherwise move to the previous column west of UTC (or after conversion).
      const startDate = calendarDate(ev.start);
      const exclusiveEndDate = calendarDate(ev.end);
      const [year, month, day] = exclusiveEndDate.split('-').map(Number);
      const inclusiveEnd = new Date(Date.UTC(year, month - 1, day));
      inclusiveEnd.setUTCDate(inclusiveEnd.getUTCDate() - 1);
      tuiStart = startDate;
      tuiEnd = inclusiveEnd.toISOString().slice(0, 10);
    }

    return {
      id: ev.id,
      calendarId: ev.calendarId,
      title: ev.title,
      start: tuiStart,
      end: tuiEnd,
      isAllday: ev.isAllday,
      category: ev.isAllday ? 'allday' : 'time',
      location: ev.location,
      state: ev.isDeclined || ev.isCancelled ? 'Free' : 'Busy',
      backgroundColor,
      color: textColor,
      borderColor,
      customStyle,
      raw: {
        ...ev,
        tagColor,
      },
    };
  });
}
