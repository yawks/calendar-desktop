import { apiHeaders, apiJson, apiUrl } from './apiRequest';

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(apiUrl(`/api/calendar/exchange/${path}`), { method: 'POST', credentials: 'same-origin', headers: apiHeaders({ 'content-type': 'application/json' }), body: JSON.stringify(body) });
  return apiJson<T>(response);
}

export const exchangeCalendarApi = {
  list: <T>(request: Record<string, unknown>): Promise<T> => post<T>('list', request),
  freeBusy: <T>(request: Record<string, unknown>): Promise<T> => post<T>('free-busy', request),
  create: async (request: Record<string, unknown>): Promise<string> => {
    const result = await post<{ itemId: string; changeKey: string }>('events', request);
    return `${result.itemId}|${result.changeKey}`;
  },
  respond: (request: Record<string, unknown>): Promise<void> => post<void>('respond', request),
  update: (request: Record<string, unknown>): Promise<void> => post<void>('update', request),
  delete: (request: Record<string, unknown>): Promise<void> => post<void>('delete', request),
  cancel: (request: Record<string, unknown>): Promise<void> => post<void>('cancel', request),
};
