// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { useCalendarEvents } from './useCalendarQueries';
import { exchangeCalendarApi } from '../../../shared/api/exchangeCalendarApi';
import i18n from '../../../i18n';
import type { CalendarConfig } from '../../../shared/types';
vi.mock('../../../shared/store/ExchangeAuthStore', () => ({ useExchangeAuth: () => ({ getValidToken: async () => 'fixture-token' }) }));
vi.mock('../../../shared/api/exchangeCalendarApi', () => ({ exchangeCalendarApi: { list: vi.fn() } }));
const calendar: CalendarConfig = { id: 'shared', name: 'Other', color: '#123456', visible: true, url: '', type: 'exchange', exchangeAccountId: 'account', exchangeFolderId: 'selected', shared: { ownerEmail: 'other@example.test' } };
const raw = { item_id: 'availability:start:end:Busy', change_key: '', subject: '', start: '2026-10-19T10:00:00Z', end: '2026-10-19T11:00:00Z', is_all_day: false, my_response_type: 'Accept', attendees: [], is_meeting: false, is_cancelled: false, availability_only: true };
afterEach(() => vi.clearAllMocks());
it.each(['fr', 'en'])('renders anonymous availability as localized busy slots without writable event identifiers (%s)', async language => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage(language);
  vi.mocked(exchangeCalendarApi.list).mockResolvedValue([raw, { ...raw, item_id: 'details', subject: 'Planning', location: 'Room' }]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let value: ReturnType<typeof useCalendarEvents> | undefined;
  function Probe() { value = useCalendarEvents([calendar]); return null; }
  const root = createRoot(document.createElement('div'));
  await act(async () => {
    root.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>);
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(value!.events).toHaveLength(2);
  expect(value!.events[0]).toMatchObject({ title: language === 'fr' ? 'Occupé' : 'Busy', start: raw.start, end: raw.end, availabilityOnly: true, calendarId: calendar.id });
  expect(value!.events[0].sourceId).toBeUndefined();
  expect(value!.events[0].selfRsvpStatus).toBeUndefined();
  expect(value!.events[1]).toMatchObject({ title: 'Planning', location: 'Room' });
  expect(exchangeCalendarApi.list).toHaveBeenCalledWith(expect.objectContaining({ sharedMailbox: 'other@example.test', folderId: 'selected' }));
  await act(async () => root.unmount());
  client.clear();
});
