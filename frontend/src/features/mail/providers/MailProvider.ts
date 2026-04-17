import type { MailAttachment, MailFolder, MailMessage, MailSearchQuery, MailThread } from '../types';

export type ProviderType = 'ews' | 'gmail' | 'imap' | 'jmap';

export interface MailItemRef {
  item_id: string;
  change_key: string;
}

/** A file attached by the user in the composer, ready to be sent. */
export interface ComposerAttachment {
  name: string;
  contentType: string;
  size: number;
  /** Base64-encoded file content (no data URL prefix). */
  data: string;
}

export interface SendMailParams {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyHtml: string;
  replyToItemId?: string | null;
  replyToChangeKey?: string | null;
  attachments?: ComposerAttachment[];
}

export interface SaveDraftParams {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyHtml: string;
}

/**
 * Abstraction over any mail backend (EWS, Gmail, …).
 * Add a new implementation to support additional providers without touching the UI.
 */
export interface MailProvider {
  readonly providerType: ProviderType;
  readonly accountId: string;

  listThreads(folder: string, maxCount?: number, offset?: number): Promise<MailThread[]>;
  /** Search threads using a structured query. Results are not cached. */
  searchThreads(query: MailSearchQuery, maxCount?: number): Promise<MailThread[]>;
  /** Force a network fetch for inbox, bypassing any local cache. Optional — only implemented by CachedMailProvider. */
  forceRefreshInbox?(maxCount?: number): Promise<MailThread[]>;
  getThread(conversationId: string, includeTrash?: boolean, isDraft?: boolean): Promise<MailMessage[]>;
  listFolders(): Promise<MailFolder[]>;
  sendMail(params: SendMailParams): Promise<void>;
  markRead(items: MailItemRef[]): Promise<void>;
  markUnread(items: MailItemRef[]): Promise<void>;
  moveToTrash(itemId: string): Promise<void>;
  permanentlyDelete(itemId: string): Promise<void>;
  openAttachment(attachment: MailAttachment): Promise<void>;
  /** Return the attachment content as a standard base64 string (for in-app preview / download). */
  getAttachmentData(attachment: MailAttachment): Promise<string>;
  saveDraft(params: SaveDraftParams): Promise<void>;
  findOrCreateSnoozedFolder(): Promise<string>;
  moveToFolder(itemId: string, folderId: string): Promise<void>;
  snooze(itemId: string): Promise<string>;
  getInboxUnread(): Promise<number>;
}
