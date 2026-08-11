import { afterEach, describe, expect, it, vi } from 'vitest';
import { exchangeCalendarApi } from './exchangeCalendarApi';

describe('exchangeCalendarApi', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps the generic event identifier returned by EWS', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ itemId: 'item', changeKey: 'change' }), { status: 200 })));
    await expect(exchangeCalendarApi.create({ title: 'Meeting' })).resolves.toBe('item|change');
  });

  it('sends RSVP through the same-origin backend', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await exchangeCalendarApi.respond({ responseType: 'accept' });
    expect(fetchMock).toHaveBeenCalledWith('/api/calendar/exchange/respond', expect.objectContaining({ credentials: 'same-origin' }));
  });

  it.each(['update', 'delete', 'cancel'] as const)('sends %s mutations through typed routes', async (operation) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await exchangeCalendarApi[operation]({ itemId: 'item' });
    expect(fetchMock).toHaveBeenCalledWith(`/api/calendar/exchange/${operation}`, expect.objectContaining({ method: 'POST' }));
  });

  it.each([['list', 'list'], ['freeBusy', 'free-busy']] as const)('loads Exchange data with %s', async (operation, route) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await exchangeCalendarApi[operation]<Record<string, never>>({});
    expect(fetchMock).toHaveBeenCalledWith(`/api/calendar/exchange/${route}`, expect.anything());
  });
});
