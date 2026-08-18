import { apiHeaders, apiJson, apiUrl } from './apiRequest';
import { hasNativeTransport, invokeNative } from './nativeTransport';

async function post<T>(path: string, body: unknown): Promise<T> {
  if (hasNativeTransport()) {
    const operation = path === 'events' ? 'create' : path === 'free-busy' ? 'free_busy' : path;
    return invokeNative<T>(`exchange_calendar_${operation}`, body as Record<string, unknown>);
  }
  const response = await fetch(apiUrl(`/api/calendar/exchange/${path}`), { method: 'POST', credentials: 'same-origin', headers: apiHeaders({ 'content-type': 'application/json' }), body: JSON.stringify(body) });
  return apiJson<T>(response);
}

export const exchangeCalendarApi = {
  list: <T>(request: Record<string, unknown>): Promise<T> => post<T>('list', request),
  freeBusy: <T>(request: Record<string, unknown>): Promise<T> => post<T>('free-busy', request),
  create: async (request: Record<string, unknown>): Promise<string> => {
    const result = await post<{ itemId?: string; changeKey?: string } | string>('events', request);
    return typeof result === 'string' ? result : `${result.itemId}|${result.changeKey}`;
  },
  respond: (request: Record<string, unknown>): Promise<void> => post<void>('respond', request),
  update: (request: Record<string, unknown>): Promise<void> => post<void>('update', request),
  delete: (request: Record<string, unknown>): Promise<void> => post<void>('delete', request),
  cancel: (request: Record<string, unknown>): Promise<void> => post<void>('cancel', request),
};
