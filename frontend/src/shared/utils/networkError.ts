/** Connectivity failures expected while the browser and network stack wake up. */
export function isOfflineLikeError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? '');
  return [
    /failed to fetch/i,
    /fetch failed/i,
    /network\s*error/i,
    /network request failed/i,
    /load failed/i,
    /connection (?:refused|reset|closed|aborted)/i,
    /timed?\s*out/i,
    /(?:http|api|status|response)?\s*50[234]\b/i,
    /bad gateway/i,
    /service unavailable/i,
    /gateway timeout/i,
  ].some(pattern => pattern.test(message));
}

/** Provider failures that are expected to recover without user action. */
export function isTemporaryMailServiceError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? '');
  return [
    /ErrorMailboxStoreUnavailable/i,
    /mailbox (?:database|store) is temporarily unavailable/i,
    /cannot open mailbox/i,
  ].some(pattern => pattern.test(message));
}
