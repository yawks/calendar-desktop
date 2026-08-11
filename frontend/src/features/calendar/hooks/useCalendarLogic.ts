import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { CalendarConfig, CalendarEvent, CreateEventPayload, ViewType } from '../../../shared/types';
import { useCalendars } from '../store/CalendarStore';
import { useCalendarGroups } from '../store/CalendarGroupStore';
import { useEWSEvents } from './useEWSEvents';
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
import { createNextcloudEvent, updateNextcloudEvent, deleteNextcloudEvent, cancelNextcloudEvent, respondToNextcloudEvent } from '../utils/nextcloudCalendarApi';
import { useQueryClient } from '@tanstack/react-query';
import { CALENDAR_KEYS } from './useCalendarQueries';
import { exchangeCalendarApi } from '../../../shared/api/exchangeCalendarApi';

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
  const queryClient = useQueryClient();
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
  const allEventsRaw = DEMO_MODE ? DEMO_EVENTS : [...icsEvents, ...googleEvents, ...ncEvents, ...ewsEvents];
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

  const loading = DEMO_MODE ? false : (icsLoading || googleLoading || ncLoading || ewsLoading);
  const errors = DEMO_MODE ? {} : { ...icsErrors, ...googleErrors, ...ncErrors, ...ewsErrors };
  const refresh = useCallback(async () => {
    await Promise.all([
      Promise.resolve(icsRefresh()),
      Promise.resolve(googleRefresh()),
      Promise.resolve(ncRefresh()),
      ewsRefresh(),
    ]);
  }, [icsRefresh, googleRefresh, ncRefresh, ewsRefresh]);

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

  const saveExchangeEvent = useCallback(async (cal: CalendarConfig, payload: CreateEventPayload, sourceEvent?: CalendarEvent, updateSeries = false): Promise<string | undefined> => {
    if (!cal.exchangeAccountId) throw new Error('Compte Exchange introuvable');
    const token = await getExchangeToken(cal.exchangeAccountId);
    if (!token) throw new Error(i18n.t('calendarPage.invalidToken'));
    const attendeeEmails = payload.attendees?.map((a) => a.email) ?? [];
    if (sourceEvent?.sourceId) {
      const [itemId, changeKey] = sourceEvent.sourceId.split('|');
      await exchangeCalendarApi.update({
        accessToken: token,
        itemId,
        changeKey,
        title: payload.title,
        start: payload.start,
        end: payload.end,
        isAllDay: payload.isAllday,
        location: payload.location ?? null,
        description: payload.description ?? null,
        updateSeries,
      });
      return sourceEvent.seriesId;
    } else {
      const result = await exchangeCalendarApi.create({
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

  const handleSaveEvent = useCallback(async (payload: CreateEventPayload, sourceEvent?: CalendarEvent, recurringScope?: 'this' | 'future') => {
    const cal = calendars.find((c) => c.id === payload.calendarId);
    if (!cal) throw new Error(i18n.t('calendarPage.calendarNotFound'));

    const seriesSourceEvent = recurringScope === 'future' && sourceEvent?.seriesId && cal.type !== 'exchange'
      ? { ...sourceEvent, sourceId: sourceEvent.seriesId }
      : sourceEvent;
    const doSave = () => {
      if (cal.type === 'nextcloud') return saveNextcloudEvent(cal, payload, seriesSourceEvent);
      if (cal.type === 'exchange') return saveExchangeEvent(cal, payload, sourceEvent, recurringScope === 'future');
      return saveGoogleEvent(cal, payload, seriesSourceEvent);
    };
    const doRefresh = async () => {
      if (cal.type === 'nextcloud') await ncRefresh(cal.id);
      else if (cal.type === 'exchange') await ewsRefresh(cal.id);
      else await googleRefresh(cal.id);
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
        void doRefresh().finally(() => {
          setOptimisticUpdated((prev) => { const n = new Map(prev); n.delete(sourceEvent.id); return n; });
        });
      } catch (e) {
        setOptimisticUpdated((prev) => { const n = new Map(prev); n.delete(sourceEvent.id); return n; });
        throw e;
      }
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
  }, [calendars, saveNextcloudEvent, saveExchangeEvent, saveGoogleEvent, ncRefresh, ewsRefresh, googleRefresh, setEventTag, removeEventTag]);

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
        await googleRefresh(cal.id);
      } else if (cal.type === 'nextcloud') {
        if (!event.sourceId || !cal.ownerEmail)
          throw new Error(i18n.t('calendarPage.missingInfo'));
        await respondToNextcloudEvent(cal, event.sourceId, cal.ownerEmail, status, comment);
        await ncRefresh(cal.id);
      } else if (cal.type === 'exchange') {
        if (!cal.exchangeAccountId || !rsvpSourceId)
          throw new Error(i18n.t('calendarPage.missingInfo'));
        const token = await getExchangeToken(cal.exchangeAccountId);
        if (!token) throw new Error(i18n.t('calendarPage.invalidToken'));
        const [itemId, changeKey] = rsvpSourceId.split('|');
        if (!itemId || !changeKey) throw new Error(i18n.t('calendarPage.missingInfo'));
        console.info('[Exchange RSVP] Envoi', { itemId, status });
        await exchangeCalendarApi.respond({
          accessToken: token,
          itemId,
          changeKey,
          responseType: status === 'ACCEPTED' ? 'accept' : status === 'DECLINED' ? 'decline' : 'tentative',
          ownerEmail: cal.ownerEmail,
          body: comment ?? null,
        });
        console.info('[Exchange RSVP] Réponse confirmée par EWS', { status });
        const affectedIdSet = new Set(affectedIds);
        queryClient.setQueryData<CalendarEvent[]>(CALENDAR_KEYS.events(cal.id), (cached) =>
          cached?.map((cachedEvent) => affectedIdSet.has(cachedEvent.id) ? makeOptimistic(cachedEvent) : cachedEvent),
        );
        setOptimisticUpdated((prev) => {
          const next = new Map(prev);
          for (const id of affectedIds) next.delete(id);
          return next;
        });
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
  }, [calendars, events, isEventRecurring, askRecurringScope, getValidToken, getExchangeToken, googleRefresh, ncRefresh, queryClient]);

  const deleteOrCancelEvent = useCallback(async (event: CalendarEvent, requestedScope?: 'this' | 'all', sendCancellation = false) => {
    const cal = calendars.find((c) => c.id === event.calendarId);
    console.log('[recurring] handleDeleteEvent cal=', cal?.type, 'event.isRecurringInstance=', event.isRecurringInstance, 'seriesId=', event.seriesId);
    if (!cal) return;

    let deleteSourceId = event.sourceId;
    let affectedIds = [event.id];

    let recurringScope = requestedScope;
    if (isEventRecurring(event) && !recurringScope) {
      console.log('[recurring] event IS recurring → showing scope modal');
      const scope = await askRecurringScope();
      if (scope === null) {
        const err = new Error('CANCELLED') as Error & { cancelled: true };
        err.cancelled = true;
        throw err;
      }
      recurringScope = scope;
    }
    if (recurringScope === 'all' && event.seriesId) {
      deleteSourceId = event.seriesId;
      affectedIds = events.filter((e) => e.seriesId === event.seriesId).map((e) => e.id);
    }

    const cancellationRemovesEvent = sendCancellation && cal.type === 'exchange';
    if (sendCancellation && !cancellationRemovesEvent) {
      setOptimisticUpdated((prev) => {
        const next = new Map(prev);
        for (const id of affectedIds) {
          const affected = events.find((candidate) => candidate.id === id);
          if (affected) next.set(id, { ...affected, isCancelled: true });
        }
        return next;
      });
    } else {
      setDeletedEventIds((prev) => new Set([...prev, ...affectedIds]));
    }

    try {
      console.log('[deleteEvent] sourceId=', event.sourceId, 'deleteSourceId=', deleteSourceId, 'cal.type=', cal.type, 'event.id=', event.id);
      if (cal.type === 'google') {
        const token = await getValidToken(cal.googleAccountId!);
        await deleteGoogleEvent(token!, cal, deleteSourceId!, sendCancellation);
        await googleRefresh(cal.id);
      } else if (cal.type === 'nextcloud') {
        if (sendCancellation) await cancelNextcloudEvent(cal, event.sourceId!, event, recurringScope === 'all');
        else await deleteNextcloudEvent(cal, event.sourceId!);
        await ncRefresh(cal.id);
      } else if (cal.type === 'exchange') {
        const token = await getExchangeToken(cal.exchangeAccountId!);
        const [itemId, changeKey] = event.sourceId!.split('|');
        console.log('[deleteEvent] exchange itemId=', itemId, 'changeKey=', changeKey);
        if (sendCancellation) {
          await exchangeCalendarApi.cancel({
            accessToken: token,
            itemId,
            changeKey,
            cancelSeries: recurringScope === 'all',
          });
        } else {
          await exchangeCalendarApi.delete({
            accessToken: token,
            itemId,
            changeKey,
            sendCancellations: false,
            deleteSeries: recurringScope === 'all',
          });
        }
        await ewsRefresh(cal.id);
      }
      if (sendCancellation && !cancellationRemovesEvent) {
        setOptimisticUpdated((prev) => {
          const next = new Map(prev);
          for (const id of affectedIds) next.delete(id);
          return next;
        });
      }
      if (!sendCancellation || cancellationRemovesEvent) {
        setDeletedEventIds((prev) => {
          const next = new Set(prev);
          for (const id of affectedIds) next.delete(id);
          return next;
        });
      }
    } catch (err) {
      console.error('[deleteEvent] failed', err);
      const message = String(err).toLowerCase();
      const alreadyMissingOnEws = cal.type === 'exchange' && (
        message.includes("item not found") ||
        message.includes("occurrence couldn't be found") ||
        message.includes('erroritemnotfound')
      );
      if (alreadyMissingOnEws) {
        void ewsRefresh(cal.id);
        return;
      }
      if (sendCancellation && !cancellationRemovesEvent) {
        setOptimisticUpdated((prev) => {
          const next = new Map(prev);
          for (const id of affectedIds) next.delete(id);
          return next;
        });
      } else {
        setDeletedEventIds((prev) => {
          const next = new Set(prev);
          for (const id of affectedIds) next.delete(id);
          return next;
        });
      }
      throw new Error(i18n.t('eventModal.deleteError'));
    }
  }, [calendars, events, exchangeAccounts, isEventRecurring, askRecurringScope, getValidToken, getExchangeToken, googleRefresh, ncRefresh, ewsRefresh]);

  const handleDeleteEvent = useCallback(
    (event: CalendarEvent, scope?: 'this' | 'all') => deleteOrCancelEvent(event, scope, false),
    [deleteOrCancelEvent],
  );

  const handleCancelEvent = useCallback(
    (event: CalendarEvent, scope?: 'this' | 'all') => deleteOrCancelEvent(event, scope, true),
    [deleteOrCancelEvent],
  );

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

  const isEventEditable = useCallback((event: CalendarEvent) => {
    const cal = calendars.find((c) => c.id === event.calendarId);
    if (!cal) return false;
    if (cal.type === 'exchange') return isExchangeOrganizer(event);
    if (cal.type !== 'google' && cal.type !== 'nextcloud') return false;
    const attendees = event.attendees;
    const ownerEmail = cal.ownerEmail?.toLowerCase();
    return !attendees?.length || !!ownerEmail && attendees.some((a) =>
      a.isOrganizer && a.email.toLowerCase() === ownerEmail
    );
  }, [calendars, isExchangeOrganizer]);

  const handleStartEdit = useCallback(async (event: CalendarEvent) => {
    setEditEvent(event);
    setSelectedEvent(null);
  }, []);

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
    handleCancelEvent,
    handleStartEdit,
    isEventEditable,
    isExchangeOrganizer,
    handleBeforeUpdateEvent,
    showRecurringModal,
    handleRecurringModalChoice,
  };
}
