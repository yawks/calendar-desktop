import '@toast-ui/calendar/dist/toastui-calendar.min.css';

import { CalendarEvent, CreateEventPayload, ViewType } from '../types';
import { DARK_THEME, LIGHT_THEME } from '../constants/calendarThemes';
import { DEMO_CALENDARS, DEMO_EVENTS } from '../demo/demoData';
import { formatDateLabel, formatTime, getViewRange, toTUIEvents } from '../utils/calendarUtils';
import { useCallback, useRef, useState } from 'react';

import AppHeader from '../components/AppHeader';
import Calendar from '@toast-ui/react-calendar';
import CreateEventModal from '../components/CreateEventModal';
import EventModal from '../components/EventModal';
import Sidebar from '../components/Sidebar';
import { useCalendarGroups } from '../store/CalendarGroupStore';
import { useCalendarOperations } from '../hooks/useCalendarOperations';
import { useCalendars } from '../store/CalendarStore';
import { useEWSEvents } from '../hooks/useEWSEvents';
import { useEventKitEvents } from '../hooks/useEventKitEvents';
import { useExchangeAuth } from '../store/ExchangeAuthStore';
import { useGoogleAuth } from '../store/GoogleAuthStore';
import { useGoogleEvents } from '../hooks/useGoogleEvents';
import { useICSEvents } from '../hooks/useICSEvents';
import { useNextcloudEvents } from '../hooks/useNextcloudEvents';
import { useTags } from '../store/TagStore';
import { useTheme } from '../store/ThemeStore';

