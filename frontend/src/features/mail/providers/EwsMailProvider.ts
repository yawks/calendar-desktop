import { mailCommand as invoke } from '../../../shared/api/mailApi';
import { fileService } from '../../../shared/services/fileService';

import type { MailAttachment, MailFolder, MailMessage, MailSearchQuery, MailThread } from '../types';
import type { ComposerAttachment, Contact, ContactBackfillBatch, MailItemRef, MailProvider, SaveDraftParams, SendMailParams } from './MailProvider';

/**
 * Extracts base64 data-URI images from HTML, replaces them with cid: references,
 * and returns them as inline ComposerAttachments so EWS can send them properly.
 */
function extractInlineImages(html: string): { html: string; inlineImages: ComposerAttachment[] } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const inlineImages: ComposerAttachment[] = [];
  let counter = 0;

  for (const img of doc.querySelectorAll('img[src^="data:image/"]')) {
    const src = img.getAttribute('src') ?? '';
    const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/s.exec(src);
    if (!match) continue;

    const mimeType = match[1];
    const base64Data = match[2];
    const ext = mimeType.split('/')[1]?.split('+')[0] ?? 'png';
    const contentId = `inline-image-${++counter}`;

    inlineImages.push({
      name: `image${counter}.${ext}`,
      contentType: mimeType,
      size: base64Data.length,
      data: base64Data,
      isInline: true,
      contentId,
    });

    img.setAttribute('src', `cid:${contentId}`);
  }

  return { html: doc.body.innerHTML, inlineImages };
}

/**
 * EWS (Exchange Web Services) implementation of MailProvider.
 * Handles token acquisition internally — callers never touch access tokens.
 */
export class EwsMailProvider implements MailProvider {
  readonly providerType = 'ews' as const;
  readonly capabilities = { snooze: true, scheduledSend: { supported: true } } as const;
  readonly accountId: string;
  readonly userEmail: string;

  private readonly getValidToken: (id: string) => Promise<string | null>;

  constructor(accountId: string, getValidToken: (id: string) => Promise<string | null>, userEmail = '') {
    this.accountId = accountId;
    this.getValidToken = getValidToken;
    this.userEmail = userEmail;
  }

  private async token(): Promise<string> {
    const t = await this.getValidToken(this.accountId);
    if (!t) throw new Error('No valid EWS token — please reconnect your Exchange account.');
    return t;
  }

  async listThreads(folder: string, maxCount = 50, offset = 0): Promise<MailThread[]> {
    const accessToken = await this.token();
    return invoke<MailThread[]>('mail_list_threads', { accessToken, folder, maxCount, offset, userEmail: this.userEmail || null });
  }

  async getThreadCount(folder: string): Promise<number> {
    const accessToken = await this.token();
    return invoke<number>('mail_get_thread_count', { accessToken, folder });
  }

  async getThreadSnippet(conversationId: string): Promise<string> {
    const accessToken = await this.token();
    return invoke<string>('mail_get_thread_snippet', { accessToken, conversationId });
  }

  async searchThreads(query: MailSearchQuery, maxCount = 50): Promise<MailThread[]> {
    const accessToken = await this.token();
    console.log('[EWS.searchThreads] query:', JSON.stringify(query), '| maxCount:', maxCount);
    const results = await invoke<MailThread[]>('mail_search_threads', { accessToken, query, maxCount });
    console.log('[EWS.searchThreads] → threads returned:', results.length, results.map(t => t.topic));
    return results;
  }

  async getThread(conversationId: string, includeTrash = false, isDraft = false, includeDrafts = false): Promise<MailMessage[]> {
    const accessToken = await this.token();
    // EWS can return the conversation and its bodies in one GetConversationItems
    // response. Splitting this into headers followed by a lazy GetItem introduced
    // a visible two-request waterfall on every opened conversation.
    return invoke<MailMessage[]>('mail_get_thread', {
      accessToken, conversationId, includeTrash, isDraft, includeDrafts,
    });
  }

  async getMessageContent(messageId: string) {
    const accessToken = await this.token();
    const message = await invoke<MailMessage>('mail_get_message_content', { accessToken, itemId: messageId });
    return {
      body_html: message.body_html,
      body_text: message.body_text,
      ics_mime: message.ics_mime,
      attachments: message.attachments,
      has_attachments: message.has_attachments,
    };
  }

  async getRawMessageSource(itemId: string): Promise<string> {
    const accessToken = await this.token();
    return invoke<string>('mail_get_raw_message', { accessToken, itemId });
  }

  async importRawMessage(rawMessage: string, folderId: string): Promise<void> {
    const accessToken = await this.token();
    return invoke<void>('mail_import_raw_message', { accessToken, rawMessage, folderId });
  }

  async listFolders(): Promise<MailFolder[]> {
    const accessToken = await this.token();
    return invoke<MailFolder[]>('mail_list_folders', { accessToken });
  }

