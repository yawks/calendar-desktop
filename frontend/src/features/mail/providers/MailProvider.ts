import type { MailAttachment, MailFolder, MailIdentity, MailMessage, MailSearchQuery, MailThread } from '../types';

export type ProviderType = 'ews' | 'gmail' | 'imap' | 'jmap';

/** Capabilities advertised by a mail source. UI code must consult this
 * contract instead of inferring support from the provider type. */
export interface MailProviderCapabilities {
  readonly snooze: boolean;
  readonly scheduledSend: {
    readonly supported: boolean;
    readonly maxDelaySeconds?: number;
  };
}

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
  /** True for images embedded inline in the HTML body (referenced via CID). */
  isInline?: boolean;
  /** Content-ID for inline images (without angle brackets), matches src="cid:…" in the HTML. */
  contentId?: string;
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
  /** Server-side delivery date (ISO 8601). Omit for immediate delivery. */
  sendAt?: string;
}

export interface SaveDraftParams {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyHtml: string;
}

export interface Contact {
  email: string;
  name?: string;
  source?: 'google-contact' | 'google-other-contact' | 'ews-contact' | 'ews-directory' | 'mail' | 'calendar';
}

export interface ContactBackfillBatch {
  observations: Array<{
    email: string;
    displayName?: string;
    kind: 'received' | 'sent';
    occurredAt: number;
    eventId: string;
  }>;
  itemCount: number;
  oldestAt?: number;
}

/**
 * Abstraction over any mail backend (EWS, Gmail, …).
 * Add a new implementation to support additional providers without touching the UI.
 */
export interface MailProvider {
  readonly providerType: ProviderType;
  readonly accountId: string;
  readonly capabilities: MailProviderCapabilities;
  /** Resolve account/server-dependent capabilities (notably JMAP limits). */
  getCapabilities?(): Promise<MailProviderCapabilities>;

  listThreads(folder: string, maxCount?: number, offset?: number): Promise<MailThread[]>;
  /** Total number of conversations in a folder, when the protocol exposes it. */
  getThreadCount?(folder: string): Promise<number>;
  /** Load a preview lazily when listThreads intentionally omits it. */
  getThreadSnippet?(conversationId: string): Promise<string>;
  /** Search threads using a structured query. Results are not cached. */
  searchThreads(query: MailSearchQuery, maxCount?: number): Promise<MailThread[]>;
  getThread(conversationId: string, includeTrash?: boolean, isDraft?: boolean, includeDrafts?: boolean): Promise<MailMessage[]>;
  /** Lazily load a single message body. Providers may omit this when getThread already returns bodies. */
  getMessageContent?(messageId: string, conversationId?: string): Promise<Pick<MailMessage, 'body_html' | 'body_text' | 'ics_mime' | 'attachments' | 'has_attachments'>>;
  /** Return the original RFC 5322/MIME source when supported by the provider. */
  getRawMessageSource?(itemId: string): Promise<string>;
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
  findOrCreateSnoozedFolder?(): Promise<string>;
  moveToFolder(itemId: string, folderId: string): Promise<void>;
  snooze?(itemId: string, until?: string): Promise<string>;
  getInboxUnread(): Promise<number>;
  listIdentities?(): Promise<MailIdentity[]>;
  searchContacts?(query: string, maxCount?: number): Promise<Contact[]>;
  /** Returns the contact photo as a base64 string (no data-URL prefix), or null if unavailable. */
  getContactPhoto?(email: string): Promise<string | null>;
  /** Efficient provider-native metadata scan used by the persistent contact index. */
  backfillContacts?(folder: string, offset: number, maxCount: number): Promise<ContactBackfillBatch>;
}
