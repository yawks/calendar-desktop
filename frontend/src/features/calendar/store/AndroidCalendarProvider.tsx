import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { App } from '@capacitor/app';
import { platform } from '../../../shared/platform';
import type { CalendarConfig, CalendarEvent } from '../../../shared/types';
import type { NativeCalendarSnapshot } from '../../../shared/platform';
import { useCalendars } from './CalendarStore';
import { androidCalendarDescription } from '../utils/androidCalendarDescription';
import { useGoogleEvents } from '../hooks/useGoogleEvents';
import { useEWSEvents } from '../hooks/useEWSEvents';
import { useICSEvents } from '../hooks/useICSEvents';
import { useNextcloudEvents } from '../hooks/useNextcloudEvents';

const KEY = 'courrier-android-calendars-v1';
function loadSelection(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch { return []; }
}

function androidEventLocation(event: CalendarEvent): string | undefined {
  const meetingLink = /https:\/\/teams\.(?:microsoft\.com|live\.com|cloud\.microsoft)\/(?:l\/meetup-join\/|meet\/)[^\s<>"']+/i;
  const location = event.location ?? '';
  if (meetingLink.test(location)) return location;
  const description = document.createElement('template');
  description.innerHTML = event.description ?? '';
  const candidates = [event.meetUrl ?? '',
    ...Array.from(description.content.querySelectorAll('a[href]'), link => link.getAttribute('href') ?? ''),
    description.content.textContent ?? '', event.description ?? ''];
  const link = candidates.map(value => value.match(meetingLink)?.[0].replace(/[),.;!]+$/, '')).find(Boolean);
  return link ? [location.trim(), link].filter(Boolean).join(' — ') : event.location;
}

export function calendarSnapshots(calendars: CalendarConfig[], selected: string[], snapshots: Record<string, CalendarEvent[]>, errors: Record<string, string>): NativeCalendarSnapshot[] {
  return calendars.filter(cal => selected.includes(cal.id)).map(cal => ({
    id: cal.id, name: cal.name, color: cal.color, ownerEmail: cal.ownerEmail,
    events: snapshots[cal.id] && !errors[cal.id] ? snapshots[cal.id]
      .filter(event => !event.isCancelled)
      .map(event => {
        const { id, title, start, end, isAllday, description, attendees, selfRsvpStatus } = event;
        return {
          id, title, start, end, isAllday, location: androidEventLocation(event), description: androidCalendarDescription(description), attendees,
          selfRsvpStatus: selfRsvpStatus ?? attendees?.find(attendee => cal.ownerEmail && attendee.email.toLowerCase() === cal.ownerEmail.toLowerCase())?.status,
        };
      }) : undefined,
  }));
}

function useAndroidCalendarData() {
  const { calendars } = useCalendars();
  const [selected, setSelected] = useState(loadSelection);
  const [snapshots, setSnapshots] = useState<Record<string, CalendarEvent[]>>({});
  const [state, setState] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [retry, setRetry] = useState(0);
  const onLoaded = useCallback((id: string, events: CalendarEvent[]) => {
    setSnapshots(previous => previous[id] === events ? previous : { ...previous, [id]: events });
  }, []);
  const google = useGoogleEvents(calendars, onLoaded);
  const ews = useEWSEvents(calendars, onLoaded);
  const ics = useICSEvents(calendars, onLoaded);
  const nextcloud = useNextcloudEvents(calendars, onLoaded);
  const errors = useMemo(() => ({ ...google.errors, ...ews.errors, ...ics.errors, ...nextcloud.errors }), [google.errors, ews.errors, ics.errors, nextcloud.errors]);
  const refresh = useCallback(async () => {
    await Promise.all([google.refresh(), ews.refresh(), ics.refresh(), nextcloud.refresh()]);
    setRetry(value => value + 1);
  }, [google.refresh, ews.refresh, ics.refresh, nextcloud.refresh]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const hasSelection = selected.some(id => calendars.some(cal => cal.id === id));
  useEffect(() => {
    if (!hasSelection) return;
    const timer = window.setInterval(() => void refreshRef.current().catch(() => setState('error')), 30 * 60 * 1000);
    const listener = App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void refreshRef.current().catch(() => setState('error'));
    });
    return () => { window.clearInterval(timer); void listener.then(handle => handle.remove()); };
  }, [hasSelection]);

  // A missing snapshot never means an empty calendar; failed fetches keep the last Android copy.
  const payload = JSON.stringify(calendarSnapshots(calendars, selected, snapshots, errors));
  useEffect(() => {
    let active = true;
    setState('syncing');
    void platform.publishCalendars!(JSON.parse(payload) as NativeCalendarSnapshot[]).then(() => {
      if (active) setState('success');
    }, () => { if (active) setState('error'); });
    return () => { active = false; };
  }, [payload, retry]);

  const saveSelection = async (ids: string[]) => {
    if (!await platform.requestCalendarPermission!()) throw new Error('calendar_permission_denied');
    localStorage.setItem(KEY, JSON.stringify(ids));
    setSelected(ids);
    await refresh();
  };
  return { selected, saveSelection, state, refresh, google, ews, ics, nextcloud, errors };
}
const AndroidCalendarContext = createContext<ReturnType<typeof useAndroidCalendarData> | null>(null);
function NativeProvider({ children }: { children: ReactNode }) {
  const value = useAndroidCalendarData();
  return <AndroidCalendarContext.Provider value={value}>{children}</AndroidCalendarContext.Provider>;
}
export function AndroidCalendarProvider({ children }: { children: ReactNode }) {
  return platform.isNativeAndroid && import.meta.env.VITE_DEMO_MODE !== 'true' ? <NativeProvider>{children}</NativeProvider> : <>{children}</>;
}
export const useAndroidCalendars = () => useContext(AndroidCalendarContext);
