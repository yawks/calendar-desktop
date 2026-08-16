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
    return (await request<{ text: string }>('/ics/fetch', { url })).text;
  },
  async fetchCalDav(credentials: Credentials): Promise<string> {
    return (await request<{ text: string }>('/caldav/fetch', credentials)).text;
  },
  async getCalDavStatus(credentials: Credentials): Promise<number> {
    return (await request<{ status: number }>('/caldav/status', credentials)).status;
  },
  async putCalDav(credentials: Credentials, icsContent: string): Promise<void> {
    await request('/caldav/resource', { ...credentials, icsContent }, 'PUT');
  },
  async deleteCalDav(credentials: Credentials): Promise<void> {
    await request('/caldav/resource', credentials, 'DELETE');
  },
};
import { apiHeaders, apiJson, apiUrl } from './apiRequest';
