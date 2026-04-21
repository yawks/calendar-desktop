import type { MailAttachment, MailFolder, MailIdentity, MailMessage, MailSearchQuery, MailThread } from '../types';
import {
  evictConversation,
  evictThread,
  getConversation,
  getInboxThreads,
  patchThreadUnread,
  setConversation,
  setInboxThreads,
} from './mailCache';
import type { MailItemRef, MailProvider, SaveDraftParams, SendMailParams } from './MailProvider';

/**
 * Callback fired when a background inbox refresh completes.
 * Lets MailPage silently update the thread list without a loading spinner.
 */
export type OnInboxRefreshed = (accountId: string, threads: MailThread[]) => void;

/**
 * Transparent caching wrapper around any MailProvider.
 *
 * Strategy:
 * - listThreads('inbox', maxCount, 0):
 *     1. Return cached threads from IndexedDB immediately (fast first paint).
 *     2. Kick off a background network fetch; on completion update the cache
 *        and notify via onInboxRefreshed.
 *     If the cache is empty, skip straight to a blocking network fetch.
 * - listThreads(other folder or offset > 0): pass through.
 * - getThread: return cached messages if available, else fetch + cache.
 * - Write operations: delegate to inner provider + invalidate / patch cache.
 */
export class CachedMailProvider implements MailProvider {
  readonly providerType: MailProvider['providerType'];
  readonly accountId: string;

  private readonly inner: MailProvider;
  private readonly onInboxRefreshed: OnInboxRefreshed | undefined;

  /**
   * Tracks the in-flight background refresh promise.
   * Pagination calls (offset > 0) await this so that Gmail's page token
   * is populated before they run, preventing a duplicate first-page fetch.
   */
  private refreshPromise: Promise<void> | null = null;

  constructor(inner: MailProvider, onInboxRefreshed?: OnInboxRefreshed) {
    this.inner = inner;
    this.providerType = inner.providerType;
    this.accountId = inner.accountId;
    this.onInboxRefreshed = onInboxRefreshed;
  }

  // ── Threads ────────────────────────────────────────────────────────────────

  async listThreads(folder: string, maxCount = 50, offset = 0): Promise<MailThread[]> {
    if (folder.toLowerCase() !== 'inbox') {
      return this.inner.listThreads(folder, maxCount, offset);
    }

    if (offset !== 0) {
      // Pagination: wait for any in-flight background refresh first so that
      // providers relying on page tokens (e.g. Gmail) have their token ready.
      if (this.refreshPromise) await this.refreshPromise;
      return this.inner.listThreads(folder, maxCount, offset);
    }

    const cached = await getInboxThreads(this.accountId);

    if (cached.length > 0) {
      // Return cached data immediately, refresh in background
      this.startBackgroundRefresh(maxCount);
      return cached.slice(0, maxCount);
    }

    // Cold cache: blocking fetch
    return this.fetchAndCache(maxCount);
  }

  /**
   * Fetch fresh inbox threads, evict conversation cache for threads whose
   * message_count changed (new messages arrived), then update the thread cache.
   */
  private async fetchAndCache(maxCount: number): Promise<MailThread[]> {
    const [threads, previousThreads] = await Promise.all([
      this.inner.listThreads('inbox', maxCount, 0),
      getInboxThreads(this.accountId),
    ]);
    await this.evictStaleConversations(threads, previousThreads);
    await setInboxThreads(this.accountId, threads);
    return threads;
  }

  /**
   * Evict conversation message cache for any thread whose message_count
   * has increased since the last fetch, so getThread() re-fetches fresh messages.
   */
  private async evictStaleConversations(
    freshThreads: MailThread[],
    previousThreads: MailThread[],
  ): Promise<void> {
    const prevMap = new Map(previousThreads.map(t => [t.conversation_id, t.message_count]));
    const toEvict = freshThreads.filter(t => {
      const prev = prevMap.get(t.conversation_id);
      return prev !== undefined && t.message_count !== prev;
    });
    await Promise.all(
      toEvict.map(t => evictConversation(this.accountId, t.conversation_id))
    );
  }

  private startBackgroundRefresh(maxCount: number): void {
    if (this.refreshPromise) return;
    this.refreshPromise = this.fetchAndCache(maxCount)
      .then(threads => { this.onInboxRefreshed?.(this.accountId, threads); })
      .catch(() => { /* non-critical */ })
      .finally(() => { this.refreshPromise = null; });
  }

