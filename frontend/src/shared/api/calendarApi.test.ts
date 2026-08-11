import { afterEach, describe, expect, it, vi } from 'vitest';
import { calendarApi } from './calendarApi';

describe('calendarApi', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps the generic ICS endpoint response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: 'BEGIN:VCALENDAR' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(calendarApi.fetchIcs('https://calendar.example/feed.ics')).resolves.toBe('BEGIN:VCALENDAR');
    expect(fetchMock).toHaveBeenCalledWith('/api/calendar/ics/fetch', expect.objectContaining({ method: 'POST' }));
  });

  it('surfaces structured backend errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'provider_host_not_allowed' }), { status: 403 })));
    await expect(calendarApi.fetchIcs('https://attacker.example/feed.ics')).rejects.toThrow('provider_host_not_allowed');
  });
});
