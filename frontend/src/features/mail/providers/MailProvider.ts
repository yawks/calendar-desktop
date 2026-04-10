import type { MailAttachment, MailFolder, MailMessage, MailThread } from '../types';

export type ProviderType = 'ews' | 'gmail';

export interface MailItemRef {
  item_id: string;
  change_key: string;
}

export interface SendMailParams {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyHtml: string;
  replyToItemId?: string | null;
  replyToChangeKey?: string | null;
}

/**
 * Abstraction over any mail backend (EWS, Gmail, …).
 * Add a new implementation to support additional providers without touching the UI.
 */
export interface MailProvider {
  readonly providerType: ProviderType;
  readonly accountId: string;

  listThreads(folder: string, maxCount?: number, offset?: number): Promise<MailThread[]>;
  getThread(conversationId: string, includeTrash?: boolean): Promise<MailMessage[]>;
  listFolders(): Promise<MailFolder[]>;
  sendMail(params: SendMailParams): Promise<void>;
  markRead(items: MailItemRef[]): Promise<void>;
  markUnread(items: MailItemRef[]): Promise<void>;
  moveToTrash(itemId: string): Promise<void>;
  permanentlyDelete(itemId: string): Promise<void>;
  openAttachment(attachment: MailAttachment): Promise<void>;
  findOrCreateSnoozedFolder(): Promise<string>;
  moveToFolder(itemId: string, folderId: string): Promise<void>;
  snooze(itemId: string): Promise<string>;
  getInboxUnread(): Promise<number>;
}
