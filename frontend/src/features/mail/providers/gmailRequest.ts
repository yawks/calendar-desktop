// Share pacing across provider instances for the same account.
const accounts = new Map<string, { queue: Promise<void>; nextRequest: number }>();

export async function gmailRequest(accountId: string, url: string, options: RequestInit): Promise<Response> {
  let state = accounts.get(accountId);
  if (!state) {
    state = { queue: Promise.resolve(), nextRequest: 0 };
    accounts.set(accountId, state);
  }
  const account = state;
  const request = account.queue.then(async () => {
    for (let attempt = 0; ; attempt++) {
      const delay = account.nextRequest - Date.now();
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      // Metadata reads cost up to 10 units: keep sustained reads below 15,000 units/minute.
      account.nextRequest = Date.now() + 100;
      const response = await fetch(url, options);
      const body = response.status === 403 ? await response.clone().text() : '';
      const limited = response.status === 429 || (response.status === 403
        && /quota exceeded|userRateLimitExceeded|rateLimitExceeded/i.test(body));
      if (!limited) return response;

      const retryAfter = response.headers.get('Retry-After');
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      const retryAt = Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(retryAfter ?? '');
      account.nextRequest = Math.max(Date.now() + 60_000 * 2 ** attempt, Number.isFinite(retryAt) ? retryAt : 0);
      // Only repeat reads; writes may have side effects such as sending mail.
      if ((options.method ?? 'GET').toUpperCase() !== 'GET' || attempt >= 1) return response;
    }
  });
  account.queue = request.then(() => undefined, () => undefined);
  return request;
}
