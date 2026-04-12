import { invoke } from '@tauri-apps/api/core';

import type { MailAttachment, MailFolder, MailMessage, MailThread } from '../types';
import type { MailItemRef, MailProvider, SaveDraftParams, SendMailParams } from './MailProvider';

/**
 * EWS (Exchange Web Services) implementation of MailProvider.
 * Handles token acquisition internally — callers never touch access tokens.
 */
export class EwsMailProvider implements MailProvider {
  readonly providerType = 'ews' as const;
  readonly accountId: string;

  private readonly getValidToken: (id: string) => Promise<string | null>;

  constructor(accountId: string, getValidToken: (id: string) => Promise<string | null>) {
    this.accountId = accountId;
    this.getValidToken = getValidToken;
  }

  private async token(): Promise<string> {
    const t = await this.getValidToken(this.accountId);
    if (!t) throw new Error('No valid EWS token — please reconnect your Exchange account.');
    return t;
  }

  async listThreads(folder: string, maxCount = 50, offset = 0): Promise<MailThread[]> {
    const accessToken = await this.token();
    return invoke<MailThread[]>('mail_list_threads', { accessToken, folder, maxCount, offset });
  }

  async getThread(conversationId: string, includeTrash = false, isDraft = false): Promise<MailMessage[]> {
    const accessToken = await this.token();
    return invoke<MailMessage[]>('mail_get_thread', { accessToken, conversationId, includeTrash, isDraft });
  }

  async listFolders(): Promise<MailFolder[]> {
    const accessToken = await this.token();
    return invoke<MailFolder[]>('mail_list_folders', { accessToken });
  }

  async sendMail({ to, cc, bcc, subject, bodyHtml, replyToItemId, replyToChangeKey, attachments }: SendMailParams): Promise<void> {
    const accessToken = await this.token();
    return invoke('mail_send', {
      accessToken, to, cc: cc ?? [], bcc: bcc ?? [], subject, bodyHtml,
      replyToItemId, replyToChangeKey,
      attachments: attachments ?? [],
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

  async openAttachment(attachment: MailAttachment): Promise<void> {
    const accessToken = await this.token();
    return invoke('mail_open_attachment', {
      accessToken,
      attachmentId: attachment.attachment_id,
      filename: attachment.name,
    });
  }

  async getAttachmentData(attachment: MailAttachment): Promise<string> {
    const accessToken = await this.token();
    return invoke<string>('mail_get_attachment_data', {
      accessToken,
      attachmentId: attachment.attachment_id,
    });
  }

  async saveDraft({ to, cc, bcc, subject, bodyHtml }: SaveDraftParams): Promise<void> {
    const accessToken = await this.token();
    return invoke('mail_save_draft', {
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
}
