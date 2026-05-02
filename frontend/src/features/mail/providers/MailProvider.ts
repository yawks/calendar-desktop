import type { MailAttachment, MailFolder, MailIdentity, MailMessage, MailSearchQuery, MailThread } from '../types';

export type ProviderType = 'ews' | 'gmail' | 'imap' | 'jmap';

export interface MailItemRef {
  item_id: string;
  change_key: string;
  conversation_id?: string;
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
  isForward?: boolean;
  attachments?: ComposerAttachment[];
  fromIdentityId?: string;
  /** RFC 5322 In-Reply-To value (Message-ID of the parent, with angle brackets). */
  inReplyTo?: string;
  /** RFC 5322 References value (space-separated chain of Message-IDs). */
  references?: string;
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
  getThread(conversationId: string, includeTrash?: boolean, isDraft?: boolean, includeDrafts?: boolean): Promise<MailMessage[]>;
  listFolders(): Promise<MailFolder[]>;
  sendMail(params: SendMailParams): Promise<void>;
  markRead(items: MailItemRef[]): Promise<void>;
  markUnread(items: MailItemRef[]): Promise<void>;
  moveToTrash(itemId: string): Promise<void>;
  permanentlyDelete(itemId: string): Promise<void>;
  /** Batch trash — prefer over N individual moveToTrash calls to avoid rate-limits. */
  bulkMoveToTrash(conversationIds: string[]): Promise<void>;
  /** Batch permanent delete — prefer over N individual permanentlyDelete calls. */
  bulkPermanentlyDelete(conversationIds: string[]): Promise<void>;
  /** Batch folder move — prefer over N individual moveToFolder calls. */
  bulkMoveToFolder(conversationIds: string[], folderId: string): Promise<void>;
  openAttachment(attachment: MailAttachment): Promise<void>;
  /** Return the attachment content as a standard base64 string (for in-app preview / download). */
  getAttachmentData(attachment: MailAttachment): Promise<string>;
  saveDraft(params: SaveDraftParams): Promise<string>;
  readonly supportsSnooze: boolean;
  findOrCreateSnoozedFolder?(): Promise<string>;
  moveToFolder(itemId: string, folderId: string): Promise<void>;
  snooze?(itemId: string): Promise<string>;
  getInboxUnread(): Promise<number>;
  listIdentities?(): Promise<MailIdentity[]>;
}
