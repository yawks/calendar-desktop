export async function mailCommand<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(`/api/mail/commands/${encodeURIComponent(command)}`, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(args),
  });
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
  return payload as T;
}
