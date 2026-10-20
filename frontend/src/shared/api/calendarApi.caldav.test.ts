import { afterEach, expect, it, vi } from 'vitest';
import { calendarApi } from './calendarApi';
import { hasNativeTransport, invokeNative } from './nativeTransport';
vi.mock('./nativeTransport', () => ({ hasNativeTransport: vi.fn(), invokeNative: vi.fn() }));
const auth = { url: 'https://calendar.example.test/task.ics', username: 'test', password: 'fixture' };
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });
it.each([false, true])('preserves resource ETags and conditional writes through web/native adapters (native=%s)', async native => {
  vi.mocked(hasNativeTransport).mockReturnValue(native);
  const resource = { text: 'BEGIN:VCALENDAR', etag: '"version-1"' };
  vi.mocked(invokeNative).mockResolvedValue(resource);
  const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(resource), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  expect(await calendarApi.fetchCalDavResource(auth)).toEqual(resource);
  await calendarApi.putCalDav(auth, 'updated ICS', resource.etag);
  if (native) {
    expect(invokeNative).toHaveBeenLastCalledWith('calendar_caldav_put', { ...auth, icsContent: 'updated ICS', ifMatch: resource.etag });
    expect(fetchMock).not.toHaveBeenCalled();
  } else {
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ ...auth, icsContent: 'updated ICS', ifMatch: resource.etag });
    expect(fetchMock.mock.calls[1][1].method).toBe('PUT');
  }
});
