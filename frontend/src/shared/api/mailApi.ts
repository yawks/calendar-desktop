import { apiHeaders, apiJson, apiUrl } from './apiRequest';

export async function mailCommand<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(apiUrl(`/api/mail/commands/${encodeURIComponent(command)}`), {
    method: 'POST', credentials: 'same-origin',
    headers: apiHeaders({ 'content-type': 'application/json' }), body: JSON.stringify(args),
  });
  return apiJson<T>(response);
}
