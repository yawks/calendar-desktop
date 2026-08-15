const USER_INITIATED_UNREAD_TTL_MS = 15_000;

const userInitiatedUnread = new Map<string, number>();

const keyFor = (accountId: string, conversationId: string) => `${accountId}:${conversationId}`;

export function recordUserInitiatedUnread(accountId: string, conversationId: string) {
  userInitiatedUnread.set(keyFor(accountId, conversationId), Date.now() + USER_INITIATED_UNREAD_TTL_MS);
}

export function consumeUserInitiatedUnread(accountId: string, conversationId: string) {
  const key = keyFor(accountId, conversationId);
  const expiresAt = userInitiatedUnread.get(key);
  if (expiresAt === undefined) return false;
  userInitiatedUnread.delete(key);
  return expiresAt >= Date.now();
}