const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

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

  const { calendars: realCalendars, toggleCalendar, updateCalendar, reorderCalendars } = useCalendars();
  const { groups, addGroup, removeGroup, updateGroup } = useCalendarGroups();
  const { tags, eventTags, addTag, removeTag, updateTag, setEventTag, removeEventTag } = useTags();
  const { events: icsEvents, loading: icsLoading, errors: icsErrors, refresh: icsRefresh } = useICSEvents(DEMO_MODE ? [] : realCalendars);
  const { events: googleEvents, loading: googleLoading, errors: googleErrors, refresh: googleRefresh } = useGoogleEvents(DEMO_MODE ? [] : realCalendars);
  const { events: ncEvents, loading: ncLoading, errors: ncErrors, refresh: ncRefresh } = useNextcloudEvents(DEMO_MODE ? [] : realCalendars);
  const { events: ekEvents, loading: ekLoading, errors: ekErrors, refresh: ekRefresh } = useEventKitEvents(DEMO_MODE ? [] : realCalendars);
  const { events: ewsEvents, loading: ewsLoading, errors: ewsErrors, refresh: ewsRefresh } = useEWSEvents(DEMO_MODE ? [] : realCalendars);
  const { getValidToken } = useGoogleAuth();
  const { accounts: exchangeAccounts, getValidToken: getExchangeToken, getRefreshToken: getExchangeRefreshToken } = useExchangeAuth();
  const { resolved: theme } = useTheme();

  const [createModalState, setCreateModalState] = useState<{ start: string; end: string } | null>(null);
  const [editEvent, setEditEvent] = useState<CalendarEvent | null>(null);

  const calendars = DEMO_MODE ? DEMO_CALENDARS : realCalendars;

  const refresh = useCallback(async () => {
    await Promise.all([icsRefresh(), googleRefresh(), ncRefresh(), ekRefresh(), ewsRefresh()]);
  }, [icsRefresh, googleRefresh, ncRefresh, ekRefresh, ewsRefresh]);

  const {
    deletedEventIds,
    optimisticCreated,
    optimisticUpdated,
    handleRsvp,
    handleDeleteEvent,
    handleSaveEvent,
  } = useCalendarOperations({
    calendars,
    getValidToken,
    getExchangeToken,
    googleRefresh,
    ncRefresh,
    ewsRefresh,
    ekRefresh,
    setEventTag,
    removeEventTag,
  });

  const allEvents = DEMO_MODE ? DEMO_EVENTS : [...icsEvents, ...googleEvents, ...ncEvents, ...ekEvents, ...ewsEvents];
  const events = [
    ...allEvents
      .filter((e) => !deletedEventIds.has(e.id))
      .map((e) => optimisticUpdated.get(e.id) ?? e),
    ...optimisticCreated,
  ];
  const loading = DEMO_MODE ? false : (icsLoading || googleLoading || ncLoading || ekLoading || ewsLoading);
  const errors = DEMO_MODE ? {} : { ...icsErrors, ...googleErrors, ...ncErrors, ...ekErrors, ...ewsErrors };

  // Calendars available for event creation
  const writableCalendars = calendars.filter(
    (c) => c.type === 'google' || c.type === 'eventkit' || c.type === 'nextcloud' || c.type === 'exchange'
  );

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

  const isEventEditable = useCallback((event: CalendarEvent) => {
    const cal = calendars.find((c) => c.id === event.calendarId);
    if (!cal) return false;
    if (cal.type !== 'google' && cal.type !== 'eventkit' && cal.type !== 'nextcloud') return false;
    const attendees = event.attendees;
    return !attendees?.length || attendees.some((a) => a.isOrganizer && a.email === cal.ownerEmail);
  }, [calendars]);

  const isExchangeOrganizer = useCallback((event: CalendarEvent) => {
    const cal = calendars.find((c) => c.id === event.calendarId);
    if (!cal || cal.type !== 'exchange' || !cal.exchangeAccountId) return false;
    if (!event.attendees?.length) return true;
    const account = exchangeAccounts.find((a) => a.id === cal.exchangeAccountId);
    if (!account) return false;
    return event.attendees.some((a) => {
      if (!a.isOrganizer) return false;
      if (a.email.toLowerCase() === account.email.toLowerCase()) return true;
      return !!account.displayName && a.name.toLowerCase() === account.displayName.toLowerCase();
    });
  }, [calendars, exchangeAccounts]);

  const handleBeforeUpdateEvent = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ event, changes }: { event: any; changes: any }) => {
      const originalEvent = events.find((e) => e.id === event.id);
      if (!originalEvent) return;

      if (!isEventEditable(originalEvent)) return;

      const toISO = (d: unknown): string => {
        if (d instanceof Date) return d.toISOString();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (d && typeof (d as any).toDate === 'function') return (d as any).toDate().toISOString();
        return String(d);
      };

      const newStart = changes.start ? toISO(changes.start) : originalEvent.start;
      let newEnd: string;
      if (changes.end) {
        newEnd = toISO(changes.end);
      } else if (changes.start) {
        const duration = new Date(originalEvent.end).getTime() - new Date(originalEvent.start).getTime();
        newEnd = new Date(new Date(newStart).getTime() + duration).toISOString();
      } else {
        newEnd = originalEvent.end;
      }

      if (originalEvent.isAllday && changes.end) {
        const d = new Date(newEnd);
        d.setDate(d.getDate() + 1);
        newEnd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }

      const payload: CreateEventPayload = {
        title: originalEvent.title,
        start: newStart,
        end: newEnd,
        isAllday: originalEvent.isAllday,
        calendarId: originalEvent.calendarId,
        location: originalEvent.location,
        description: originalEvent.description,
        attendees: originalEvent.attendees?.map((a) => ({ email: a.email, name: a.name })),
      };

      void handleSaveEvent(payload, originalEvent);
    },
    [events, handleSaveEvent, isEventEditable]
  );

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
    theme === 'dark',
    tags,
    eventTags
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
            groups={groups}
            tags={tags}
            onToggle={toggleCalendar}
            onUpdate={updateCalendar}
            onReorderCalendars={reorderCalendars}
            onAddGroup={addGroup}
            onUpdateGroup={updateGroup}
            onRemoveGroup={removeGroup}
            onAddTag={addTag}
            onUpdateTag={updateTag}
            onRemoveTag={removeTag}
            events={events}
            eventTags={eventTags}
            viewRange={getViewRange(currentDate, view)}
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
            onBeforeUpdateEvent={handleBeforeUpdateEvent}
            onSelectDateTime={handleSelectDateTime}
            template={{
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              time: (event: any) => {
                const start = formatTime(event.start);
                const end = formatTime(event.end);
                const timeLabel = start && end ? `de ${start} à ${end}` : '';
                const tagColor = event.raw?.tagColor;
                const declined = event.raw?.isDeclined;
                const dot = tagColor
                  ? `<span style="position:absolute;bottom:3px;right:3px;width:7px;height:7px;border-radius:50%;background:${tagColor};border:1.5px solid rgba(255,255,255,0.5);display:block;pointer-events:none"></span>`
                  : '';
                const strikeStyle = declined ? 'text-decoration:line-through;' : '';
                return `<div style="position:absolute;inset:0;padding:1px 0 0 3px;line-height:1.3;overflow:hidden">
                  <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${strikeStyle}">${event.title}</div>
                  ${timeLabel ? `<div style="opacity:0.85;white-space:nowrap">${timeLabel}</div>` : ''}
                  ${dot}
                </div>`;
              },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              allday: (event: any) => {
                const tagColor = event.raw?.tagColor;
                const declined = event.raw?.isDeclined;
                const dot = tagColor
                  ? `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${tagColor};border:1.5px solid rgba(255,255,255,0.5);margin-left:4px;vertical-align:middle;flex-shrink:0"></span>`
                  : '';
                const strikeStyle = declined ? 'text-decoration:line-through;' : '';
                return `<span style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${strikeStyle}">${event.title}</span>${dot}`;
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
          selectedEvent && isEventEditable(selectedEvent)
            ? () => { setEditEvent(selectedEvent); setSelectedEvent(null); }
            : undefined
        }
        onDelete={
          selectedEvent && (isEventEditable(selectedEvent) || isExchangeOrganizer(selectedEvent))
            ? () => handleDeleteEvent(selectedEvent).then(() => setSelectedEvent(null))
            : undefined
        }
        onRsvp={
          selectedEvent?.selfRsvpStatus &&
          selectedCalendar?.type !== 'eventkit' &&
          !isExchangeOrganizer(selectedEvent)
            ? (status, comment) => handleRsvp(selectedEvent, status, comment).then(() => {
                const updated = optimisticUpdated.get(selectedEvent.id);
                if (updated) setSelectedEvent(updated);
              })
            : undefined
        }
        isOrganizer={selectedEvent ? isExchangeOrganizer(selectedEvent) : false}
      />

      {createModalState && writableCalendars.length > 0 && (
        <CreateEventModal
          initialStart={createModalState.start}
          initialEnd={createModalState.end}
          writableCalendars={writableCalendars}
          allEvents={events}
          onSubmit={async (payload) => { await handleSaveEvent(payload); }}
          onClose={() => {
            setCreateModalState(null);
            calendarRef.current?.getInstance()?.clearGridSelections();
          }}
          getValidToken={getValidToken}
          getExchangeRefreshToken={getExchangeRefreshToken}
        />
      )}

      {editEvent && writableCalendars.length > 0 && (
        <CreateEventModal
          initialStart={editEvent.start}
          initialEnd={editEvent.end}
          writableCalendars={writableCalendars}
          allEvents={events}
          editEvent={editEvent}
          onSubmit={async (payload) => { await handleSaveEvent(payload, editEvent); }}
          onClose={() => setEditEvent(null)}
          getValidToken={getValidToken}
          getExchangeRefreshToken={getExchangeRefreshToken}
        />
      )}
    </div>
  );
}
