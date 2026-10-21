import { apiHeaders, apiJson, apiUrl } from './apiRequest';
import { hasNativeTransport, invokeNative } from './nativeTransport';
import { platform } from '../platform';

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
  if (hasNativeTransport()) {
    const command = path === 'device' ? 'exchange_auth_device' : path === 'token' ? 'exchange_auth_token' : 'exchange_auth_refresh';
    if (platform.exchangeAuth) {
      try {
        return await platform.exchangeAuth<T>(command, (body ?? {}) as Record<string, unknown>);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Exchange Android/${path}: ${message}`);
      }
    }
    return invokeNative<T>(command, (body ?? {}) as Record<string, unknown>);
  }
  const response = await fetch(apiUrl(`/api/auth/exchange/${path}`), {
    method: 'POST', credentials: 'same-origin',
    headers: apiHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify(body ?? {}),
  });
  return apiJson<T>(response);
}

export const exchangeAuthApi = {
  startDeviceAuth: () => post<ExchangeDeviceResponse>('device'),
  pollDeviceToken: (deviceCode: string) => post<ExchangeTokenResponse>('token', { deviceCode }),
  refresh: (refreshToken: string) => post<ExchangeTokenResponse>('refresh', { refreshToken }),
};
