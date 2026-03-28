import '@toast-ui/calendar/dist/toastui-calendar.min.css';

import { CalendarConfig, CalendarEvent, CreateEventPayload, ViewType } from '../types';
import { useCallback, useRef, useState } from 'react';

import AppHeader from '../components/AppHeader';
import Calendar from '@toast-ui/react-calendar';
import CreateEventModal from '../components/CreateEventModal';
import EventModal from '../components/EventModal';
import Sidebar from '../components/Sidebar';
import { createEvent, updateEvent, respondToGoogleEvent } from '../utils/googleCalendarApi';
import { createNextcloudEvent, updateNextcloudEvent, respondToNextcloudEvent } from '../utils/nextcloudCalendarApi';
import { useCalendars } from '../store/CalendarStore';
import { useGoogleAuth } from '../store/GoogleAuthStore';
import { useGoogleEvents } from '../hooks/useGoogleEvents';
import { useICSEvents } from '../hooks/useICSEvents';
import { useNextcloudEvents } from '../hooks/useNextcloudEvents';
import { useEventKitEvents } from '../hooks/useEventKitEvents';
import { useTheme } from '../store/ThemeStore';

// ── Minimal TUI Calendar instance type ───────────────────────────────────────
interface TUICalendarInstance {
  prev(): void;
  next(): void;
  today(): void;
  setDate(date: Date): void;
  getDate(): { toDate(): Date };
  clearGridSelections(): void;
}
interface CalendarRef {
  getInstance(): TUICalendarInstance | null;
}

