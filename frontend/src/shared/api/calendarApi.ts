import { apiHeaders, apiJson, apiUrl } from './apiRequest';
import { hasNativeTransport, invokeNative } from './nativeTransport';

type Credentials = { url: string; username: string; password: string };

async function request<T>(path: string, body: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(apiUrl(`/api/calendar${path}`), {
    method,
    credentials: 'same-origin',
    headers: apiHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
  return apiJson<T>(response);
}

export const calendarApi = {
  async fetchIcs(url: string): Promise<string> {
    if (hasNativeTransport()) return (await invokeNative<{ text: string }>('calendar_ics_fetch', { url })).text;
    return (await request<{ text: string }>('/ics/fetch', { url })).text;
  },
  async fetchCalDav(credentials: Credentials): Promise<string> {
    if (hasNativeTransport()) return (await invokeNative<{ text: string }>('calendar_caldav_fetch', credentials)).text;
    return (await request<{ text: string }>('/caldav/fetch', credentials)).text;
  },
  async getCalDavStatus(credentials: Credentials): Promise<number> {
    if (hasNativeTransport()) return (await invokeNative<{ status: number }>('calendar_caldav_status', credentials)).status;
    return (await request<{ status: number }>('/caldav/status', credentials)).status;
  },
  async putCalDav(credentials: Credentials, icsContent: string): Promise<void> {
    if (hasNativeTransport()) { await invokeNative('calendar_caldav_put', { ...credentials, icsContent }); return; }
    await request('/caldav/resource', { ...credentials, icsContent }, 'PUT');
  },
  async deleteCalDav(credentials: Credentials): Promise<void> {
    if (hasNativeTransport()) { await invokeNative('calendar_caldav_delete', credentials); return; }
    await request('/caldav/resource', credentials, 'DELETE');
  },
};
