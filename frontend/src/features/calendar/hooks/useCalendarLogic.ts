import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { CalendarConfig, CalendarEvent, CreateEventPayload, ViewType } from '../../../shared/types';
import { useCalendars } from '../store/CalendarStore';
import { useCalendarGroups } from '../store/CalendarGroupStore';
import { useEWSEvents } from './useEWSEvents';
import { useEventKitEvents } from './useEventKitEvents';
import { useGoogleEvents } from './useGoogleEvents';
import { useICSEvents } from './useICSEvents';
import { useNextcloudEvents } from './useNextcloudEvents';
import { useTags } from '../store/TagStore';
import { useTheme } from '../../../shared/store/ThemeStore';
import { useExchangeAuth } from '../../../shared/store/ExchangeAuthStore';
import { useGoogleAuth } from '../../../shared/store/GoogleAuthStore';
import { DEMO_CALENDARS, DEMO_EVENTS } from '../../../demo/demoData';
import i18n from '../../../i18n';
import { createEvent, updateEvent, deleteGoogleEvent, respondToGoogleEvent } from '../utils/googleCalendarApi';
import { createNextcloudEvent, updateNextcloudEvent, deleteNextcloudEvent, respondToNextcloudEvent } from '../utils/nextcloudCalendarApi';

const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

export interface TUICalendarInstance {
  prev(): void;
  next(): void;
  today(): void;
  setDate(date: Date): void;
  getDate(): { toDate(): Date };
  clearGridSelections(): void;
}

export interface CalendarRef {
  getInstance(): TUICalendarInstance | null;
}

