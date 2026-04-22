import { invoke } from '@tauri-apps/api/core';
import { JmapAccount } from '../../../shared/types';
import { MailAttachment, MailFolder, MailIdentity, MailMessage, MailSearchQuery, MailThread } from '../types';
import { MailProvider, MailItemRef, SendMailParams, SaveDraftParams } from './MailProvider';

export class JmapMailProvider implements MailProvider {
  readonly providerType = 'jmap';
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
    };
  }

  async listThreads(folder: string, maxCount?: number): Promise<MailThread[]> {
    return invoke<MailThread[]>('jmap_list_threads', {
      config: this.rustConfig,
      folder,
      maxCount,
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
    return invoke<MailMessage[]>('jmap_get_thread', {
      config: this.rustConfig,
      conversationId,
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
      identityId: params.fromIdentityId ?? null,
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

  async openAttachment(attachment: MailAttachment): Promise<void> {
    const data = await this.getAttachmentData(attachment);
    await invoke('open_file_path', {
      path: await invoke('save_file_to_downloads', {
        filename: attachment.name,
        data,
      }),
    });
  }

  async getAttachmentData(attachment: MailAttachment): Promise<string> {
    return invoke<string>('jmap_get_attachment_data', {
      config: this.rustConfig,
      blobId: attachment.attachment_id,
    });
  }

  async saveDraft(_params: SaveDraftParams): Promise<void> {
      // Not yet implemented on backend
  }

  async findOrCreateSnoozedFolder(): Promise<string> {
    return 'snoozed';
  }

  async moveToFolder(_itemId: string, _folderId: string): Promise<void> {
      // Not yet implemented on backend
  }

  async snooze(_itemId: string): Promise<string> {
    return 'snoozed';
  }

  async getInboxUnread(): Promise<number> {
    return invoke<number>('jmap_get_inbox_unread', {
      config: this.rustConfig,
    });
  }
}
