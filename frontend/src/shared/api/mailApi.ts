import { apiHeaders, apiJson, apiUrl } from './apiRequest';
import { hasNativeTransport, invokeNative } from './nativeTransport';

export async function mailCommand<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    if (hasNativeTransport()) return await invokeNative<T>(command, args);
    const response = await fetch(apiUrl(`/api/mail/commands/${encodeURIComponent(command)}`), {
      method: 'POST', credentials: 'same-origin',
      headers: apiHeaders({ 'content-type': 'application/json' }), body: JSON.stringify(args),
    });
    return await apiJson<T>(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Keep the failing operation, never its token or message identifiers.
    if (message.includes('ErrorItemNotFound')) throw new Error(`[${command}] ${message}`);
    throw error;
  }
}
