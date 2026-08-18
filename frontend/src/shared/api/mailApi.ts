import { apiHeaders, apiJson, apiUrl } from './apiRequest';
import { hasNativeTransport, invokeNative } from './nativeTransport';

export async function mailCommand<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (hasNativeTransport()) return invokeNative<T>(command, args);
  const response = await fetch(apiUrl(`/api/mail/commands/${encodeURIComponent(command)}`), {
    method: 'POST', credentials: 'same-origin',
    headers: apiHeaders({ 'content-type': 'application/json' }), body: JSON.stringify(args),
  });
  return apiJson<T>(response);
}
