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
  /** Set when loaded in All-accounts mode to route actions to the correct provider. */
  accountId?: string;
  /** Display label for the account badge (domain part of email). Only set in All-accounts mode. */
  accountLabel?: string;
  /** Account color for the badge. Only set in All-accounts mode. */
  accountColor?: string;
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
  /** ICS text extracted from a text/calendar MIME part (Teams invitations, etc.) */
  ics_mime?: string;
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
