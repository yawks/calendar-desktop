import { invoke } from '@tauri-apps/api/core';
import { ImapAccount } from '../../../shared/types';
import { MailAttachment, MailFolder, MailMessage, MailSearchQuery, MailThread } from '../types';
import { MailProvider, ProviderType, SendMailParams, SaveDraftParams, MailItemRef } from './MailProvider';

export class ImapMailProvider implements MailProvider {
  readonly providerType: ProviderType = 'imap' as ProviderType;
  readonly accountId: string;
  private config: ImapAccount;
  private folderMapping: Record<string, string> = {};

  constructor(config: ImapAccount) {
    this.accountId = config.id;
    this.config = config;
  }

  private resolveFolder(folder: string): string {
    const staticMap: Record<string, string> = {
      inbox: 'INBOX',
      drafts: 'Drafts',
      sentitems: 'Sent',
      deleteditems: 'Trash',
      spam: 'Junk',
    };

    const key = folder.toLowerCase();
    // Return the mapped folder if found, otherwise return the original (handles dynamic folders)
    return this.folderMapping[key] || staticMap[key] || folder;
  }

  private getBackendConfig() {
    return {
      email: this.config.email,
      imap_server: this.config.imapServer,
      imap_port: this.config.imapPort,
      imap_use_ssl: this.config.imapUseSsl,
      imap_use_starttls: this.config.imapUseStarttls,
      imap_username: this.config.imapUsername,
      imap_password: this.config.imapPassword,
      smtp_server: this.config.smtpServer,
      smtp_port: this.config.smtpPort,
      smtp_use_ssl: this.config.smtpUseSsl,
      smtp_use_starttls: this.config.smtpUseStarttls,
      smtp_username: this.config.smtpUsername,
      smtp_password: this.config.smtpPassword,
    };
  }

  async listThreads(folder: string, maxCount?: number, _offset?: number): Promise<MailThread[]> {
    const targetFolder = this.resolveFolder(folder);
    const threads = await invoke<MailThread[]>('imap_list_threads', {
      config: this.getBackendConfig(),
      folder: targetFolder,
      maxCount,
    });
    // For IMAP, we encode the folder in the conversation_id because UIDs are folder-specific
    return threads.map(t => ({
      ...t,
      conversation_id: `${targetFolder}:${t.conversation_id}`
    }));
  }

  async searchThreads(query: MailSearchQuery, maxCount?: number): Promise<MailThread[]> {
    return this.listThreads(query.folder || 'INBOX', maxCount);
  }

  async getThread(conversationId: string, _includeTrash?: boolean, _isDraft?: boolean): Promise<MailMessage[]> {
    const [folder, uid] = conversationId.split(':');
    const targetFolder = folder || 'INBOX';
    const messages = await invoke<MailMessage[]>('imap_get_thread', {
      config: this.getBackendConfig(),
      conversationId: uid,
      folder: targetFolder,
    });
    return messages.map(m => ({
      ...m,
      item_id: `${targetFolder}:${m.item_id}`
    }));
  }

  async listFolders(): Promise<MailFolder[]> {
    const folders = await invoke<MailFolder[]>('imap_list_folders', {
      config: this.getBackendConfig(),
    });

    // Update mapping based on common folder names if they are not already mapped
    for (const f of folders) {
      const lower = f.display_name.toLowerCase();
      if (lower === 'inbox') this.folderMapping['inbox'] = f.folder_id;
      else if (lower.includes('sent') || lower.includes('envoyé')) this.folderMapping['sentitems'] = f.folder_id;
      else if (lower.includes('trash') || lower.includes('corbeille') || lower.includes('supprimé')) this.folderMapping['deleteditems'] = f.folder_id;
      else if (lower.includes('draft') || lower.includes('brouillon')) this.folderMapping['drafts'] = f.folder_id;
      else if (lower.includes('junk') || lower.includes('spam') || lower.includes('indésirable')) this.folderMapping['spam'] = f.folder_id;
    }

    return folders;
  }

  async sendMail(params: SendMailParams): Promise<void> {
    return invoke<void>('imap_send', {
      config: this.getBackendConfig(),
      to: params.to,
      cc: params.cc || [],
      bcc: params.bcc || [],
      subject: params.subject,
      bodyHtml: params.bodyHtml,
      attachments: params.attachments,
    });
  }

  async markRead(items: MailItemRef[]): Promise<void> {
    const byFolder = this.groupByFolder(items);
    for (const [folder, ids] of byFolder.entries()) {
      await invoke<void>('imap_mark_read', {
        config: this.getBackendConfig(),
        folder,
        ids,
      });
    }
  }

  async markUnread(items: MailItemRef[]): Promise<void> {
    const byFolder = this.groupByFolder(items);
    for (const [folder, ids] of byFolder.entries()) {
      await invoke<void>('imap_mark_unread', {
        config: this.getBackendConfig(),
        folder,
        ids,
      });
    }
  }

  private groupByFolder(items: MailItemRef[]): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const item of items) {
      const [folder, uid] = item.item_id.split(':');
      const f = folder || 'INBOX';
      if (!map.has(f)) map.set(f, []);
      map.get(f)!.push(uid);
    }
    return map;
  }

  async moveToTrash(itemId: string): Promise<void> {
    const [folder, uid] = itemId.split(':');
    return invoke<void>('imap_move_to_trash', {
      config: this.getBackendConfig(),
      folder: folder || 'INBOX',
      id: uid,
    });
  }

  async permanentlyDelete(itemId: string): Promise<void> {
    const [folder, uid] = itemId.split(':');
    return invoke<void>('imap_permanently_delete', {
      config: this.getBackendConfig(),
      folder: folder || 'INBOX',
      id: uid,
    });
  }

  async openAttachment(attachment: MailAttachment): Promise<void> {
    const data = await this.getAttachmentData(attachment);
    const path = await invoke<string>('save_file_to_downloads', { filename: attachment.name, data });
    return invoke<void>('open_file_path', { path });
  }

  async getAttachmentData(attachment: MailAttachment): Promise<string> {
    // attachment_id for IMAP is encoded as "folder:messageUid:attachmentIndex"
    const [folder, messageId, attachmentId] = attachment.attachment_id.split(':');
    return invoke<string>('imap_get_attachment_data', {
      config: this.getBackendConfig(),
      folder: folder || 'INBOX',
      messageId,
      attachmentId,
    });
  }

  async saveDraft(_params: SaveDraftParams): Promise<void> {
    // IMAP Drafts saving not implemented yet
  }

  async findOrCreateSnoozedFolder(): Promise<string> {
    return 'Snoozed';
  }

  async moveToFolder(_itemId: string, _folderId: string): Promise<void> {
    // Basic move logic would go here
  }

  async snooze(_itemId: string): Promise<string> {
    return 'Snoozed';
  }

  async getInboxUnread(): Promise<number> {
    const inbox = this.resolveFolder('inbox');
    return invoke<number>('imap_get_inbox_unread', {
      config: this.getBackendConfig(),
      folder: inbox,
    });
  }
}
