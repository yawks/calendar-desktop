import type { MailAttachment, MailFolder, MailMessage, MailThread } from '../types';
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

  /** Prevents overlapping background inbox refreshes. */
  private refreshing = false;

  constructor(inner: MailProvider, onInboxRefreshed?: OnInboxRefreshed) {
    this.inner = inner;
    this.providerType = inner.providerType;
    this.accountId = inner.accountId;
    this.onInboxRefreshed = onInboxRefreshed;
  }

  // ── Threads ────────────────────────────────────────────────────────────────

  async listThreads(folder: string, maxCount = 50, offset = 0): Promise<MailThread[]> {
    // Only cache inbox, first page
    if (folder !== 'inbox' || offset !== 0) {
      return this.inner.listThreads(folder, maxCount, offset);
    }

    const cached = await getInboxThreads(this.accountId);

    if (cached.length > 0) {
      // Return cached data immediately, refresh in background
      this.backgroundRefresh(maxCount);
      return cached.slice(0, maxCount);
    }

    // Cold cache: blocking fetch
    return this.fetchAndCache(maxCount);
  }

  private async fetchAndCache(maxCount: number): Promise<MailThread[]> {
    const threads = await this.inner.listThreads('inbox', maxCount, 0);
    await setInboxThreads(this.accountId, threads);
    return threads;
  }

  private backgroundRefresh(maxCount: number): void {
    if (this.refreshing) return;
    this.refreshing = true;
    this.inner
      .listThreads('inbox', maxCount, 0)
      .then(async threads => {
        await setInboxThreads(this.accountId, threads);
        this.onInboxRefreshed?.(this.accountId, threads);
      })
      .catch(() => { /* non-critical */ })
      .finally(() => { this.refreshing = false; });
  }

  /**
   * Force a fresh network fetch and update the cache.
   * Called by the 60 s polling interval in MailPage (via silentRefresh).
   */
  async forceRefreshInbox(maxCount = 50): Promise<MailThread[]> {
    const threads = await this.inner.listThreads('inbox', maxCount, 0);
    await setInboxThreads(this.accountId, threads);
    return threads;
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
    // Patch conversation cache
    for (const item of items) {
      const cached = await getConversation(this.accountId, item.change_key);
      if (cached) {
        await setConversation(
          this.accountId,
          item.change_key,
          cached.map(m => m.item_id === item.item_id ? { ...m, is_read: true } : m),
        );
      }
    }
    // Patch thread unread count in inbox cache (best-effort per thread)
    const conversationIds = [...new Set(items.map(i => i.change_key).filter(Boolean))];
    for (const cid of conversationIds) {
      await patchThreadUnread(this.accountId, cid, true);
    }
  }

  async markUnread(items: MailItemRef[]): Promise<void> {
    await this.inner.markUnread(items);
    for (const item of items) {
      const cached = await getConversation(this.accountId, item.change_key);
      if (cached) {
        await setConversation(
          this.accountId,
          item.change_key,
          cached.map(m => m.item_id === item.item_id ? { ...m, is_read: false } : m),
        );
      }
    }
    const conversationIds = [...new Set(items.map(i => i.change_key).filter(Boolean))];
    for (const cid of conversationIds) {
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
