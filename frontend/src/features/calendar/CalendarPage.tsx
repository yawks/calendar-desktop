import '@toast-ui/calendar/dist/toastui-calendar.min.css';

import { CalendarEvent } from '../../shared/types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

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
  const { t } = useTranslation();
  const [isMobile, setIsMobile] = useState(() => globalThis.matchMedia?.('(max-width: 700px)').matches ?? false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const [calendarTransition, setCalendarTransition] = useState<'previous' | 'next' | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
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

  useEffect(() => {
    const closeOnBrowserBack = () => setMobileSidebarOpen(false);
    globalThis.addEventListener('popstate', closeOnBrowserBack);
    return () => globalThis.removeEventListener('popstate', closeOnBrowserBack);
  }, []);

  const toggleSidebar = () => {
    if (!isMobile) {
      handleCollapseToggle();
      return;
    }
    if (mobileSidebarOpen) {
      if (globalThis.history.state?.calendarSidebar) globalThis.history.back();
      else setMobileSidebarOpen(false);
      return;
    }
    globalThis.history.pushState({ ...globalThis.history.state, calendarSidebar: true }, '');
    setMobileSidebarOpen(true);
  };

  const closeMobileSidebar = () => {
    if (globalThis.history.state?.calendarSidebar) globalThis.history.back();
    else setMobileSidebarOpen(false);
  };

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
    handleCancelEvent,
    handleStartEdit,
    handleBeforeUpdateEvent,
    isEventEditable,
    isExchangeOrganizer,
    showRecurringModal,
    handleRecurringModalChoice,
  } = useCalendarLogic();

  useEffect(() => {
    const media = globalThis.matchMedia('(max-width: 700px)');
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const visibleEvents = useMemo(() => events.filter((event) => {
    let status: EventVisibilityStatus = 'accepted';
    if (event.isCancelled) status = 'cancelled';
    else if (event.isDeclined || event.selfRsvpStatus === 'DECLINED') status = 'declined';
    else if (event.selfRsvpStatus === 'TENTATIVE') status = 'tentative';
    else if (event.isUnaccepted || event.selfRsvpStatus === 'NEEDS-ACTION' || event.selfRsvpStatus === 'DELEGATED') status = 'pending';
    return visibleEventStatuses.has(status);
  }), [events, visibleEventStatuses]);
  const eventsRef = useRef(events);
  eventsRef.current = events;

  const handleClickCalendarEvent = useCallback(({ event }: any) => {
    const rawEvent = event.raw as CalendarEvent | undefined;
    const selected = rawEvent?.id
      ? rawEvent
      : eventsRef.current.find((candidate) => candidate.id === event.id);
    if (!selected) return;
    // Toast UI emits through its own event bus. Flush this external update so
    // Android WebView does not defer opening the dialog until the next tap.
    flushSync(() => setSelectedEvent(selected));
  }, [setSelectedEvent]);

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

  useEffect(() => {
    if (searchQuery !== null) return;
    calendarRef.current?.getInstance()?.setDate(currentDate);
  }, [searchQuery]);

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
      const earliest = timedEvents.length > 0 ? timedEvents.reduce((min, ev) =>
        new Date(ev.start) < new Date(min.start) ? ev : min
      , timedEvents[0]) : null;
      const d = earliest ? new Date(earliest.start) : null;
      const targetMinutes = d
        ? Math.max(0, d.getHours() * 60 + d.getMinutes() - 60)
        : 8 * 60;
      scrollPanel.scrollTop = (targetMinutes / (24 * 60)) * scrollPanel.scrollHeight;
    }, 100);
    return () => clearTimeout(timer);
  }, [visibleEvents, view, currentDate, searchQuery, isMobile]);

  const isWorkweek = view === 'workweek';
  const tuiView = isWorkweek ? 'week' : view;
  const writableCalendars = useMemo(() => calendars.filter(
    (c) => c.type === 'google' || c.type === 'nextcloud' || c.type === 'exchange'
  ), [calendars]);

  const handleCalendarTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobile || event.touches.length !== 1) return;
    swipeStartRef.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  };

  const navigateCalendar = (direction: 'previous' | 'next') => {
    if (direction === 'next') handleNext();
    else handlePrev();
    setCalendarTransition(direction);
  };

  const handleCalendarTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!isMobile || !start || event.changedTouches.length !== 1) return;
    const deltaX = event.changedTouches[0].clientX - start.x;
    const deltaY = event.changedTouches[0].clientY - start.y;
    if (Math.abs(deltaX) < 12 && Math.abs(deltaY) < 12) {
      const touch = event.changedTouches[0];
      const pointTarget = document.elementFromPoint(touch.clientX, touch.clientY);
      const pathTarget = event.nativeEvent.composedPath().find((node): node is Element => node instanceof Element);
      const eventElement = pointTarget?.closest<HTMLElement>('[data-event-id][data-calendar-id]')
        ?? pathTarget?.closest<HTMLElement>('[data-event-id][data-calendar-id]')
        ?? (event.target as Element).closest<HTMLElement>('[data-event-id][data-calendar-id]');
      if (eventElement) {
        const eventId = eventElement.dataset.eventId;
        const calendarId = eventElement.dataset.calendarId;
        const selected = eventsRef.current.find((candidate) =>
          candidate.id === eventId && candidate.calendarId === calendarId
        ) ?? eventsRef.current.find((candidate) => candidate.id === eventId);
        if (selected) flushSync(() => setSelectedEvent(selected));
      }
      return;
    }
    if (Math.abs(deltaX) < 60 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
    navigateCalendar(deltaX < 0 ? 'next' : 'previous');
  };

  return (
    <div className={`app calendar-app ${theme === 'dark' ? 'dark-theme' : ''}`}>
      <AppHeader
        view={view}
        onViewChange={handleViewChange}
        onPrev={() => navigateCalendar('previous')}
        onNext={() => navigateCalendar('next')}
        onToday={handleToday}
        onRefresh={refresh}
        dateLabel={formatDateLabel(currentDate, view)}
        loading={loading}
        onToggleSidebar={toggleSidebar}
        onSearch={() => setSearchOpen(true)}
        visibleEventStatuses={visibleEventStatuses}
        onToggleEventStatus={handleToggleEventStatus}
      />

      <div className="app-body">
        {isMobile && mobileSidebarOpen && (
          <button
            type="button"
            className="calendar-sidebar-backdrop"
            aria-label={t('event.close')}
            onClick={closeMobileSidebar}
          />
        )}
        {(isMobile ? mobileSidebarOpen : !sidebarCollapsed) && (
          <>
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
            onNavigateToDate={(date) => {
              handleNavigateToDate(date);
              if (isMobile) closeMobileSidebar();
            }}
          />
          {isMobile && (
            <button
              type="button"
              className="calendar-mobile-sidebar-close"
              aria-label={t('event.close')}
              onClick={closeMobileSidebar}
            >
              <X size={22} />
            </button>
          )}
          </>
        )}
        {!isMobile && !sidebarCollapsed && (
          <button
            type="button"
            className="sidebar-resize-handle"
            aria-label={t('header.resizeSidebar')}
            onMouseDown={handleResizeStart}
          />
        )}

        <div
          className={`calendar-container${calendarTransition ? ` calendar-container--${calendarTransition}` : ''}`}
          onTouchStartCapture={handleCalendarTouchStart}
          onTouchEndCapture={handleCalendarTouchEnd}
          onAnimationEnd={(event) => {
            if (event.animationName.startsWith('calendar-period-enter-')) setCalendarTransition(null);
          }}
        >
          {searchQuery === null ? <Calendar
            ref={calendarRef as any}
            height="100%"
            view={tuiView}
            calendars={tuiCalendars}
            events={tuiEvents}
            theme={theme === 'dark' ? DARK_THEME : LIGHT_THEME}
            onClickEvent={handleClickCalendarEvent}
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
                const isDeclined = event.raw?.isDeclined || event.raw?.isCancelled;
                const dot = tagColor
                  ? `<span style="position:absolute;bottom:3px;right:3px;width:7px;height:7px;border-radius:50%;background:${tagColor};border:1.5px solid rgba(255,255,255,0.5);display:block;pointer-events:none;z-index:1;"></span>`
                  : '';
                return `<div class="calendar-event-content calendar-event-content--time">
                  <div class="calendar-event-content__title${isDeclined ? ' calendar-event-content__title--declined' : ''}">${event.title}</div>
                  ${timeLabel ? `<div class="calendar-event-content__time">${timeLabel}</div>` : ''}
                  ${dot}
                </div>`;
              },
              allday: (event: any) => {
                const tagColor = event.raw?.tagColor;
                const isDeclined = event.raw?.isDeclined || event.raw?.isCancelled;
                const dot = tagColor
                  ? `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${tagColor};border:1.5px solid rgba(255,255,255,0.5);margin-left:4px;vertical-align:middle;flex-shrink:0;position:relative;z-index:1;"></span>`
                  : '';
                return `<div class="calendar-event-content calendar-event-content--allday">
                  <span class="calendar-event-content__title${isDeclined ? ' calendar-event-content__title--declined' : ''}">${event.title}</span>${dot}
                </div>`;
              },
            }}
            week={{
              startDayOfWeek: 1,
              workweek: isWorkweek,
              taskView: false,
              eventView: ['allday', 'time'],
              hourStart: 0,
              hourEnd: 24,
            }}
            month={{ startDayOfWeek: 1, visibleEventCount: isMobile ? 4 : undefined }}
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
          onCancelEvent={
            isEventEditable(selectedEvent) &&
            (selectedEvent.attendees?.length ?? 0) > 0
              ? () => handleCancelEvent(selectedEvent).then(() => setSelectedEvent(null))
              : undefined
          }
          onRsvp={
            selectedEvent.selfRsvpStatus && !isExchangeOrganizer(selectedEvent)
              ? (status, comment) => handleRsvp(selectedEvent, status, comment)
              : undefined
          }
          isOrganizer={isExchangeOrganizer(selectedEvent)}
          overlayChildren={showRecurringModal ? <RecurringChoiceModal onChoice={handleRecurringModalChoice} /> : null}
        />
      )}

      {!selectedEvent && showRecurringModal && (
        <RecurringChoiceModal onChoice={handleRecurringModalChoice} />
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
          onSubmit={async (payload, scope) => {
            const save = handleSaveEvent(payload, editEvent, scope);
            setEditEvent(null);
            await save;
          }}
          onClose={() => setEditEvent(null)}
          getValidToken={getValidToken}
          getExchangeRefreshToken={getExchangeRefreshToken}
        />
      )}
    </div>
  );
}
