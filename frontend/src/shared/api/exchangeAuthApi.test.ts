import { afterEach, describe, expect, it, vi } from 'vitest';
import { exchangeAuthApi } from './exchangeAuthApi';

describe('exchangeAuthApi', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the same-origin device authorization endpoint', async () => {
    const payload = { device_code: 'device', user_code: 'code', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 5, message: '' };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(exchangeAuthApi.startDeviceAuth()).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/exchange/device', expect.objectContaining({ credentials: 'same-origin' }));
  });

  it('preserves authorization_pending for the polling loop', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'authorization_pending' }), { status: 409 })));
    await expect(exchangeAuthApi.pollDeviceToken('device')).rejects.toThrow('authorization_pending');
  });
});
