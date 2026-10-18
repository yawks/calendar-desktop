// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
import { CalendarProvider, useCalendars } from './CalendarStore';
import { TagProvider, useTags } from './TagStore';
import { CalendarGroupProvider, useCalendarGroups } from './CalendarGroupStore';
import { applyPortableConfig, pickPortableConfig } from '../../../shared/security/portableConfig';
const data = vi.hoisted(() => ({ payload: {} as Record<string, unknown>, cache: {} as Record<string, string> }));
vi.mock('../../../shared/security/VaultProvider', () => ({ useVault: () => ({
  read: (key: string, fallback: unknown) => data.payload[key] ?? fallback,
  write: (key: string, value: unknown) => { data.payload[key] = value; },
}) }));
vi.mock('../utils/eventCache', () => ({ cacheGetStale: async () => data.cache,
  cacheSet: async (_key: string, value: Record<string, string>) => { data.cache = value; } }));
let calendars: ReturnType<typeof useCalendars>;
let tags: ReturnType<typeof useTags>;
let groups: ReturnType<typeof useCalendarGroups>;
function Probe() { calendars = useCalendars(); tags = useTags(); groups = useCalendarGroups(); return null; }
async function mount() {
  const root = createRoot(document.createElement('div'));
  await act(async () => root.render(<CalendarProvider><TagProvider><CalendarGroupProvider><Probe /></CalendarGroupProvider></TagProvider></CalendarProvider>));
  return root;
}
beforeEach(() => {
  localStorage.clear(); data.payload = {}; data.cache = {};
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});
it('migrates existing groups, tags and mappings and restores their portable snapshot', async () => {
  localStorage.setItem('calendar-desktop-groups', '[{"id":"work","name":"Work"}]');
  localStorage.setItem('calendar-desktop-tags', '[{"id":"focus","name":"Focus","color":"#123456"}]');
  data.cache = { event: 'focus' };
  const root = await mount();
  expect(groups.groups.map(g => g.id)).toEqual(['default', 'work', 'other-calendars']);
  expect(tags.eventTags).toEqual({ event: 'focus' });
  await act(async () => { tags.updateTag('focus', { name: 'Updated' }); groups.updateGroup('work', { name: 'Updated work' }); tags.setEventTag('series', 'focus'); });
  data.payload['calendar-desktop-calendars'] = [{ id: 'calendar', groupId: 'work' }];
  const remote = pickPortableConfig(data.payload);
  expect(remote['calendar-event-tags']).toEqual({ event: 'focus', series: 'focus' });
  expect(remote['calendar-desktop-calendars']).toEqual([{ id: 'calendar', groupId: 'work' }]);
  await act(async () => root.unmount());
  data.payload = applyPortableConfig({}, remote);
  const restored = await mount();
  expect(tags.tags[0].name).toBe('Updated');
  expect(groups.groups[1].name).toBe('Updated work');
  expect(tags.eventTags).toEqual({ event: 'focus', series: 'focus' });
  await act(async () => restored.unmount());
});
it('uses remote empty values instead of stale local data', async () => {
  data.payload = { 'calendar-desktop-tags': [], 'calendar-desktop-groups': [{ id: 'default', name: 'Remote' }], 'calendar-event-tags': {} };
  localStorage.setItem('calendar-desktop-tags', '[{"id":"old"}]');
  data.cache = { old: 'old' };
  const root = await mount();
  expect(tags.tags).toEqual([]);
  expect(tags.eventTags).toEqual({});
  expect(groups.groups[0].name).toBe('Remote');
  await act(async () => root.unmount());
});

it('keeps calendar group changes and order after remounting', async () => {
  data.payload['calendar-desktop-calendars'] = [
    { id: 'first', name: 'First', url: '', color: '#123456', visible: true },
    { id: 'second', name: 'Second', url: '', color: '#123456', visible: true },
  ];
  const root = await mount();
  await act(async () => calendars.reorderCalendars([
    { ...calendars.calendars[1], groupId: 'work' }, calendars.calendars[0],
  ]));
  await act(async () => root.unmount());
  const restored = await mount();
  expect(calendars.calendars.map(c => [c.id, c.groupId])).toEqual([['second', 'work'], ['first', undefined]]);
  await act(async () => restored.unmount());
});

it('syncs shared references, colors and visibility without event data or copied CalDAV secrets', async () => {
  const root = await mount();
  await act(async () => {
    calendars.addCalendar({ name: 'Team', type: 'nextcloud', url: 'https://cloud.example/dav/team/', color: '#123456', visible: true,
      shared: { ownerEmail: 'other@example.com', sourceCalendarId: 'source' } });
  });
  const id = calendars.calendars[0].id;
  await act(async () => { calendars.toggleCalendar(id); calendars.updateCalendar(id, { color: '#abcdef', groupId: 'work', shared: undefined }); });
  const remote = pickPortableConfig(data.payload);
  const stored = (remote['calendar-desktop-calendars'] as Array<Record<string, unknown>>)[0];
  expect(stored).toMatchObject({ groupId: 'other-calendars', color: '#abcdef', visible: false, shared: { ownerEmail: 'other@example.com', sourceCalendarId: 'source' } });
  expect(stored).not.toHaveProperty('nextcloudPassword');
  expect(stored).not.toHaveProperty('events');
  await act(async () => root.unmount());
  data.payload = applyPortableConfig({}, remote);
  const restored = await mount();
  expect(calendars.calendars[0]).toEqual(stored);
  await act(async () => { calendars.removeCalendar('source'); });
  expect(calendars.calendars).toEqual([]);
  await act(async () => restored.unmount());
});
