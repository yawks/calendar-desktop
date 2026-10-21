import { afterEach, describe, expect, it, vi } from 'vitest';
import { gmailRequest } from './gmailRequest';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Gmail quota pacing', () => {
  it('spaces concurrent requests for the same account', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    const first = gmailRequest('pacing', '/messages', {});
    const second = gmailRequest('pacing', '/labels', {});
    await first;
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    await second;
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('waits for Retry-After before retrying a quota rejection and releasing queued requests', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":{"message":"Quota exceeded"}}', {
        status: 403, headers: { 'Retry-After': '90' },
      }))
      .mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    const read = gmailRequest('quota', '/messages', {});
    const queued = gmailRequest('quota', '/labels', {});
    await vi.advanceTimersByTimeAsync(89_999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(101);
    await Promise.all([read, queued]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('does not retry permission errors or writes', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('Insufficient Permission', { status: 403 }))
      .mockResolvedValueOnce(new Response('Quota exceeded', { status: 403 }));
    vi.stubGlobal('fetch', fetch);
    expect((await gmailRequest('permission', '/messages', {})).status).toBe(403);
    expect((await gmailRequest('write', '/messages/send', { method: 'POST' })).status).toBe(403);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('bounds retries and keeps the queue usable after a network failure', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue(new Response('limited', { status: 429 }));
    vi.stubGlobal('fetch', fetch);
    const read = gmailRequest('bounded', '/messages', {});
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await read).status).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(2);

    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(gmailRequest('network', '/messages', {})).rejects.toThrow('Failed to fetch');
    fetch.mockResolvedValueOnce(new Response('{}'));
    const next = gmailRequest('network', '/messages', {});
    await vi.advanceTimersByTimeAsync(100);
    expect((await next).ok).toBe(true);
  });
});
