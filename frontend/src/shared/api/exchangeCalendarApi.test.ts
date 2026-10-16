import { afterEach, describe, expect, it, vi } from 'vitest';
import { exchangeCalendarApi } from './exchangeCalendarApi';
import { hasNativeTransport, invokeNative } from './nativeTransport';

vi.mock('./nativeTransport', () => ({ hasNativeTransport: vi.fn(() => false), invokeNative: vi.fn() }));

describe('exchangeCalendarApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(hasNativeTransport).mockReturnValue(false);
    vi.mocked(invokeNative).mockReset();
  });

  it('passes participants through the desktop command and retains native error details', async () => {
    vi.mocked(hasNativeTransport).mockReturnValue(true);
    vi.mocked(invokeNative).mockResolvedValueOnce(null);
    const request = { itemId: 'item', attendees: ['new@example.org'] };
    await exchangeCalendarApi.update(request);
    expect(invokeNative).toHaveBeenCalledWith('exchange_calendar_update', request);
    vi.mocked(invokeNative).mockRejectedValueOnce('EWS update ErrorAccessDenied: denied');
    await expect(exchangeCalendarApi.update(request)).rejects.toThrow('ErrorAccessDenied');
    vi.mocked(invokeNative).mockRejectedValueOnce('ews_attendees_verification_failed');
    await expect(exchangeCalendarApi.update(request)).rejects.toThrow('ews_attendees_verification_failed');
  });

  it('maps the generic event identifier returned by EWS', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ itemId: 'item', changeKey: 'change' }), { status: 200 })));
    await expect(exchangeCalendarApi.create({ title: 'Meeting' })).resolves.toBe('item|change');
  });

  it('sends edited participants and surfaces Exchange failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'ErrorAccessDenied' }), { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(exchangeCalendarApi.update({ itemId: 'item', attendees: ['new@example.org'] })).rejects.toThrow('ErrorAccessDenied');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).attendees).toEqual(['new@example.org']);
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