  async sendMail({ to, cc, bcc, subject, bodyHtml, replyToItemId, replyToChangeKey, isForward, attachments, sendAt }: SendMailParams): Promise<void> {
    const accessToken = await this.token();
    const { html: processedHtml, inlineImages } = extractInlineImages(bodyHtml);
    return invoke('mail_send', {
      accessToken, to, cc: cc ?? [], bcc: bcc ?? [], subject,
      bodyHtml: processedHtml,
      replyToItemId, replyToChangeKey,
      isForward: isForward ?? false,
      attachments: [...inlineImages, ...(attachments ?? [])],
      sendAt,
    });
  }

  async markRead(items: MailItemRef[]): Promise<void> {
    const accessToken = await this.token();
    return invoke('mail_mark_read', { accessToken, items });
  }

  async markUnread(items: MailItemRef[]): Promise<void> {
    const accessToken = await this.token();
    return invoke('mail_mark_unread', { accessToken, items });
  }

  async moveToTrash(itemId: string): Promise<void> {
    const accessToken = await this.token();
    return invoke('mail_move_to_trash', { accessToken, itemId });
  }

  async permanentlyDelete(itemId: string): Promise<void> {
    const accessToken = await this.token();
    return invoke('mail_permanently_delete', { accessToken, itemId });
  }

  private async collectItemIds(conversationIds: string[], includeTrash = false): Promise<string[]> {
    const CONCURRENCY = 5;
    const itemIds: string[] = [];
    for (let i = 0; i < conversationIds.length; i += CONCURRENCY) {
      const batch = conversationIds.slice(i, i + CONCURRENCY);
      const batchMsgs = await Promise.all(
        batch.map(id => this.getThread(id, includeTrash).catch(() => [])),
      );
      for (const msgs of batchMsgs) itemIds.push(...msgs.map(m => m.item_id));
    }
    return itemIds;
  }

  async bulkMoveToTrash(conversationIds: string[]): Promise<void> {
    if (!conversationIds.length) return;
    const accessToken = await this.token();
    const itemIds = await this.collectItemIds(conversationIds);
    if (!itemIds.length) return;
    return invoke('mail_bulk_move_to_trash', { accessToken, itemIds });
  }

  async bulkPermanentlyDelete(conversationIds: string[]): Promise<void> {
    if (!conversationIds.length) return;
    const accessToken = await this.token();
    const itemIds = await this.collectItemIds(conversationIds, true);
    if (!itemIds.length) return;
    return invoke('mail_bulk_permanently_delete', { accessToken, itemIds });
  }

  async bulkMoveToFolder(conversationIds: string[], folderId: string): Promise<void> {
    if (!conversationIds.length) return;
    const accessToken = await this.token();
    const itemIds = await this.collectItemIds(conversationIds);
    if (!itemIds.length) return;
    return invoke('mail_bulk_move_to_folder', { accessToken, itemIds, folderId });
  }

  async openAttachment(attachment: MailAttachment): Promise<void> {
    const data = await this.getAttachmentData(attachment);
    fileService.downloadBase64(attachment.name, data, attachment.content_type);
  }

  async getAttachmentData(attachment: MailAttachment): Promise<string> {
    const accessToken = await this.token();
    return invoke<string>('mail_get_attachment_data', {
      accessToken,
      attachmentId: attachment.attachment_id,
    });
  }

  async saveDraft({ to, cc, bcc, subject, bodyHtml }: SaveDraftParams): Promise<string> {
    const accessToken = await this.token();
    return invoke<string>('mail_save_draft', {
      accessToken, to, cc: cc ?? [], bcc: bcc ?? [], subject, bodyHtml,
    });
  }

  async findOrCreateSnoozedFolder(): Promise<string> {
    const accessToken = await this.token();
    return invoke<string>('mail_find_or_create_snoozed_folder', { accessToken });
  }

  async moveToFolder(itemId: string, folderId: string): Promise<void> {
    const accessToken = await this.token();
    return invoke('mail_move_to_folder', { accessToken, itemId, folderId });
  }

  async snooze(itemId: string): Promise<string> {
    const accessToken = await this.token();
    return invoke<string>('mail_snooze', { accessToken, itemId });
  }

  async getInboxUnread(): Promise<number> {
    const accessToken = await this.token();
    return invoke<number>('mail_get_inbox_unread', { accessToken });
  }

  async searchContacts(query: string, maxCount?: number): Promise<Contact[]> {
    const accessToken = await this.token();
    return invoke<Contact[]>('mail_search_contacts', { accessToken, query, maxCount: maxCount ?? 25 });
  }

  async getContactPhoto(email: string): Promise<string | null> {
    const accessToken = await this.token();
    return invoke<string | null>('mail_get_contact_photo', { accessToken, email });
  }

  async backfillContacts(folder: string, offset: number, maxCount: number): Promise<ContactBackfillBatch> {
    const accessToken = await this.token();
    return invoke<ContactBackfillBatch>('mail_backfill_contacts', {
      accessToken, folder, offset, maxCount, userEmail: this.userEmail,
    });
  }
}
