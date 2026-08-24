import { mailCommand as invoke } from '../../../shared/api/mailApi';
import { fileService } from '../../../shared/services/fileService';
import { JmapAccount } from '../../../shared/types';
import { MailAttachment, MailFolder, MailIdentity, MailMessage, MailSearchQuery, MailThread } from '../types';
import { MailProvider, MailItemRef, SendMailParams, SaveDraftParams, ScheduledSendInfo } from './MailProvider';

export class JmapMailProvider implements MailProvider {
  readonly providerType = 'jmap';
  // Standard JMAP tokens cannot access Fastmail's private dev/mail snooze API.
  readonly capabilities = { snooze: false, scheduledSend: { supported: false } } as const;

  async getCapabilities() {
    return invoke<import('./MailProvider').MailProviderCapabilities>('jmap_get_capabilities', {
      config: this.rustConfig,
    });
  }
  readonly accountId: string;
  private readonly config: JmapAccount;

  constructor(account: JmapAccount) {
    this.accountId = account.id;
    this.config = account;
  }

  private get rustConfig() {
    return {
      email: this.config.email,
      session_url: this.config.sessionUrl,
      token: this.config.token,
      auth_type: this.config.authType ?? 'bearer',
      fastmail_token: this.config.fastmailToken ?? null,
      fastmail_cookie: this.config.fastmailCookie ?? null,
    };
  }

  async listThreads(folder: string, maxCount?: number, offset = 0): Promise<MailThread[]> {
    return invoke<MailThread[]>('jmap_list_threads', {
      config: this.rustConfig,
      folder,
      maxCount,
      offset,
    });
  }

  async getThreadCount(folder: string): Promise<number> {
    return invoke<number>('jmap_get_thread_count', {
      config: this.rustConfig,
      folder,
    });
  }

  async getThreadSnippet(conversationId: string): Promise<string> {
    return invoke<string>('jmap_get_thread_snippet', {
      config: this.rustConfig,
      conversationId,
    });
  }

  async searchThreads(query: MailSearchQuery, maxCount?: number): Promise<MailThread[]> {
    return invoke<MailThread[]>('jmap_search_threads', {
      config: this.rustConfig,
      query,
      maxCount,
    });
  }

  async getThread(conversationId: string): Promise<MailMessage[]> {
    const messages = await invoke<MailMessage[]>('jmap_get_thread', {
      config: this.rustConfig,
      conversationId,
    });
    return messages.map(message => ({ ...message, body_loaded: false }));
  }