  /** Search bypasses the cache entirely — always delegates to the inner provider. */
  searchThreads(query: MailSearchQuery, maxCount?: number): Promise<MailThread[]> {
    return this.inner.searchThreads(query, maxCount);
  }

  /**
   * Force a fresh network fetch and update the cache.
   * Called by the 60 s polling interval in MailPage (via silentRefresh).
   */
  forceRefreshInbox(maxCount = 50): Promise<MailThread[]> {
    return this.fetchAndCache(maxCount);
  }

  // ── Messages ───────────────────────────────────────────────────────────────

  async getThread(conversationId: string, includeTrash = false, isDraft = false): Promise<MailMessage[]> {
    // Don't cache trash/draft views — they are edge cases with rapidly changing state
    if (includeTrash || isDraft) {
      return this.inner.getThread(conversationId, includeTrash, isDraft);
    }

    const cached = await getConversation(this.accountId, conversationId);
    if (cached) return cached;

    const messages = await this.inner.getThread(conversationId, false, false);
    await setConversation(this.accountId, conversationId, messages);
    return messages;
  }

  // ── Folders ────────────────────────────────────────────────────────────────

  listFolders(): Promise<MailFolder[]> {
    return this.inner.listFolders();
  }

  getInboxUnread(): Promise<number> {
    return this.inner.getInboxUnread();
  }

  listIdentities(): Promise<MailIdentity[]> {
    return this.inner.listIdentities?.() ?? Promise.resolve([]);
  }

  // ── Send / draft ───────────────────────────────────────────────────────────

  sendMail(params: SendMailParams): Promise<void> {
    return this.inner.sendMail(params);
  }

  saveDraft(params: SaveDraftParams): Promise<void> {
    return this.inner.saveDraft(params);
  }

  // ── Read / unread ──────────────────────────────────────────────────────────

  async markRead(items: MailItemRef[]): Promise<void> {
    await this.inner.markRead(items);
    const readIds = new Set(items.map(i => i.item_id));
    const conversationIds = [...new Set(items.map(i => i.conversation_id).filter(Boolean))] as string[];
    for (const cid of conversationIds) {
      const cached = await getConversation(this.accountId, cid);
      if (cached) {
        await setConversation(
          this.accountId,
          cid,
          cached.map(m => readIds.has(m.item_id) ? { ...m, is_read: true } : m),
        );
      }
      await patchThreadUnread(this.accountId, cid, true);
    }
  }

  async markUnread(items: MailItemRef[]): Promise<void> {
    await this.inner.markUnread(items);
    const unreadIds = new Set(items.map(i => i.item_id));
    const conversationIds = [...new Set(items.map(i => i.conversation_id).filter(Boolean))] as string[];
    for (const cid of conversationIds) {
      const cached = await getConversation(this.accountId, cid);
      if (cached) {
        await setConversation(
          this.accountId,
          cid,
          cached.map(m => unreadIds.has(m.item_id) ? { ...m, is_read: false } : m),
        );
      }
      await patchThreadUnread(this.accountId, cid, false);
    }
  }

  // ── Delete / trash ─────────────────────────────────────────────────────────

  async moveToTrash(itemId: string): Promise<void> {
    await this.inner.moveToTrash(itemId);
    // We don't know the conversationId here; eviction happens on next inbox refresh.
    // Evict the full conversation from message cache if item is a thread root —
    // this is best-effort; the inbox thread cache will be corrected by the next refresh.
  }

  async permanentlyDelete(itemId: string): Promise<void> {
    return this.inner.permanentlyDelete(itemId);
  }

  // ── Move / snooze ──────────────────────────────────────────────────────────

  async moveToFolder(itemId: string, folderId: string): Promise<void> {
    await this.inner.moveToFolder(itemId, folderId);
  }

  async snooze(itemId: string): Promise<string> {
    return this.inner.snooze(itemId);
  }

  findOrCreateSnoozedFolder(): Promise<string> {
    return this.inner.findOrCreateSnoozedFolder();
  }

  // ── Attachments ────────────────────────────────────────────────────────────

  openAttachment(attachment: MailAttachment): Promise<void> {
    return this.inner.openAttachment(attachment);
  }

  getAttachmentData(attachment: MailAttachment): Promise<string> {
    return this.inner.getAttachmentData(attachment);
  }

  // ── Cache management (public API for MailPage) ─────────────────────────────

  /** Evict a thread and its messages from the cache (e.g. after move/delete). */
  async evict(conversationId: string): Promise<void> {
    await Promise.all([
      evictThread(this.accountId, conversationId),
      evictConversation(this.accountId, conversationId),
    ]);
  }
}
