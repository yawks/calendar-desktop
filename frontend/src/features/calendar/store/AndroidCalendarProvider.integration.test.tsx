// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CalendarConfig, CalendarEvent } from '../../../shared/types';
import { AndroidCalendarProvider, useAndroidCalendars } from './AndroidCalendarProvider';

const fixtures = vi.hoisted(() => ({
  calendars: [] as CalendarConfig[], events: {} as Record<string, CalendarEvent[]>,
  errors: {} as Record<string, string>, permission: vi.fn(), publish: vi.fn(),
}));
vi.mock('../../../shared/platform', () => ({ platform: { isNativeAndroid: true, requestCalendarPermission: fixtures.permission, publishCalendars: fixtures.publish } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove() {} }) } }));
vi.mock('./CalendarStore', () => ({ useCalendars: () => ({ calendars: fixtures.calendars }) }));
vi.mock('../hooks/useGoogleEvents', async () => {
  const { useEffect } = await import('react');
  return { useGoogleEvents: (_: CalendarConfig[], onLoaded: (id: string, events: CalendarEvent[]) => void) => {
    useEffect(() => { Object.entries(fixtures.events).forEach(([id, events]) => onLoaded(id, events)); }, [onLoaded]);
    return { events: [], loading: false, errors: fixtures.errors, refresh: async () => {} };
  } };
});
vi.mock('../hooks/useEWSEvents', () => ({ useEWSEvents: () => ({ events: [], loading: false, errors: {}, refresh: async () => {} }) }));
vi.mock('../hooks/useICSEvents', () => ({ useICSEvents: () => ({ events: [], loading: false, errors: {}, refresh: async () => {} }) }));
vi.mock('../hooks/useNextcloudEvents', () => ({ useNextcloudEvents: () => ({ events: [], loading: false, errors: {}, refresh: async () => {} }) }));

let current: NonNullable<ReturnType<typeof useAndroidCalendars>>;
function Probe() { current = useAndroidCalendars()!; return null; }
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  fixtures.permission.mockReset().mockResolvedValue(true);
  fixtures.publish.mockReset().mockResolvedValue(undefined);
  fixtures.calendars = [{ id: 'g', type: 'google', name: 'Work', color: '#123456', url: '', visible: false }];
  fixtures.events = { g: [] };
  fixtures.errors = {};
  root = createRoot(document.createElement('div'));
});
afterEach(async () => { await act(async () => root.unmount()); });
const mount = async () => { await act(async () => root.render(<AndroidCalendarProvider><Probe /></AndroidCalendarProvider>)); };

it('never publishes an empty event snapshot when a selected source failed', async () => {
  localStorage.setItem('courrier-android-calendars-v1', '["g"]');
  fixtures.errors = { g: 'offline' };
  await mount();
  for (const [payload] of fixtures.publish.mock.calls) {
    expect(payload).toHaveLength(1);
    expect(payload[0].events).toBeUndefined();
  }
});
it('keeps the selection unchanged when calendar permission is refused', async () => {
  fixtures.permission.mockResolvedValue(false);
  await mount();
  await act(async () => { await expect(current.saveSelection(['g'])).rejects.toThrow('calendar_permission_denied'); });
  expect(current.selected).toEqual([]);
  expect(localStorage.getItem('courrier-android-calendars-v1')).toBeNull();
});
it('persists selection on this device and removes Android copies when deselected', async () => {
  await mount();
  await act(async () => current.saveSelection(['g']));
  expect(localStorage.getItem('courrier-android-calendars-v1')).toBe('["g"]');
  expect(fixtures.publish).toHaveBeenLastCalledWith([{ id: 'g', name: 'Work', color: '#123456', events: [] }]);
  await act(async () => current.saveSelection([]));
  expect(fixtures.publish).toHaveBeenLastCalledWith([]);
});
it('surfaces a native publication failure for retry', async () => {
  fixtures.publish.mockRejectedValue(new Error('permission revoked'));
  await mount();
  expect(current.state).toBe('error');
  fixtures.publish.mockResolvedValue(undefined);
  await act(async () => current.refresh());
  expect(current.state).toBe('success');
});