// ── Color helpers ─────────────────────────────────────────────────────────────
function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Date label ────────────────────────────────────────────────────────────────
function formatDateLabel(date: Date, view: ViewType): string {
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

// ── TUI Calendar light theme (Google Calendar inspired) ──────────────────────
const LIGHT_THEME = {
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

// ── TUI Calendar dark theme ───────────────────────────────────────────────────
const DARK_THEME = {
  common: {
    backgroundColor: '#1a1a28',
    border: '1px solid #2a2a3c',
    holiday: { color: '#c8607a' },
    saturday: { color: '#6d9ee8' },
    dayName: { color: '#a8b4cc' },
    today: { color: '#1a1a28', backgroundColor: '#6d9ee8' },
    gridSelection: { backgroundColor: 'rgba(109,158,232,0.1)', border: '1px solid #6d9ee8' },
  },
  week: {
    dayName: { borderLeft: 'none', borderTop: '1px solid #2a2a3c', borderBottom: '1px solid #2a2a3c', backgroundColor: '#151520' },
    dayGrid: { borderRight: '1px solid #2a2a3c', backgroundColor: '' },
    dayGridLeft: { borderRight: '1px solid #2a2a3c', backgroundColor: '#151520', width: '72px' },
    timeGrid: { borderRight: '1px solid #2a2a3c' },
    timeGridLeft: { backgroundColor: '#151520', borderRight: '1px solid #2a2a3c', width: '72px' },
    timeGridHourLine: { borderBottom: '1px solid #222234' },
    timeGridHalfHourLine: { borderBottom: 'none' },
    weekend: { backgroundColor: '#181826' },
    today: { color: '#a8b4cc', backgroundColor: 'rgba(109,158,232,0.07)' },
    pastDay: { color: '#484a5e' },
    pastTime: { color: '#484a5e' },
    gridSelection: { backgroundColor: 'rgba(109,158,232,0.1)', border: '1px solid #6d9ee8' },
  },
  month: {
    dayName: { borderLeft: 'none', backgroundColor: '#151520', color: '#a8b4cc' },
    weekend: { backgroundColor: '#181826' },
    holidayExcessView: { color: '#c8607a' },
    dayExcessView: { color: '#a8b4cc' },
    moreView: { border: '1px solid #2a2a3c', backgroundColor: '#1a1a28', boxShadow: '0 4px 12px rgba(0,0,0,0.6)' },
    moreViewTitle: { backgroundColor: '#151520' },
  },
};

// ── Time formatting ───────────────────────────────────────────────────────────
function formatTime(date: unknown): string {
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

// ── Map our events to TUI format with styling ─────────────────────────────────
function toTUIEvents(events: CalendarEvent[], calendars: CalendarConfig[], isDark: boolean) {
  const now = new Date();
  const unacceptedBg = isDark ? '#1e1e2e' : '#ffffff';
  return events.map((ev) => {
    const cal = calendars.find((c) => c.id === ev.calendarId);
    const color = cal?.color || '#888';
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
      // Couleur pleine, texte blanc, pas de bordure visible
      backgroundColor = color;
      textColor = '#fff';
      borderColor = 'transparent';
    }

    if (isDeclined) {
      customStyle.textDecoration = 'line-through';
    }

    // Google Calendar all-day events have an exclusive end date (the day after).
    // TUI Calendar expects an inclusive end date, so we subtract 1 day.
    let tuiEnd = ev.end;
    if (ev.isAllday && ev.end) {
      const d = new Date(ev.end);
      d.setDate(d.getDate() - 1);
      // Use local date components to avoid UTC shift (toISOString gives UTC midnight)
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
    };
  });
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function CalendarPage() {
  const calendarRef = useRef<CalendarRef>(null);
  const [view, setView] = useState<ViewType>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    localStorage.getItem('sidebar-collapsed') === 'true'
  );
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = localStorage.getItem('sidebar-width');
    return stored ? Number(stored) : 260;
  });
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;

  const handleCollapseToggle = useCallback(() => {
    setSidebarCollapsed((v) => {
      const next = !v;
      localStorage.setItem('sidebar-collapsed', String(next));
      return next;
    });
  }, []);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidthRef.current;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      const newWidth = Math.min(Math.max(startWidth + ev.clientX - startX, 160), 480);
      setSidebarWidth(newWidth);
    };

    const onMouseUp = (ev: MouseEvent) => {
      const newWidth = Math.min(Math.max(startWidth + ev.clientX - startX, 160), 480);
      localStorage.setItem('sidebar-width', String(newWidth));
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  const { calendars, toggleCalendar, updateCalendar } = useCalendars();
  const { events: icsEvents, loading: icsLoading, errors: icsErrors, refresh: icsRefresh } = useICSEvents(calendars);
  const { events: googleEvents, loading: googleLoading, errors: googleErrors, refresh: googleRefresh } = useGoogleEvents(calendars);
  const { events: ncEvents, loading: ncLoading, errors: ncErrors, refresh: ncRefresh } = useNextcloudEvents(calendars);
  const { events: ekEvents, loading: ekLoading, errors: ekErrors, refresh: ekRefresh } = useEventKitEvents(calendars);
  const { getValidToken } = useGoogleAuth();
  const { resolved: theme } = useTheme();

  const events = [...icsEvents, ...googleEvents, ...ncEvents, ...ekEvents];
  const loading = icsLoading || googleLoading || ncLoading || ekLoading;
  const errors = { ...icsErrors, ...googleErrors, ...ncErrors, ...ekErrors };
  const refresh = useCallback(() => { icsRefresh(); googleRefresh(); ncRefresh(); ekRefresh(); }, [icsRefresh, googleRefresh, ncRefresh, ekRefresh]);

  // Calendars available for event creation: writable Google + writable EventKit + Nextcloud
  const writableCalendars = calendars.filter(
    (c) => c.type === 'google' || c.type === 'eventkit' || c.type === 'nextcloud'
  );

  const [createModalState, setCreateModalState] = useState<{ start: string; end: string } | null>(null);
  const [editEvent, setEditEvent] = useState<CalendarEvent | null>(null);

  const saveNextcloudEvent = useCallback(async (cal: CalendarConfig, payload: CreateEventPayload, sourceEvent?: CalendarEvent) => {
    if (sourceEvent?.sourceId) {
      await updateNextcloudEvent(cal, sourceEvent.sourceId, payload);
    } else {
      await createNextcloudEvent(cal, payload);
    }
    ncRefresh();
  }, [ncRefresh]);

  const saveEventKitEvent = useCallback(async (cal: CalendarConfig, payload: CreateEventPayload, sourceEvent?: CalendarEvent) => {
    const { invoke } = await import('@tauri-apps/api/core');
    const attendees = payload.attendees?.map((a) => ({ email: a.email, name: a.name ?? null })) ?? null;
    if (sourceEvent?.sourceId) {
      await invoke('update_eventkit_event', {
        payload: {
          event_id: sourceEvent.sourceId,
          title: payload.title, start: payload.start, end: payload.end,
          is_all_day: payload.isAllday, location: payload.location ?? null,
          notes: payload.description ?? null, attendees,
        },
      });
    } else {
      await invoke('create_eventkit_event', {
        payload: {
          calendar_id: cal.eventKitCalendarId,
          title: payload.title, start: payload.start, end: payload.end,
          is_all_day: payload.isAllday, location: payload.location ?? null,
          notes: payload.description ?? null, attendees,
        },
      });
    }
    ekRefresh();
  }, [ekRefresh]);

  const saveGoogleEvent = useCallback(async (cal: CalendarConfig, payload: CreateEventPayload, sourceEvent?: CalendarEvent) => {
    if (!cal.googleAccountId) throw new Error('Compte Google introuvable');
    const token = await getValidToken(cal.googleAccountId);
    if (!token) throw new Error('Token invalide. Reconnectez votre compte Google.');
    if (sourceEvent?.sourceId) {
      await updateEvent(token, cal, sourceEvent.sourceId, payload);
    } else {
      await createEvent(token, cal, payload);
    }
    googleRefresh();
  }, [getValidToken, googleRefresh]);

  const handleRsvp = useCallback(async (
    event: CalendarEvent,
    status: 'ACCEPTED' | 'DECLINED' | 'TENTATIVE',
  ) => {
    const cal = calendars.find((c) => c.id === event.calendarId);
    if (!cal) throw new Error('Calendrier introuvable');

    if (cal.type === 'google') {
      if (!cal.googleAccountId || !event.sourceId || !cal.ownerEmail) {
        throw new Error('Informations manquantes pour répondre à cette invitation');
      }
      const token = await getValidToken(cal.googleAccountId);
      if (!token) throw new Error('Token invalide. Reconnectez votre compte Google.');
      await respondToGoogleEvent(token, cal, event.sourceId, cal.ownerEmail, status);
      googleRefresh();
    } else if (cal.type === 'nextcloud') {
      if (!event.sourceId || !cal.ownerEmail) {
        throw new Error('Informations manquantes pour répondre à cette invitation');
      }
      await respondToNextcloudEvent(cal, event.sourceId, cal.ownerEmail, status);
      ncRefresh();
    } else if (cal.type === 'eventkit') {
      throw new Error('Pour les calendriers EventKit, répondez via l\'application Calendrier macOS.');
    }
  }, [calendars, getValidToken, googleRefresh, ncRefresh]);

  const handleSaveEvent = useCallback(async (payload: CreateEventPayload, sourceEvent?: CalendarEvent) => {
    const cal = calendars.find((c) => c.id === payload.calendarId);
    if (!cal) throw new Error('Calendrier introuvable');
    if (cal.type === 'nextcloud') return saveNextcloudEvent(cal, payload, sourceEvent);
    if (cal.type === 'eventkit') return saveEventKitEvent(cal, payload, sourceEvent);
    return saveGoogleEvent(cal, payload, sourceEvent);
  }, [calendars, saveNextcloudEvent, saveEventKitEvent, saveGoogleEvent]);

  const syncDate = useCallback(() => {
    const d = calendarRef.current?.getInstance()?.getDate().toDate();
    if (d) setCurrentDate(d);
  }, []);

  const handlePrev = () => { calendarRef.current?.getInstance()?.prev(); syncDate(); };
  const handleNext = () => { calendarRef.current?.getInstance()?.next(); syncDate(); };
  const handleToday = () => { calendarRef.current?.getInstance()?.today(); setCurrentDate(new Date()); };
  const handleViewChange = (v: ViewType) => { setView(v); setTimeout(syncDate, 50); };

  const handleNavigateToDate = useCallback((date: Date) => {
    calendarRef.current?.getInstance()?.setDate(date);
    setCurrentDate(date);
  }, []);

  const handleClickEvent = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ event }: { event: any }) => {
      const found = events.find((e) => e.id === event.id);
      setSelectedEvent(found ?? null);
    },
    [events]
  );

  // Open creation modal when the user clicks/drags on an empty slot (only if Google calendars exist)
  const handleSelectDateTime = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ start, end }: { start: any; end: any }) => {
      if (!writableCalendars.length) return;
      const toISO = (d: unknown) => {
        if (d instanceof Date) return d.toISOString();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (d && typeof (d as any).toDate === 'function') return (d as any).toDate().toISOString();
        return String(d);
      };
      setCreateModalState({ start: toISO(start), end: toISO(end) });
    },
    [writableCalendars]
  );

  const selectedCalendar = selectedEvent
    ? calendars.find((c) => c.id === selectedEvent.calendarId) ?? null
    : null;

  const tuiCalendars = calendars
    .filter((c) => c.visible)
    .map((c) => ({
      id: c.id,
      name: c.name,
      color: '#fff',
      backgroundColor: c.color,
      dragBackgroundColor: c.color,
      borderColor: c.color,
    }));

  const tuiEvents = toTUIEvents(
    events.filter((e) => calendars.find((c) => c.id === e.calendarId)?.visible),
    calendars,
    theme === 'dark'
  );

  const isWorkweek = view === 'workweek';
  const tuiView = isWorkweek ? 'week' : view;

  return (
    <div className="app">
      <AppHeader
        view={view}
        onViewChange={handleViewChange}
        onPrev={handlePrev}
        onNext={handleNext}
        onToday={handleToday}
        onRefresh={refresh}
        dateLabel={formatDateLabel(currentDate, view)}
        loading={loading}
        onToggleSidebar={handleCollapseToggle}
      />
      <div className="app-body">
        {!sidebarCollapsed && (
          <Sidebar
            calendars={calendars}
            onToggle={toggleCalendar}
            onUpdate={updateCalendar}
            loading={loading}
            errors={errors}
            width={sidebarWidth}
            currentDate={currentDate}
            onNavigateToDate={handleNavigateToDate}
          />
        )}
        {!sidebarCollapsed && (
          <button
            type="button"
            className="sidebar-resize-handle"
            aria-label="Redimensionner la sidebar"
            onMouseDown={handleResizeStart}
          />
        )}
        <div className="calendar-container">
          <Calendar
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ref={calendarRef as any}
            height="100%"
            view={tuiView}
            isReadOnly={writableCalendars.length === 0}
            usageStatistics={false}
            calendars={tuiCalendars}
            events={tuiEvents}
            theme={theme === 'dark' ? DARK_THEME : LIGHT_THEME}
            onClickEvent={handleClickEvent}
            onSelectDateTime={handleSelectDateTime}
            template={{
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              time: (event: any) => {
                const start = formatTime(event.start);
                const end = formatTime(event.end);
                const timeLabel = start && end ? `de ${start} à ${end}` : '';
                return `<div style="overflow:hidden;height:100%;line-height:1.3">
                  <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${event.title}</div>
                  ${timeLabel ? `<div style="opacity:0.85;white-space:nowrap">${timeLabel}</div>` : ''}
                </div>`;
              },
            }}
            week={{
              startDayOfWeek: 1,
              workweek: isWorkweek,
              taskView: false,
              eventView: ['allday', 'time'],
              showTimezoneCollapseButton: false,
              timezonesCollapsed: true,
            }}
            month={{ startDayOfWeek: 1 }}
          />
        </div>
      </div>

      <EventModal
        event={selectedEvent}
        calendar={selectedCalendar}
        onClose={() => setSelectedEvent(null)}
        onEdit={
          selectedEvent && (selectedCalendar?.type === 'google' || selectedCalendar?.type === 'eventkit' || selectedCalendar?.type === 'nextcloud')
            ? () => { setEditEvent(selectedEvent); setSelectedEvent(null); }
            : undefined
        }
        onRsvp={
          selectedEvent?.selfRsvpStatus
            ? (status) => handleRsvp(selectedEvent, status)
            : undefined
        }
      />

      {createModalState && writableCalendars.length > 0 && (
        <CreateEventModal
          initialStart={createModalState.start}
          initialEnd={createModalState.end}
          writableCalendars={writableCalendars}
          allEvents={events}
          onSubmit={(payload) => handleSaveEvent(payload)}
          onClose={() => {
            setCreateModalState(null);
            calendarRef.current?.getInstance()?.clearGridSelections();
          }}
        />
      )}

      {editEvent && writableCalendars.length > 0 && (
        <CreateEventModal
          initialStart={editEvent.start}
          initialEnd={editEvent.end}
          writableCalendars={writableCalendars}
          allEvents={events}
          editEvent={editEvent}
          onSubmit={(payload) => handleSaveEvent(payload, editEvent)}
          onClose={() => setEditEvent(null)}
        />
      )}
    </div>
  );
}
