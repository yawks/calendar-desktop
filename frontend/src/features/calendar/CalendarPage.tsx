import '@toast-ui/calendar/dist/toastui-calendar.min.css';

import { CalendarEvent } from '../../shared/types';
import { useEffect, useMemo, useRef, useState } from 'react';

import AppHeader, { EventVisibilityStatus } from './components/AppHeader';
import Calendar from '@toast-ui/react-calendar';
import SearchModal from './components/SearchModal';
import SearchResultsView from './components/SearchResultsView';
import CreateEventModal from './components/CreateEventModal';
import EventModal from './components/EventModal';
import RecurringChoiceModal from './components/RecurringChoiceModal';
import Sidebar from './components/Sidebar';
import { useCalendarLogic } from './hooks/useCalendarLogic';
import { formatDateLabel, DARK_THEME, LIGHT_THEME, toTUIEvents, getViewRange, formatTime } from './utils/calendarUtils';

export default function CalendarPage() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const [visibleEventStatuses, setVisibleEventStatuses] = useState<Set<EventVisibilityStatus>>(
    () => new Set(['accepted', 'tentative', 'pending', 'declined', 'cancelled'])
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    globalThis.addEventListener('keydown', handleKeyDown);
    return () => globalThis.removeEventListener('keydown', handleKeyDown);
  }, []);

  const {
    calendarRef,
    view,
    currentDate,
    selectedEvent,
    setSelectedEvent,
    sidebarCollapsed,
    sidebarWidth,
    handleCollapseToggle,
    handleResizeStart,
    calendars,
    toggleCalendar,
    updateCalendar,
    reorderCalendars,
    groups,
    addGroup,
    removeGroup,
    updateGroup,
    tags,
    eventTags,
    addTag,
    removeTag,
    updateTag,
    events,
    loading,
    errors,
    refresh,
    theme,
    createModalState,
    setCreateModalState,
    editEvent,
    setEditEvent,
    handlePrev,
    handleNext,
    handleToday,
    getValidToken,
    getExchangeRefreshToken,
    handleNavigateToDate,
    handleViewChange,
    handleSaveEvent,
    handleRsvp,
    handleDeleteEvent,
    handleStartEdit,
    handleBeforeUpdateEvent,
    isEventEditable,
    isExchangeOrganizer,
    showRecurringModal,
    handleRecurringModalChoice,
  } = useCalendarLogic();

  const visibleEvents = useMemo(() => events.filter((event) => {
    let status: EventVisibilityStatus = 'accepted';
    if (event.isCancelled) status = 'cancelled';
    else if (event.isDeclined || event.selfRsvpStatus === 'DECLINED') status = 'declined';
    else if (event.selfRsvpStatus === 'TENTATIVE') status = 'tentative';
    else if (event.isUnaccepted || event.selfRsvpStatus === 'NEEDS-ACTION' || event.selfRsvpStatus === 'DELEGATED') status = 'pending';
    return visibleEventStatuses.has(status);
  }), [events, visibleEventStatuses]);

  const handleToggleEventStatus = (status: EventVisibilityStatus) => {
    setVisibleEventStatuses((current) => {
      const next = new Set(current);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const tuiEvents = useMemo(() =>
    toTUIEvents(visibleEvents, calendars, theme === 'dark', tags, eventTags),
    [visibleEvents, calendars, theme, tags, eventTags]
  );

  const tuiCalendars = useMemo(() => calendars
    .filter((c) => c.visible)
    .map((c) => ({
      id: c.id,
      name: c.name,
      color: '#fff',
      backgroundColor: c.color,
      dragBackgroundColor: c.color,
      borderColor: c.color,
    })), [calendars]);

  type TuiEventStyle = { backgroundColor: string; color: string; borderColor: string; customStyle: Record<string, string>; state: string; title: string };
  const prevTuiStylesRef = useRef<Map<string, TuiEventStyle>>(new Map());
  useEffect(() => {
    const inst = calendarRef.current?.getInstance() as any;
    if (!inst?.updateEvent) return;
    const prevMap = prevTuiStylesRef.current;
    tuiEvents.forEach((ev) => {
      const prev = prevMap.get(ev.id);
      if (!prev) return;
      if (
        prev.backgroundColor !== ev.backgroundColor ||
        prev.color !== ev.color ||
        prev.state !== ev.state ||
        prev.title !== ev.title ||
        JSON.stringify(prev.customStyle) !== JSON.stringify(ev.customStyle)
      ) {
        inst.updateEvent(ev.id, ev.calendarId, {
          backgroundColor: ev.backgroundColor,
          color: ev.color,
          borderColor: ev.borderColor,
          customStyle: ev.customStyle,
          state: ev.state,
          title: ev.title,
          raw: ev.raw,
        });
      }
    });
    const newMap = new Map<string, TuiEventStyle>();
    tuiEvents.forEach((ev) => newMap.set(ev.id, {
      backgroundColor: ev.backgroundColor,
      color: ev.color,
      borderColor: ev.borderColor,
      customStyle: ev.customStyle,
      state: ev.state,
      title: ev.title,
    }));
    prevTuiStylesRef.current = newMap;
  }, [tuiEvents]);

  useEffect(() => {
    if (view === 'month' || searchQuery !== null) return;
    const timer = setTimeout(() => {
      const scrollPanel = document.querySelector('.toastui-calendar-panel.toastui-calendar-time') as HTMLElement | null;
      if (!scrollPanel) return;
      const range = getViewRange(currentDate, view);
      const timedEvents = visibleEvents.filter(ev =>
        !ev.isAllday &&
        new Date(ev.start) >= range.start &&
        new Date(ev.start) <= range.end
      );
      if (timedEvents.length === 0) return;
      const earliest = timedEvents.reduce((min, ev) =>
        new Date(ev.start) < new Date(min.start) ? ev : min
      , timedEvents[0]);
      const d = new Date(earliest.start);
      const targetMinutes = Math.max(0, d.getHours() * 60 + d.getMinutes() - 60);
      scrollPanel.scrollTop = (targetMinutes / (24 * 60)) * scrollPanel.scrollHeight;
    }, 100);
    return () => clearTimeout(timer);
  }, [visibleEvents, view, currentDate, searchQuery]);

  const isWorkweek = view === 'workweek';
  const tuiView = isWorkweek ? 'week' : view;
  const writableCalendars = useMemo(() => calendars.filter(
    (c) => c.type === 'google' || c.type === 'eventkit' || c.type === 'nextcloud' || c.type === 'exchange'
  ), [calendars]);

  return (
    <div className={`app ${theme === 'dark' ? 'dark-theme' : ''}`}>
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
        onSearch={() => setSearchOpen(true)}
        visibleEventStatuses={visibleEventStatuses}
        onToggleEventStatus={handleToggleEventStatus}
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
          {searchQuery === null ? <Calendar
            ref={calendarRef as any}
            height="100%"
            view={tuiView}
            calendars={tuiCalendars}
            events={tuiEvents}
            theme={theme === 'dark' ? DARK_THEME : LIGHT_THEME}
            onClickEvent={({ event }: any) => {
              const ev = events.find((e: CalendarEvent) => e.id === event.id);
              if (ev) setSelectedEvent(ev);
            }}
            onSelectDateTime={({ start, end }: any) => {
               const toISO = (d: unknown) => {
                if (d instanceof Date) return d.toISOString();
                if (d && typeof (d as any).toDate === 'function') return (d as any).toDate().toISOString();
                return String(d);
              };
              setCreateModalState({ start: toISO(start), end: toISO(end) });
            }}
            onBeforeUpdateEvent={handleBeforeUpdateEvent}
             template={{
              time: (event: any) => {
                const start = formatTime(event.start);
                const end = formatTime(event.end);
                const timeLabel = start && end ? `de ${start} à ${end}` : '';
                const tagColor = event.raw?.tagColor;
                const hatchColor = event.raw?.hatchColor;
                const isDeclined = event.raw?.isDeclined || event.raw?.isCancelled;
                const hatch = hatchColor
                  ? `<div style="position:absolute;inset:0;background:repeating-linear-gradient(-45deg,${hatchColor} 0,${hatchColor} 4px,transparent 4px,transparent 8px);pointer-events:none;z-index:0;"></div>`
                  : '';
                const dot = tagColor
                  ? `<span style="position:absolute;bottom:3px;right:3px;width:7px;height:7px;border-radius:50%;background:${tagColor};border:1.5px solid rgba(255,255,255,0.5);display:block;pointer-events:none;z-index:1;"></span>`
                  : '';
                return `<div style="position:absolute;inset:0;padding:1px 0 0 3px;line-height:1.3;overflow:hidden">
                  ${hatch}
                  <div style="position:relative;z-index:1;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis${isDeclined ? ';text-decoration:line-through' : ''}">${event.title}</div>
                  ${timeLabel ? `<div style="position:relative;z-index:1;opacity:0.85;white-space:nowrap">${timeLabel}</div>` : ''}
                  ${dot}
                </div>`;
              },
              allday: (event: any) => {
                const tagColor = event.raw?.tagColor;
                const hatchColor = event.raw?.hatchColor;
                const isDeclined = event.raw?.isDeclined || event.raw?.isCancelled;
                const hatch = hatchColor
                  ? `<div style="position:absolute;inset:0;background:repeating-linear-gradient(-45deg,${hatchColor} 0,${hatchColor} 4px,transparent 4px,transparent 8px);pointer-events:none;"></div>`
                  : '';
                const dot = tagColor
                  ? `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${tagColor};border:1.5px solid rgba(255,255,255,0.5);margin-left:4px;vertical-align:middle;flex-shrink:0;position:relative;z-index:1;"></span>`
                  : '';
                return `<div style="position:relative;overflow:hidden;height:100%;">
                  ${hatch}
                  <span style="position:relative;z-index:1;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis${isDeclined ? ';text-decoration:line-through' : ''}">${event.title}</span>${dot}
                </div>`;
              },
            }}
            week={{
              startDayOfWeek: 1,
              workweek: isWorkweek,
              taskView: false,
              eventView: ['allday', 'time'],
            }}
            month={{ startDayOfWeek: 1 }}
          /> : (
            <SearchResultsView
              query={searchQuery}
              events={events}
              calendars={calendars}
              onClose={() => setSearchQuery(null)}
              onEventClick={(ev) => { setSearchQuery(null); setSelectedEvent(ev); }}
            />
          )}
        </div>
      </div>

      {selectedEvent && (
        <EventModal
          event={selectedEvent}
          calendar={calendars.find(c => c.id === selectedEvent.calendarId) || null}
          onClose={() => setSelectedEvent(null)}
          onEdit={
            isEventEditable(selectedEvent)
              ? () => { void handleStartEdit(selectedEvent); }
              : undefined
          }
          onDelete={() => handleDeleteEvent(selectedEvent).then(() => setSelectedEvent(null))}
          onRsvp={
            selectedEvent.selfRsvpStatus && !isExchangeOrganizer(selectedEvent)
              ? (status, comment) => handleRsvp(selectedEvent, status, comment)
              : undefined
          }
          isOrganizer={isExchangeOrganizer(selectedEvent)}
          overlayChildren={showRecurringModal ? <RecurringChoiceModal onChoice={handleRecurringModalChoice} /> : null}
        />
      )}

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

      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        events={events}
        calendars={calendars}
        onSearch={(q) => { setSearchQuery(q); setSearchOpen(false); }}
      />

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
