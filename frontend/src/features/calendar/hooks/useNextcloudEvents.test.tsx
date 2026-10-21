// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useNextcloudEvents } from './useNextcloudEvents';
import { loadCalDavCalendar } from '../utils/loadCalDavCalendar';
import { cacheGetStale, cacheIsFresh } from '../utils/eventCache';
import i18n from '../../../i18n';
import type { CalendarConfig, CalendarEvent } from '../../../shared/types';
vi.mock('../utils/loadCalDavCalendar', async importOriginal => ({ ...await importOriginal<typeof import('../utils/loadCalDavCalendar')>(), loadCalDavCalendar: vi.fn() }));
vi.mock('../utils/eventCache', () => ({ cacheGetStale: vi.fn(), cacheIsFresh: vi.fn(), cacheSet: vi.fn(), patchCachedEventRsvp: vi.fn() }));
const cal: CalendarConfig = { id: 'tasks', name: 'Tasks', url: 'http://localhost:8080/dav/', type: 'nextcloud', color: '#123456', visible: true };
const event: CalendarEvent = { id: 'task', calendarId: 'tasks', title: 'Task', start: '2026-10-20T00:00:00', end: '2026-10-21T00:00:00', isAllday: true, category: 'allday', readOnly: true, isTask: true };
afterEach(() => vi.resetAllMocks());
it('restores cached tasks and read-only capabilities, and retains them when refresh returns a native HTTP error', async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage('fr');
  vi.mocked(cacheGetStale).mockResolvedValue({ events: [event], readOnly: true });
  vi.mocked(cacheIsFresh).mockResolvedValue(true);
  vi.mocked(loadCalDavCalendar).mockRejectedValue({ code: 'provider_request_failed', detail: 'provider_http_401' });
  let value: ReturnType<typeof useNextcloudEvents> | undefined;
  const onLoaded = vi.fn();
  function Probe() { value = useNextcloudEvents([cal], onLoaded); return null; }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => { root.render(<Probe />); });
    expect(value!.events).toEqual([event]);
    expect(value!.readOnlyCalendarIds).toEqual(['tasks']);
    expect(loadCalDavCalendar).not.toHaveBeenCalled();
    expect(onLoaded).toHaveBeenCalledWith('tasks', [event]);
    await act(async () => { await value!.refresh(); });
    expect(value!.errors.tasks).toBe(i18n.t('config.invalidCredentials'));
    expect(value!.events).toEqual([event]);
    expect(value!.readOnlyCalendarIds).toEqual(['tasks']);
    expect(value!.loading).toBe(false);
  } finally { await act(async () => root.unmount()); }
});
