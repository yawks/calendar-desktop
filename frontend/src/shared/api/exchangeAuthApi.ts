export interface ExchangeTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export interface ExchangeDeviceResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  message: string;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/auth/exchange/${path}`, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
  return payload as T;
}

export const exchangeAuthApi = {
  startDeviceAuth: () => post<ExchangeDeviceResponse>('device'),
  pollDeviceToken: (deviceCode: string) => post<ExchangeTokenResponse>('token', { deviceCode }),
  refresh: (refreshToken: string) => post<ExchangeTokenResponse>('refresh', { refreshToken }),
};
