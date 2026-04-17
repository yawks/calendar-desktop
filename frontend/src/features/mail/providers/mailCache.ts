import Dexie, { type Table } from 'dexie';

import type { MailFolder, MailMessage, MailThread } from '../types';

// ── Stored types ──────────────────────────────────────────────────────────────

export interface CachedThread extends MailThread {
  /** Provider account this thread belongs to. */
  accountId: string;
  /** Folder key (e.g. 'inbox'). */
  folder: string;
  /** Unix ms timestamp of when this entry was written. */
  cachedAt: number;
}

export interface CachedConversation {
  /** "<accountId>:<conversationId>" — primary key. */
  id: string;
  conversationId: string;
  accountId: string;
  messages: MailMessage[];
  cachedAt: number;
}

export interface CachedFolders {
  accountId: string;
  folders: MailFolder[];
  cachedAt: number;
}

// ── Database ──────────────────────────────────────────────────────────────────

const INBOX_LIMIT = 100;

class MailCacheDatabase extends Dexie {
  threads!: Table<CachedThread>;
  conversations!: Table<CachedConversation>;
  folders!: Table<CachedFolders>;

  constructor() {
    super('mail-cache');
    this.version(1).stores({
      threads: '[accountId+folder+conversation_id], [accountId+folder], cachedAt',
      conversations: 'id, [accountId+conversationId], cachedAt',
    });
    this.version(2).stores({
      threads: '[accountId+folder+conversation_id], [accountId+folder], cachedAt',
      conversations: 'id, [accountId+conversationId], cachedAt',
      folders: 'accountId, cachedAt',
    });
  }
}

export const mailCacheDb = new MailCacheDatabase();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Replace all cached inbox threads for an account, enforcing the INBOX_LIMIT. */
export async function setInboxThreads(accountId: string, threads: MailThread[]): Promise<void> {
  const folder = 'inbox';
  const now = Date.now();
  const limited = threads.slice(0, INBOX_LIMIT);

  await mailCacheDb.transaction('rw', mailCacheDb.threads, async () => {
    await mailCacheDb.threads.where('[accountId+folder]').equals([accountId, folder]).delete();
    await mailCacheDb.threads.bulkPut(
      limited.map(t => ({ ...t, accountId, folder, cachedAt: now }))
    );
  });
}

/** Read cached inbox threads for an account, sorted by last_delivery_time desc. */
export async function getInboxThreads(accountId: string): Promise<MailThread[]> {
  const rows = await mailCacheDb.threads
    .where('[accountId+folder]')
    .equals([accountId, 'inbox'])
    .toArray();

  return rows
    .sort((a, b) => new Date(b.last_delivery_time).getTime() - new Date(a.last_delivery_time).getTime())
    .map(({ accountId: _a, folder: _f, cachedAt: _c, ...thread }) => thread as MailThread);
}

/** Cache the messages of a conversation. */
export async function setConversation(accountId: string, conversationId: string, messages: MailMessage[]): Promise<void> {
  await mailCacheDb.conversations.put({
    id: `${accountId}:${conversationId}`,
    conversationId,
    accountId,
    messages,
    cachedAt: Date.now(),
  });
}

/** Read cached messages of a conversation, or null if not cached. */
export async function getConversation(accountId: string, conversationId: string): Promise<MailMessage[] | null> {
  const row = await mailCacheDb.conversations.get(`${accountId}:${conversationId}`);
  return row?.messages ?? null;
}

/** Remove a conversation from cache (e.g. after move/delete). */
export async function evictConversation(accountId: string, conversationId: string): Promise<void> {
  await mailCacheDb.conversations.delete(`${accountId}:${conversationId}`);
}

/** Remove a thread from the inbox cache (e.g. after move/delete). */
export async function evictThread(accountId: string, conversationId: string): Promise<void> {
  await mailCacheDb.threads
    .where('[accountId+folder+conversation_id]')
    .equals([accountId, 'inbox', conversationId])
    .delete();
}

/** Persist all folders for one account. */
export async function setAccountFolders(accountId: string, folders: MailFolder[]): Promise<void> {
  await mailCacheDb.folders.put({ accountId, folders, cachedAt: Date.now() });
}

/** Read cached folders for one account, or empty array if not cached. */
export async function getAccountFolders(accountId: string): Promise<MailFolder[]> {
  const row = await mailCacheDb.folders.get(accountId);
  return row?.folders ?? [];
}

/** Update the is_read flag in the inbox cache for specific message ids. */
export async function patchThreadUnread(accountId: string, conversationId: string, isRead: boolean): Promise<void> {
  const key: [string, string, string] = [accountId, 'inbox', conversationId];
  const row = await mailCacheDb.threads
    .where('[accountId+folder+conversation_id]')
    .equals(key)
    .first();
  if (!row) return;

  const delta = isRead ? -row.unread_count : 1;
  await mailCacheDb.threads
    .where('[accountId+folder+conversation_id]')
    .equals(key)
    .modify({
      unread_count: Math.max(0, row.unread_count + delta),
      cachedAt: Date.now(),
    });
}