  async getMessageContent(messageId: string, conversationId?: string) {
    let message: MailMessage;
    try {
      message = await invoke<MailMessage>('jmap_get_message_content', {
        config: this.rustConfig,
        messageId,
        conversationId: conversationId ?? null,
      });
    } catch (error) {
      console.error('[JMAP.getMessageContent]', { messageId, error });
      const describeId = (id?: string) => id
        ? `${id.slice(0, 4)}…${id.slice(-4)} (${id.length})`
        : 'absent';
      throw new Error(
        `JMAP [message=${describeId(messageId)}, thread=${describeId(conversationId)}]: ` +
        `${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return {
      body_html: message.body_html,
      body_text: message.body_text,
      ics_mime: message.ics_mime,
      attachments: message.attachments,
      has_attachments: message.has_attachments,
    };
  }

  async getRawMessageSource(itemId: string): Promise<string> {
    return invoke<string>('jmap_get_raw_message', {
      config: this.rustConfig,
      itemId,
    });
  }

  async importRawMessage(rawMessage: string, folderId: string): Promise<void> {
    return invoke<void>('jmap_import_raw_message', {
      config: this.rustConfig,
      rawMessage,
      folderId,
    });
  }

  async listFolders(): Promise<MailFolder[]> {
    return invoke<MailFolder[]>('jmap_list_folders', {
      config: this.rustConfig,
    });
  }

  async listIdentities(): Promise<MailIdentity[]> {
    const raw = await invoke<Array<{ id: string; name: string; email: string; may_delete: boolean }>>('jmap_list_identities', {
      config: this.rustConfig,
    });
    return raw.map(i => ({ id: i.id, name: i.name, email: i.email, mayDelete: i.may_delete }));
  }

  async sendMail(params: SendMailParams): Promise<void> {
    await invoke('jmap_send', {
      config: this.rustConfig,
      to: params.to,
      cc: params.cc ?? [],
      bcc: params.bcc ?? [],
      subject: params.subject,
      bodyHtml: params.bodyHtml,
      attachments: params.attachments ?? [],
      identityId: params.fromIdentityId ?? null,
      inReplyTo: params.inReplyTo ?? null,
      references: params.references ?? null,
      sendAt: params.sendAt ?? null,
    });
  }

  async getScheduledSend(emailId: string): Promise<ScheduledSendInfo | null> {
    return invoke<ScheduledSendInfo | null>('jmap_get_scheduled_send', {
      config: this.rustConfig,
      emailId,
    });
  }

  async cancelScheduledSend(submissionId: string): Promise<void> {
    await invoke('jmap_cancel_scheduled_send', {
      config: this.rustConfig,
      submissionId,
    });
  }

  async markRead(items: MailItemRef[]): Promise<void> {
    await invoke('jmap_mark_read', {
      config: this.rustConfig,
      ids: items.map((i) => i.item_id),
    });
  }

  async markUnread(items: MailItemRef[]): Promise<void> {
    await invoke('jmap_mark_unread', {
      config: this.rustConfig,
      ids: items.map((i) => i.item_id),
    });
  }

  async moveToTrash(itemId: string): Promise<void> {
    await invoke('jmap_move_to_trash', {
      config: this.rustConfig,
      id: itemId,
    });
  }

  async permanentlyDelete(itemId: string): Promise<void> {
    await invoke('jmap_permanently_delete', {
      config: this.rustConfig,
      id: itemId,
    });
  }

  async bulkMoveToTrash(conversationIds: string[]): Promise<void> {
    if (!conversationIds.length) return;
    await invoke('jmap_bulk_move_to_trash', { config: this.rustConfig, threadIds: conversationIds });
  }

  async bulkPermanentlyDelete(conversationIds: string[]): Promise<void> {
    if (!conversationIds.length) return;
    await invoke('jmap_bulk_permanently_delete', { config: this.rustConfig, threadIds: conversationIds });
  }

  async bulkMoveToFolder(conversationIds: string[], folderId: string): Promise<void> {
    if (!conversationIds.length) return;
    await invoke('jmap_bulk_move_to_folder', { config: this.rustConfig, threadIds: conversationIds, folderId });
  }

  async openAttachment(attachment: MailAttachment): Promise<void> {
    const data = await this.getAttachmentData(attachment);
    fileService.downloadBase64(attachment.name, data, attachment.content_type);
  }

  async getAttachmentData(attachment: MailAttachment): Promise<string> {
    return invoke<string>('jmap_get_attachment_data', {
      config: this.rustConfig,
      blobId: attachment.attachment_id,
    });
  }

  async saveDraft(_params: SaveDraftParams): Promise<string> {
    // Not yet implemented on backend
    return '';
  }

  async findOrCreateSnoozedFolder(): Promise<string> {
    return invoke<string>('jmap_find_or_create_snoozed_folder', { config: this.rustConfig });
  }

  async moveToFolder(itemId: string, folderId: string): Promise<void> {
    await invoke('jmap_move_to_folder', {
      config: this.rustConfig,
      id: itemId,
      folderId,
    });
  }

  async snooze(itemId: string, until?: string): Promise<string> {
    return invoke<string>('jmap_snooze', { config: this.rustConfig, id: itemId, until });
  }

  async getInboxUnread(): Promise<number> {
    return invoke<number>('jmap_get_inbox_unread', {
      config: this.rustConfig,
    });
  }
}
