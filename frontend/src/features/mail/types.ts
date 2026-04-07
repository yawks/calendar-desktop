// ── Mail domain types ──────────────────────────────────────────────────────────

export interface MailThread {
  conversation_id: string;
  topic: string;
  snippet: string;
  last_delivery_time: string;
  message_count: number;
  unread_count: number;
  from_name: string | null;
  has_attachments: boolean;
}

export interface MailMessage {
  item_id: string;
  change_key: string;
  subject: string;
  from_name: string | null;
  from_email: string | null;
  to_recipients: MailRecipient[];
  cc_recipients: MailRecipient[];
  body_html: string;
  date_time_received: string;
  is_read: boolean;
  has_attachments: boolean;
  attachments: MailAttachment[];
  /** Optional — not yet returned by the EWS backend */
  size?: number;
}

export interface MailRecipient {
  name: string | null;
  email: string;
}

export interface MailAttachment {
  attachment_id: string;
  name: string;
  content_type: string;
  size: number;
  is_inline: boolean;
}

/** Distinguished folder IDs or an arbitrary EWS FolderId for dynamic folders. */
export type Folder = string;

export interface MailFolder {
  folder_id: string;
  display_name: string;
  total_count: number;
  unread_count: number;
}