export function useCalendarLogic() {
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

    const onMouseMove = (ev: globalThis.MouseEvent) => {
      const newWidth = Math.min(Math.max(startWidth + ev.clientX - startX, 160), 480);
      setSidebarWidth(newWidth);
    };

    const onMouseUp = (ev: globalThis.MouseEvent) => {
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
  const [deletedEventIds, setDeletedEventIds] = useState<Set<string>>(new Set());
  const [optimisticCreated, setOptimisticCreated] = useState<CalendarEvent[]>([]);
  const [optimisticUpdated, setOptimisticUpdated] = useState<Map<string, CalendarEvent>>(new Map());
  const [showRecurringModal, setShowRecurringModal] = useState(false);
  const recurringChoiceResolveRef = useRef<((scope: 'this' | 'all' | null) => void) | null>(null);

  const calendars = DEMO_MODE ? DEMO_CALENDARS : realCalendars;
  const allEventsRaw = DEMO_MODE ? DEMO_EVENTS : [...icsEvents, ...googleEvents, ...ncEvents, ...ekEvents, ...ewsEvents];
  const events = useMemo(() => {
    const serverEvents = allEventsRaw
      .filter((e: CalendarEvent) => !deletedEventIds.has(e.id))
      .map((e: CalendarEvent) => optimisticUpdated.get(e.id) ?? e);
    // Filter out optimistic created events that already exist on the server
    // (by calendarId + title + start within 60 s) to avoid transient duplicates.
    const pendingCreated = optimisticCreated.filter((opt) =>
      !serverEvents.some(
        (sv) =>
          sv.calendarId === opt.calendarId &&
          sv.title === opt.title &&
          Math.abs(new Date(sv.start).getTime() - new Date(opt.start).getTime()) < 60_000,
      ),
    );
    return [...serverEvents, ...pendingCreated];
  }, [allEventsRaw, deletedEventIds, optimisticUpdated, optimisticCreated]);

  // Keep selectedEvent in sync when the underlying event changes.
  // Handles both: server-side data refresh (same id) and optimistic→real
  // transition after creation (temp-xxx id → real server id).
  useEffect(() => {
    if (!selectedEvent) return;
    const byId = events.find((e) => e.id === selectedEvent.id);
    if (byId) {
      if (byId !== selectedEvent) setSelectedEvent(byId);
      return;
    }
    if (selectedEvent.id.startsWith('temp-')) {
      const real = events.find(
        (e) =>
          !e.id.startsWith('temp-') &&
          e.calendarId === selectedEvent.calendarId &&
          e.title === selectedEvent.title &&
          Math.abs(new Date(e.start).getTime() - new Date(selectedEvent.start).getTime()) < 60_000,
      );
      if (real) setSelectedEvent(real);
    }
  }, [events, selectedEvent]);

  const loading = DEMO_MODE ? false : (icsLoading || googleLoading || ncLoading || ekLoading || ewsLoading);
  const errors = DEMO_MODE ? {} : { ...icsErrors, ...googleErrors, ...ncErrors, ...ekErrors, ...ewsErrors };
  const refresh = useCallback(() => { icsRefresh(); googleRefresh(); ncRefresh(); ekRefresh(); ewsRefresh(); }, [icsRefresh, googleRefresh, ncRefresh, ekRefresh, ewsRefresh]);

  const handlePrev = useCallback(() => {
    const inst = calendarRef.current?.getInstance();
    if (inst) {
      inst.prev();
      setCurrentDate(inst.getDate().toDate());
    }
  }, []);

  const handleNext = useCallback(() => {
    const inst = calendarRef.current?.getInstance();
    if (inst) {
      inst.next();
      setCurrentDate(inst.getDate().toDate());
    }
  }, []);

  const handleToday = useCallback(() => {
    const inst = calendarRef.current?.getInstance();
    if (inst) {
      inst.today();
      setCurrentDate(inst.getDate().toDate());
    }
  }, []);

  const handleNavigateToDate = useCallback((date: Date) => {
    calendarRef.current?.getInstance()?.setDate(date);
    setCurrentDate(date);
  }, []);

  const syncDate = useCallback(() => {
    const d = calendarRef.current?.getInstance()?.getDate().toDate();
    if (d) setCurrentDate(d);
  }, []);

  const handleViewChange = useCallback((v: ViewType) => {
    setView(v);
    setTimeout(syncDate, 50);
  }, [syncDate]);

  const saveNextcloudEvent = useCallback(async (cal: CalendarConfig, payload: CreateEventPayload, sourceEvent?: CalendarEvent): Promise<string | undefined> => {
    if (sourceEvent?.sourceId) {
      await updateNextcloudEvent(cal, sourceEvent.sourceId, payload);
      return sourceEvent.seriesId;
    } else {
      return await createNextcloudEvent(cal, payload);
    }
  }, []);

  const saveEventKitEvent = useCallback(async (cal: CalendarConfig, payload: CreateEventPayload, sourceEvent?: CalendarEvent): Promise<string | undefined> => {
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
      return sourceEvent.seriesId;
    } else {
      const res = await invoke<string | undefined>('create_eventkit_event', {
        payload: {
          calendar_id: cal.eventKitCalendarId,
          title: payload.title, start: payload.start, end: payload.end,
          is_all_day: payload.isAllday, location: payload.location ?? null,
          notes: payload.description ?? null, attendees,
        },
      }).catch(() => undefined);
      return res;
    }
  }, []);

  const saveExchangeEvent = useCallback(async (cal: CalendarConfig, payload: CreateEventPayload, sourceEvent?: CalendarEvent): Promise<string | undefined> => {
    if (!cal.exchangeAccountId) throw new Error('Compte Exchange introuvable');
    const token = await getExchangeToken(cal.exchangeAccountId);
    if (!token) throw new Error(i18n.t('calendarPage.invalidToken'));
    const { invoke } = await import('@tauri-apps/api/core');
    const attendeeEmails = payload.attendees?.map((a) => a.email) ?? [];
    if (sourceEvent?.sourceId) {
      const [itemId, changeKey] = sourceEvent.sourceId.split('|');
      await invoke('ews_update_event', {
        accessToken: token,
        itemId,
        changeKey,
        title: payload.title,
        start: payload.start,
        end: payload.end,
        isAllDay: payload.isAllday,
        location: payload.location ?? null,
        description: payload.description ?? null,
      });
      return sourceEvent.seriesId;
    } else {
      const result = await invoke<string>('ews_create_event', {
        accessToken: token,
        title: payload.title,
        start: payload.start,
        end: payload.end,
        isAllDay: payload.isAllday,
        location: payload.location ?? null,
        description: payload.description ?? null,
        attendees: attendeeEmails.length > 0 ? attendeeEmails : null,
      });
      return result.split('|')[0];
    }
  }, [getExchangeToken]);

  const saveGoogleEvent = useCallback(async (cal: CalendarConfig, payload: CreateEventPayload, sourceEvent?: CalendarEvent): Promise<string | undefined> => {
    if (!cal.googleAccountId) throw new Error('Compte Google introuvable');
    const token = await getValidToken(cal.googleAccountId);
    if (!token) throw new Error('Token invalide. Reconnectez votre compte Google.');
    if (sourceEvent?.sourceId) {
      await updateEvent(token, cal, sourceEvent.sourceId, payload);
      return sourceEvent.seriesId;
    } else {
      return await createEvent(token, cal, payload);
    }
  }, [getValidToken]);

  const handleSaveEvent = useCallback(async (payload: CreateEventPayload, sourceEvent?: CalendarEvent) => {
    const cal = calendars.find((c) => c.id === payload.calendarId);
    if (!cal) throw new Error(i18n.t('calendarPage.calendarNotFound'));

    const doSave = () => {
      if (cal.type === 'nextcloud') return saveNextcloudEvent(cal, payload, sourceEvent);
      if (cal.type === 'eventkit') return saveEventKitEvent(cal, payload, sourceEvent);
      if (cal.type === 'exchange') return saveExchangeEvent(cal, payload, sourceEvent);
      return saveGoogleEvent(cal, payload, sourceEvent);
    };
    const doRefresh = async () => {
      if (cal.type === 'nextcloud') await ncRefresh();
      else if (cal.type === 'eventkit') await ekRefresh();
      else if (cal.type === 'exchange') await ewsRefresh();
      else await googleRefresh();
    };

    if (sourceEvent) {
      const optimistic: CalendarEvent = {
        ...sourceEvent,
        title: payload.title,
        start: payload.start,
        end: payload.end,
        isAllday: payload.isAllday,
        category: payload.isAllday ? 'allday' : 'time',
        location: payload.location,
        description: payload.description,
        tagId: payload.tagId ?? undefined,
      };
      setOptimisticUpdated((prev) => new Map(prev).set(sourceEvent.id, optimistic));
      try {
        const sid = await doSave();
        const finalSeriesId = sid ?? sourceEvent.seriesId ?? sourceEvent.sourceId;
        if (finalSeriesId) {
          if (payload.tagId) setEventTag(finalSeriesId, payload.tagId);
          else if (payload.tagId === null) removeEventTag(finalSeriesId);
        }
        await doRefresh();
      } catch (e) {
        setOptimisticUpdated((prev) => { const n = new Map(prev); n.delete(sourceEvent.id); return n; });
        throw e;
      }
      setOptimisticUpdated((prev) => { const n = new Map(prev); n.delete(sourceEvent.id); return n; });
    } else {
      const tempId = `temp-${Date.now()}`;
      const optimistic: CalendarEvent = {
        id: tempId,
        calendarId: payload.calendarId,
        title: payload.title,
        start: payload.start,
        end: payload.end,
        isAllday: payload.isAllday,
        category: payload.isAllday ? 'allday' : 'time',
        location: payload.location,
        description: payload.description,
        tagId: payload.tagId ?? undefined,
      };
      setOptimisticCreated((prev) => [...prev, optimistic]);
      console.log('[createEvent] optimistic added', tempId, payload.title);
      const cleanup = () => {
        console.log('[createEvent] cleanup – removing optimistic', tempId);
        setOptimisticCreated((prev) => prev.filter((ev) => ev.id !== tempId));
      };
      try {
        const sid = await doSave();
        console.log('[createEvent] doSave OK, sid=', sid, 'cal.type=', cal.type);
        if (payload.tagId && sid) setEventTag(sid, payload.tagId);
        setTimeout(async () => {
          console.log('[createEvent] setTimeout fired – calling doRefresh');
          try { await doRefresh(); console.log('[createEvent] doRefresh done'); } finally { cleanup(); }
        }, 2000);
      } catch (e) {
        console.error('[createEvent] error', e);
        cleanup();
        throw e;
      }
    }
  }, [calendars, saveNextcloudEvent, saveEventKitEvent, saveExchangeEvent, saveGoogleEvent, ncRefresh, ekRefresh, ewsRefresh, googleRefresh, setEventTag, removeEventTag]);

  const isEventRecurring = useCallback((event: CalendarEvent): boolean => {
    const result = event.isRecurringInstance === true;
    console.log('[recurring] isEventRecurring', { id: event.id, title: event.title, isRecurringInstance: event.isRecurringInstance, result });
    return result;
  }, []);

  const askRecurringScope = useCallback((): Promise<'this' | 'all' | null> => {
    console.log('[recurring] askRecurringScope: setting showRecurringModal=true');
    return new Promise((resolve) => {
      recurringChoiceResolveRef.current = resolve;
      setShowRecurringModal(true);
    });
  }, []);

  const handleRecurringModalChoice = useCallback((scope: 'this' | 'all' | null) => {
    console.log('[recurring] handleRecurringModalChoice scope=', scope);
    setShowRecurringModal(false);
    recurringChoiceResolveRef.current?.(scope);
    recurringChoiceResolveRef.current = null;
  }, []);

  const handleRsvp = useCallback(async (
    event: CalendarEvent,
    status: 'ACCEPTED' | 'DECLINED' | 'TENTATIVE',
    comment?: string,
  ) => {
    const cal = calendars.find((c) => c.id === event.calendarId);
    if (!cal) throw new Error(i18n.t('calendarPage.calendarNotFound'));
    if (cal.type === 'eventkit') throw new Error(i18n.t('calendarPage.eventKitRsvpNote'));

    let rsvpSourceId = event.sourceId;
    let affectedIds = [event.id];

    if (isEventRecurring(event)) {
      const scope = await askRecurringScope();
      if (scope === null) return;
      if (scope === 'all' && event.seriesId) {
        rsvpSourceId = event.seriesId;
        affectedIds = events.filter((e) => e.seriesId === event.seriesId).map((e) => e.id);
      }
    }

    const makeOptimistic = (ev: CalendarEvent): CalendarEvent => ({
      ...ev,
      selfRsvpStatus: status,
      isDeclined: status === 'DECLINED',
      isUnaccepted: status !== 'ACCEPTED',
    });

    setOptimisticUpdated((prev) => {
      const n = new Map(prev);
      for (const id of affectedIds) {
        const ev = events.find((e) => e.id === id);
        if (ev) n.set(id, makeOptimistic(ev));
      }
      return n;
    });
    setSelectedEvent(makeOptimistic(event));

    try {
      if (cal.type === 'google') {
        if (!cal.googleAccountId || !rsvpSourceId || !cal.ownerEmail)
          throw new Error(i18n.t('calendarPage.missingInfo'));
        const token = await getValidToken(cal.googleAccountId);
        if (!token) throw new Error(i18n.t('calendarPage.invalidToken'));
        await respondToGoogleEvent(token, cal, rsvpSourceId, cal.ownerEmail, status, comment);
        await googleRefresh();
      } else if (cal.type === 'nextcloud') {
        if (!event.sourceId || !cal.ownerEmail)
          throw new Error(i18n.t('calendarPage.missingInfo'));
        await respondToNextcloudEvent(cal, event.sourceId, cal.ownerEmail, status, comment);
        await ncRefresh();
      } else if (cal.type === 'exchange') {
        if (!cal.exchangeAccountId || !event.sourceId)
          throw new Error(i18n.t('calendarPage.missingInfo'));
        const token = await getExchangeToken(cal.exchangeAccountId);
        if (!token) throw new Error(i18n.t('calendarPage.invalidToken'));
        const [itemId, changeKey] = event.sourceId.split('|');
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('ews_respond_to_invitation', {
          accessToken: token,
          itemId,
          changeKey,
          responseType: status === 'ACCEPTED' ? 'accept' : status === 'DECLINED' ? 'decline' : 'tentative',
          ownerEmail: cal.ownerEmail,
          body: comment ?? null,
        });
        await ewsRefresh();
      }
    } catch (e) {
      setOptimisticUpdated((prev) => {
        const n = new Map(prev);
        for (const id of affectedIds) n.delete(id);
        return n;
      });
      setSelectedEvent(event);
      throw e;
    }
    // Keep the optimistic entry: the server refresh may return stale data briefly.
  }, [calendars, events, isEventRecurring, askRecurringScope, getValidToken, getExchangeToken, googleRefresh, ncRefresh, ewsRefresh]);

  const handleDeleteEvent = useCallback(async (event: CalendarEvent) => {
    const cal = calendars.find((c) => c.id === event.calendarId);
    console.log('[recurring] handleDeleteEvent cal=', cal?.type, 'event.isRecurringInstance=', event.isRecurringInstance, 'seriesId=', event.seriesId);
    if (!cal) return;

    let deleteSourceId = event.sourceId;
    let affectedIds = [event.id];

    if (isEventRecurring(event)) {
      console.log('[recurring] event IS recurring → showing scope modal');
      const scope = await askRecurringScope();
      if (scope === null) {
        const err = new Error('CANCELLED') as Error & { cancelled: true };
        err.cancelled = true;
        throw err;
      }
      if (scope === 'all' && event.seriesId) {
        deleteSourceId = event.seriesId;
        affectedIds = events.filter((e) => e.seriesId === event.seriesId).map((e) => e.id);
      }
    }

    setDeletedEventIds((prev) => new Set([...prev, ...affectedIds]));

    try {
      console.log('[deleteEvent] sourceId=', event.sourceId, 'deleteSourceId=', deleteSourceId, 'cal.type=', cal.type, 'event.id=', event.id);
      if (cal.type === 'google') {
        const token = await getValidToken(cal.googleAccountId!);
        await deleteGoogleEvent(token!, cal, deleteSourceId!);
        await googleRefresh();
      } else if (cal.type === 'nextcloud') {
        await deleteNextcloudEvent(cal, event.sourceId!);
        await ncRefresh();
      } else if (cal.type === 'eventkit') {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('delete_eventkit_event', { eventId: event.sourceId ?? event.id });
        await ekRefresh();
      } else if (cal.type === 'exchange') {
        const token = await getExchangeToken(cal.exchangeAccountId!);
        const [itemId, changeKey] = event.sourceId!.split('|');
        console.log('[deleteEvent] exchange itemId=', itemId, 'changeKey=', changeKey);
        const account = exchangeAccounts.find((a) => a.id === cal.exchangeAccountId);
        const isOrganizer = !event.attendees?.length || event.attendees.some((a) => {
          if (!a.isOrganizer) return false;
          if (account && a.email.toLowerCase() === account.email.toLowerCase()) return true;
          return !!(account?.displayName && a.name.toLowerCase() === account.displayName.toLowerCase());
        });
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('ews_delete_event', { accessToken: token, itemId, changeKey, sendCancellations: isOrganizer });
        await ewsRefresh();
      }
    } catch (err) {
      console.error('[deleteEvent] failed', err);
      setDeletedEventIds((prev) => {
        const next = new Set(prev);
        for (const id of affectedIds) next.delete(id);
        return next;
      });
      throw new Error(i18n.t('eventModal.deleteError'));
    }
  }, [calendars, events, exchangeAccounts, isEventRecurring, askRecurringScope, getValidToken, getExchangeToken, googleRefresh, ncRefresh, ekRefresh, ewsRefresh]);

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

  const handleStartEdit = useCallback(async (event: CalendarEvent) => {
    if (isEventRecurring(event)) {
      const scope = await askRecurringScope();
      if (scope === null) return;
      if (scope === 'all' && event.seriesId) {
        setEditEvent({ ...event, sourceId: event.seriesId });
        setSelectedEvent(null);
        return;
      }
    }
    setEditEvent(event);
    setSelectedEvent(null);
  }, [isEventRecurring, askRecurringScope]);

  const handleBeforeUpdateEvent = useCallback(
    ({ event, changes }: { event: any; changes: any }) => {
      const originalEvent = events.find((e) => e.id === event.id);
      if (!originalEvent) return;
      if (!isEventEditable(originalEvent)) return;

      const toISO = (d: unknown): string => {
        if (d instanceof Date) return d.toISOString();
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

      void (async () => {
        let sourceEvent = originalEvent;
        if (isEventRecurring(originalEvent)) {
          const scope = await askRecurringScope();
          if (scope === null) return;
          if (scope === 'all' && originalEvent.seriesId) {
            sourceEvent = { ...originalEvent, sourceId: originalEvent.seriesId };
          }
        }
        await handleSaveEvent(payload, sourceEvent);
      })();
    },
    [events, isEventEditable, isEventRecurring, askRecurringScope, handleSaveEvent]
  );

  return {
    calendarRef,
    view,
    setView,
    currentDate,
    setCurrentDate,
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
    setEventTag,
    removeEventTag,
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
    isEventEditable,
    isExchangeOrganizer,
    handleBeforeUpdateEvent,
    showRecurringModal,
    handleRecurringModalChoice,
  };
}
