import { useCallback, useState } from 'react';
import { CalendarConfig, CalendarEvent, CreateEventPayload } from '../types';
import i18n from '../i18n';
import { createEvent, deleteGoogleEvent, respondToGoogleEvent, updateEvent } from '../utils/googleCalendarApi';
import { createNextcloudEvent, deleteNextcloudEvent, respondToNextcloudEvent, updateNextcloudEvent } from '../utils/nextcloudCalendarApi';

interface UseCalendarOperationsProps {
  calendars: CalendarConfig[];
  getValidToken: (accountId: string) => Promise<string | null>;
  getExchangeToken: (accountId: string) => Promise<string | null>;
  googleRefresh: () => Promise<void>;
  ncRefresh: () => Promise<void>;
  ewsRefresh: () => Promise<void>;
  ekRefresh: () => Promise<void>;
  setEventTag: (seriesId: string, tagId: string) => void;
  removeEventTag: (seriesId: string) => void;
}

export function useCalendarOperations({
  calendars,
  getValidToken,
  getExchangeToken,
  googleRefresh,
  ncRefresh,
  ewsRefresh,
  ekRefresh,
  setEventTag,
  removeEventTag,
}: UseCalendarOperationsProps) {
  const [deletedEventIds, setDeletedEventIds] = useState<Set<string>>(new Set());
  const [optimisticCreated, setOptimisticCreated] = useState<CalendarEvent[]>([]);
  const [optimisticUpdated, setOptimisticUpdated] = useState<Map<string, CalendarEvent>>(new Map());

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

  const handleRsvp = useCallback(async (
    event: CalendarEvent,
    status: 'ACCEPTED' | 'DECLINED' | 'TENTATIVE',
    comment?: string,
  ) => {
    const cal = calendars.find((c) => c.id === event.calendarId);
    if (!cal) throw new Error(i18n.t('calendarPage.calendarNotFound'));

    const optimistic: CalendarEvent = {
      ...event,
      selfRsvpStatus: status,
      isDeclined: status === 'DECLINED',
      isUnaccepted: status !== 'ACCEPTED',
    };
    setOptimisticUpdated((prev) => new Map(prev).set(event.id, optimistic));

    try {
      if (cal.type === 'google') {
        if (!cal.googleAccountId || !event.sourceId || !cal.ownerEmail)
          throw new Error(i18n.t('calendarPage.missingInfo'));
        const token = await getValidToken(cal.googleAccountId);
        if (!token) throw new Error(i18n.t('calendarPage.invalidToken'));
        await respondToGoogleEvent(token, cal, event.sourceId, cal.ownerEmail, status, comment);
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
      setOptimisticUpdated((prev) => { const n = new Map(prev); n.delete(event.id); return n; });
      throw e;
    }
    setOptimisticUpdated((prev) => { const n = new Map(prev); n.delete(event.id); return n; });
  }, [calendars, getValidToken, getExchangeToken, googleRefresh, ncRefresh, ewsRefresh]);

  const handleDeleteEvent = useCallback(async (event: CalendarEvent) => {
    const cal = calendars.find((c) => c.id === event.calendarId);
    if (!cal) return;

    setDeletedEventIds((prev) => new Set([...prev, event.id]));

    try {
      if (cal.type === 'google') {
        if (!cal.googleAccountId || !event.sourceId) throw new Error(i18n.t('calendarPage.missingInfo'));
        const token = await getValidToken(cal.googleAccountId);
        if (!token) throw new Error(i18n.t('calendarPage.invalidToken'));
        await deleteGoogleEvent(token, cal, event.sourceId);
        await googleRefresh();
      } else if (cal.type === 'nextcloud') {
        if (!event.sourceId) throw new Error(i18n.t('calendarPage.missingInfo'));
        await deleteNextcloudEvent(cal, event.sourceId);
        await ncRefresh();
      } else if (cal.type === 'exchange') {
        if (!cal.exchangeAccountId || !event.sourceId) throw new Error(i18n.t('calendarPage.missingInfo'));
        const token = await getExchangeToken(cal.exchangeAccountId);
        if (!token) throw new Error(i18n.t('calendarPage.invalidToken'));
        const [itemId, changeKey] = event.sourceId.split('|');
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('ews_delete_event', { accessToken: token, itemId, changeKey });
        await ewsRefresh();
      } else if (cal.type === 'eventkit') {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('delete_eventkit_event', { eventId: event.sourceId ?? event.id });
        await ekRefresh();
      }
    } catch {
      setDeletedEventIds((prev) => {
        const next = new Set(prev);
        next.delete(event.id);
        return next;
      });
      throw new Error(i18n.t('eventModal.deleteError'));
    }
  }, [calendars, getValidToken, getExchangeToken, googleRefresh, ncRefresh, ewsRefresh, ekRefresh]);

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
      const normalize = (s?: string) => (s || '').trim();
      const getEmails = (arr?: { email: string }[]) => (arr || []).map(a => a.email.toLowerCase()).sort().join(',');

      const hasEventChanges =
        normalize(payload.title) !== normalize(sourceEvent.title) ||
        payload.start !== sourceEvent.start ||
        payload.end !== sourceEvent.end ||
        payload.isAllday !== sourceEvent.isAllday ||
        normalize(payload.location) !== normalize(sourceEvent.location) ||
        normalize(payload.description) !== normalize(sourceEvent.description) ||
        getEmails(payload.attendees) !== getEmails(sourceEvent.attendees);

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
        let sid: string | undefined = undefined;
        if (hasEventChanges) {
          sid = await doSave();
        }

        const finalSeriesId = sid ?? sourceEvent.seriesId ?? sourceEvent.sourceId;
        if (finalSeriesId) {
          if (payload.tagId) {
            setEventTag(finalSeriesId, payload.tagId);
          } else if (payload.tagId === null) {
            removeEventTag(finalSeriesId);
          }
        }

        if (hasEventChanges) {
          await doRefresh();
        }
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
      try {
        const sid = await doSave();
        if (payload.tagId && sid) {
          setEventTag(sid, payload.tagId);
        }
        await doRefresh();
        return sid;
      } finally {
        setOptimisticCreated((prev) => prev.filter((ev) => ev.id !== tempId));
      }
    }
  }, [calendars, saveNextcloudEvent, saveEventKitEvent, saveExchangeEvent, saveGoogleEvent, ncRefresh, ekRefresh, ewsRefresh, googleRefresh, setEventTag, removeEventTag]);

  return {
    deletedEventIds,
    optimisticCreated,
    optimisticUpdated,
    handleRsvp,
    handleDeleteEvent,
    handleSaveEvent,
  };
}
