import { invoke } from '@tauri-apps/api/core';

import type { MailAttachment, MailFolder, MailIdentity, MailMessage, MailRecipient, MailSearchQuery, MailThread } from '../types';
import type { Contact, MailItemRef, MailProvider, SaveDraftParams, SendMailParams } from './MailProvider';

// ── Gmail REST API types ──────────────────────────────────────────────────────

interface GmailLabel {
  id: string;
  name: string;
  type: 'system' | 'user';
}

interface GmailLabelDetail extends GmailLabel {
  messagesTotal?: number;
  messagesUnread?: number;
}

interface GmailThread {
  id: string;
  historyId?: string;
  messages?: GmailMessage[];
  snippet?: string;
}

interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string; // ms since epoch as a string
  payload?: GmailMessagePart;
  sizeEstimate?: number;
}

interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailMessagePart[];
}

// ── Folder / label mapping ────────────────────────────────────────────────────

const FOLDER_TO_LABEL: Record<string, string> = {
  inbox: 'INBOX',
  sentitems: 'SENT',
  deleteditems: 'TRASH',
  spam: 'SPAM',
  drafts: 'DRAFT',
};

function folderToLabel(folder: string): string | null {
  if (FOLDER_TO_LABEL[folder]) return FOLDER_TO_LABEL[folder];
  // Google user-label IDs are generated as Label_… . Do not forward arbitrary
  // dynamic folder IDs from EWS/JMAP while switching sources in the unified view.
  return folder.startsWith('Label_') ? folder : null;
}

// ── Parsing helpers ───────────────────────────────────────────────────────────

function getHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function parseFrom(raw: string): { name: string | null; email: string } {
  const m = raw.match(/^(.+?)\s*<([^>]+)>$/);
  if (m) return { name: m[1].trim().replace(/^"|"$/g, '') || null, email: m[2].trim() };
  return { name: null, email: raw.trim() };
}

function parseAddressList(value: string): MailRecipient[] {
  if (!value) return [];
  // Split on commas that are outside angle brackets
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '<') depth++;
    else if (ch === '>') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts.map(parseFrom).filter(r => r.email);
}

function msToIso(ms: string): string {
  const n = parseInt(ms, 10);
  return isNaN(n) ? new Date().toISOString() : new Date(n).toISOString();
}

function decodeBase64Url(encoded: string): string {
  const standard = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = standard + '=='.slice(0, (4 - (standard.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  bytes.forEach(b => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function extractBody(part: GmailMessagePart): string {
  if (part.mimeType === 'text/html' && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }
  if (part.mimeType === 'text/plain' && part.body?.data) {
    const text = decodeBase64Url(part.body.data);
    return `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(text)}</pre>`;
  }
  if (part.parts) {
    // Prefer text/html in multipart
    const htmlPart = part.parts.find(p => p.mimeType === 'text/html');
    if (htmlPart) return extractBody(htmlPart);
    const textPart = part.parts.find(p => p.mimeType === 'text/plain');
    if (textPart) return extractBody(textPart);
    // Recurse into nested multipart/alternative, multipart/related, etc.
    for (const sub of part.parts) {
      const body = extractBody(sub);
      if (body) return body;
    }
  }
  return '';
}

function hasAttachmentParts(part?: GmailMessagePart): boolean {
  if (!part) return false;
  if (part.filename && part.body?.attachmentId) return true;
  return part.parts?.some(hasAttachmentParts) ?? false;
}

function extractAttachments(messageId: string, part: GmailMessagePart): MailAttachment[] {
  const result: MailAttachment[] = [];
  if (part.filename && part.body?.attachmentId) {
    const isInline = part.headers?.some(
      h => h.name.toLowerCase() === 'content-disposition' && h.value.startsWith('inline')
    ) ?? false;
    result.push({
      // Encode as "messageId:attachmentId" so openAttachment can split them
      attachment_id: `${messageId}:${part.body.attachmentId}`,
      name: part.filename,
      content_type: part.mimeType ?? 'application/octet-stream',
      size: part.body.size ?? 0,
      is_inline: isInline,
    });
  }
  for (const sub of part.parts ?? []) {
    result.push(...extractAttachments(messageId, sub));
  }
  return result;
}

interface InlineImageRef {
  /** Content-Id value without angle brackets, e.g. "image001.jpg@01D..." */
  contentId: string;
  contentType: string;
  /** base64url-encoded data when included directly in the Gmail response */
  data?: string;
  /** Gmail attachment ID when data must be fetched separately */
  attachmentId?: string;
}

/** Recursively collect all MIME parts that carry a Content-Id (inline images). */
function collectInlineImageParts(part: GmailMessagePart, result: InlineImageRef[]): void {
  const contentIdHeader = part.headers?.find(h => h.name.toLowerCase() === 'content-id')?.value;
  if (contentIdHeader && part.body && part.mimeType?.startsWith('image/')) {
    const contentId = contentIdHeader.replace(/^<|>$/g, ''); // strip angle brackets
    if (part.body.data) {
      result.push({ contentId, contentType: part.mimeType, data: part.body.data });
    } else if (part.body.attachmentId) {
      result.push({ contentId, contentType: part.mimeType, attachmentId: part.body.attachmentId });
    }
  }
  for (const sub of part.parts ?? []) {
    collectInlineImageParts(sub, result);
  }
}

/** Convert base64url to standard base64. */
function base64UrlToStandard(s: string): string {
  return s.replace(/-/g, '+').replace(/_/g, '/');
}

/**
 * Replace src="" / bare src / src="cid:xxx" references in the HTML body
 * with data URIs fetched from the Gmail message parts.
 */
async function injectGmailInlineImages(
  token: string,
  messageId: string,
  bodyHtml: string,
  payload: GmailMessagePart,
  gFetch: <T>(token: string, path: string) => Promise<T>,
): Promise<string> {
  const refs: InlineImageRef[] = [];
  collectInlineImageParts(payload, refs);
  if (refs.length === 0) return bodyHtml;

  let html = bodyHtml;
  const unresolved: Array<{ contentType: string; base64: string }> = [];

  for (const ref of refs) {
    let base64url: string;
    if (ref.data) {
      base64url = ref.data;
    } else if (ref.attachmentId) {
      try {
        const att = await gFetch<{ data: string }>(
          token,
          `/users/me/messages/${messageId}/attachments/${ref.attachmentId}`,
        );
        base64url = att.data;
      } catch {
        continue;
      }
    } else {
      continue;
    }

    const b64 = base64UrlToStandard(base64url);
    const dataUri = `data:${ref.contentType};base64,${b64}`;

    // Try to replace by CID reference (double or single quotes).
    const replaced = replaceCidSrc(html, ref.contentId, dataUri);
    if (replaced !== null) {
      html = replaced;
    } else {
      unresolved.push({ contentType: ref.contentType, base64: b64 });
    }
  }

  // Fallback: sequentially replace empty/bare src attributes.
  for (const { contentType, base64 } of unresolved) {
    const dataUri = `data:${contentType};base64,${base64}`;
    html = replaceNextEmptySrc(html, dataUri);
  }

  return html;
}

/** Replace src="cid:{contentId}" (or single-quoted) with src="{dataUri}". Returns null if not found. */
function replaceCidSrc(html: string, contentId: string, dataUri: string): string | null {
  const dq = `src="cid:${contentId}"`;
  if (html.includes(dq)) return html.replaceAll(dq, `src="${dataUri}"`);
  const sq = `src='cid:${contentId}'`;
  if (html.includes(sq)) return html.replaceAll(sq, `src='${dataUri}'`);
  return null;
}

/** Replace the next empty or bare src attribute in the HTML with src="{dataUri}". */
function replaceNextEmptySrc(html: string, dataUri: string): string {
  // src=""
  const dq = html.indexOf('src=""');
  if (dq !== -1) return html.slice(0, dq) + `src="${dataUri}"` + html.slice(dq + 6);
  // src=''
  const sq = html.indexOf("src=''");
  if (sq !== -1) return html.slice(0, sq) + `src='${dataUri}'` + html.slice(sq + 6);
  // bare src (not followed by =)
  let pos = 0;
  while (pos < html.length) {
    const idx = html.indexOf('src', pos);
    if (idx === -1) break;
    const afterSrc = idx + 3;
    // Must not be preceded by a word char
    const prevOk = idx === 0 || !/[\w-]/.test(html[idx - 1]);
    // Must not be followed by = (after optional whitespace)
    const rest = html.slice(afterSrc).trimStart();
    const nextOk = !rest.startsWith('=');
    if (prevOk && nextOk) {
      return html.slice(0, idx) + `src="${dataUri}"` + html.slice(afterSrc);
    }
    pos = idx + 1;
  }
  return html;
}

// ── GmailMailProvider ─────────────────────────────────────────────────────────

/**
 * Gmail implementation of MailProvider.
 * Uses the Gmail REST API directly from the frontend (same pattern as googleCalendarApi.ts).
 * The only Rust involvement is openAttachment, which needs filesystem access.
 */
export class GmailMailProvider implements MailProvider {
  readonly providerType = 'gmail' as const;
  readonly capabilities = { snooze: false, scheduledSend: false } as const;
  readonly accountId: string;
  readonly userEmail: string;

  private readonly getValidToken: (id: string) => Promise<string | null>;
  /** Page token per label — for load-more pagination. */
  private readonly nextPageTokens = new Map<string, string>();
  private contactSearchWarmup?: Promise<void>;
  private cachedIdentities?: MailIdentity[];

  constructor(accountId: string, getValidToken: (id: string) => Promise<string | null>, userEmail = '') {
    this.accountId = accountId;
    this.getValidToken = getValidToken;
    this.userEmail = userEmail.toLowerCase();
  }

  private async token(): Promise<string> {
    const t = await this.getValidToken(this.accountId);
    if (!t) throw new Error('No valid Google token — please reconnect your Google account.');
    return t;
  }

  private async gFetch<T>(token: string, path: string, options?: RequestInit): Promise<T> {
    const url = path.startsWith('http') ? path : `https://www.googleapis.com/gmail/v1${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Gmail API ${res.status}: ${body.slice(0, 300)}`);
    }
    // 204 No Content
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  private gPost<T>(token: string, path: string, body: unknown): Promise<T> {
    return this.gFetch<T>(token, path, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  // ── Identities / send-as aliases ──────────────────────────────────────────

  async listIdentities(): Promise<MailIdentity[]> {
    const token = await this.token();
    const res = await this.gFetch<{
      sendAs?: Array<{
        sendAsEmail: string;
        displayName?: string;
        isPrimary?: boolean;
        verificationStatus?: string;
      }>;
    }>(token, '/users/me/settings/sendAs');
    const identities = (res.sendAs ?? []).map(a => ({
      id: a.sendAsEmail,
      name: a.displayName || a.sendAsEmail,
      email: a.sendAsEmail,
      mayDelete: !(a.isPrimary ?? false),
    }));
    this.cachedIdentities = identities;
    return identities;
  }

  // ── Threads ────────────────────────────────────────────────────────────────

  async listThreads(folder: string, maxCount = 50, offset = 0): Promise<MailThread[]> {
    const token = await this.token();
    const label = folderToLabel(folder);
    if (!label) return [];

    // Reset page token when loading from the beginning
    if (offset === 0) this.nextPageTokens.delete(label);

    // Gmail's SNOOZED system label is not usable as a labelIds filter via the API;
    // use the search operator instead.
    const params = folder === 'snoozed'
      ? new URLSearchParams({ q: 'is:snoozed', maxResults: String(maxCount) })
      : new URLSearchParams({ labelIds: label, maxResults: String(maxCount) });
    const pageToken = this.nextPageTokens.get(label);
    if (pageToken) params.set('pageToken', pageToken);

    const res = await this.gFetch<{
      threads?: Array<{ id: string; snippet?: string }>;
      nextPageToken?: string;
    }>(token, `/users/me/threads?${params}`);

    if (res.nextPageToken) this.nextPageTokens.set(label, res.nextPageToken);
    else this.nextPageTokens.delete(label);

    if (!res.threads?.length) return [];

    // Fetch thread metadata in batches to stay within Gmail's rate limits.
    // Firing all 50 in parallel triggers 429s; 10 concurrent is safe.
    const CONCURRENCY = 10;
    const results: (MailThread | null)[] = [];
    for (let i = 0; i < res.threads.length; i += CONCURRENCY) {
      const batch = res.threads.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(t => this.fetchThreadSummary(token, t.id, t.snippet ?? ''))
      );
      results.push(...batchResults);
    }
    return results.filter((t): t is MailThread => t !== null);
  }

  async getThreadCount(folder: string): Promise<number> {
    const token = await this.token();
    const label = folderToLabel(folder);
    if (!label) return 0;
    const params = folder === 'snoozed'
      ? new URLSearchParams({ q: 'is:snoozed', maxResults: '500' })
      : new URLSearchParams({ labelIds: label, maxResults: '500' });
    const result = await this.gFetch<{
      threads?: Array<{ id: string }>;
      nextPageToken?: string;
      resultSizeEstimate?: number;
    }>(
      token, `/users/me/threads?${params}`,
    );
    const returnedCount = result.threads?.length ?? 0;
    // Gmail only promises an estimate. When the whole result fits in one page,
    // the returned IDs give us an exact count; otherwise never report less than
    // the number of threads already observed on that first page.
    if (!result.nextPageToken) return returnedCount;
    return Math.max(returnedCount, result.resultSizeEstimate ?? 0);
  }

  private async fetchThreadSummary(
    token: string,
    threadId: string,
    snippet: string,
  ): Promise<MailThread | null> {
    try {
      const thread = await this.gFetch<GmailThread>(
        token,
        `/users/me/threads/${threadId}?format=metadata` +
          `&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date` +
          `&metadataHeaders=To&metadataHeaders=Cc`,
      );

      const messages = thread.messages ?? [];
      if (!messages.length) return null;

      const first = messages[0];
      const last = messages[messages.length - 1];
      const fh = (msg: GmailMessage, name: string) =>
        getHeader(msg.payload?.headers ?? [], name);

      const subject = fh(first, 'Subject') || '(no subject)';
      const from = parseFrom(fh(last, 'From'));
      const dateRaw = fh(last, 'Date');
      const lastDate = dateRaw
        ? new Date(dateRaw).toISOString()
        : msToIso(last.internalDate ?? '0');

      const unreadCount = messages.filter(m => m.labelIds?.includes('UNREAD')).length;
      const hasAttachments = messages.some(m => hasAttachmentParts(m.payload));

      // For To/Cc: use the last message we *sent* (SENT label) so that in Sent folder
      // we show outgoing recipients, not the To: of a reply addressed back to us.
      const sentMessages = messages.filter(m => m.labelIds?.includes('SENT'));
      const recipientSource = sentMessages.length > 0 ? sentMessages[sentMessages.length - 1] : last;

      // unique_senders: From addresses of messages we did NOT send, excluding own email
      const ownEmail = this.userEmail;
      const seenEmails = new Set<string>();
      const unique_senders = messages
        .filter(m => !m.labelIds?.includes('SENT'))
        .reduce<import('../types').MailRecipient[]>((acc, m) => {
          const raw = fh(m, 'From');
          if (!raw) return acc;
          const parsed = parseFrom(raw);
          const key = parsed.email.toLowerCase();
          if (!key || key === ownEmail || seenEmails.has(key)) return acc;
          seenEmails.add(key);
          acc.push({ name: parsed.name, email: parsed.email });
          return acc;
        }, []);

      return {
        conversation_id: threadId,
        topic: subject,
        snippet,
        last_delivery_time: lastDate,
        message_count: messages.length,
        unread_count: unreadCount,
        from_name: from.name ?? from.email,
        from_email: from.email || null,
        has_attachments: hasAttachments,
        to_recipients: parseAddressList(fh(recipientSource, 'To')),
        cc_recipients: parseAddressList(fh(recipientSource, 'Cc')),
        unique_senders,
      };
    } catch {
      return null;
    }
  }

  async searchThreads(query: MailSearchQuery, maxCount = 50): Promise<MailThread[]> {
    const token = await this.token();
    const q = buildGmailQuery(query);
    console.log('[Gmail.searchThreads] q=', JSON.stringify(q));
    if (!q) {
      console.warn('[Gmail.searchThreads] empty q — no search performed');
      return [];
    }

    const params = new URLSearchParams({ q, maxResults: String(maxCount) });
    console.log('[Gmail.searchThreads] URL:', `/users/me/threads?${params}`);
    const res = await this.gFetch<{
      threads?: Array<{ id: string; snippet?: string }>;
    }>(token, `/users/me/threads?${params}`);

    console.log('[Gmail.searchThreads] raw thread IDs:', res.threads?.length ?? 0, res.threads?.map(t => t.id));
    if (!res.threads?.length) return [];

    const CONCURRENCY = 10;
    const results: (MailThread | null)[] = [];
    for (let i = 0; i < res.threads.length; i += CONCURRENCY) {
      const batch = res.threads.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(t => this.fetchThreadSummary(token, t.id, t.snippet ?? ''))
      );
      results.push(...batchResults);
    }
    return results.filter((t): t is MailThread => t !== null);
  }

  async getThread(conversationId: string, includeTrash = false, _isDraft = false): Promise<MailMessage[]> {
    const token = await this.token();
    const thread = await this.gFetch<GmailThread>(
      token,
      `/users/me/threads/${conversationId}?format=metadata` +
        `&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date` +
        `&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Message-ID` +
        `&metadataHeaders=References`,
    );

    const messages = (thread.messages ?? []).filter(
      m => includeTrash || !m.labelIds?.includes('TRASH'),
    );

    return messages.map(m => ({ ...this.parseMessage(m), body_loaded: false }));
  }

  async getMessageContent(messageId: string) {
    const token = await this.token();
    const message = await this.gFetch<GmailMessage>(
      token,
      `/users/me/messages/${messageId}?format=full`,
    );
    const parsed = this.parseMessage(message);
    const body_html = await injectGmailInlineImages(
      token,
      message.id,
      parsed.body_html,
      message.payload ?? {},
      this.gFetch.bind(this),
    );
    return {
      body_html,
      body_text: parsed.body_text,
      ics_mime: parsed.ics_mime,
      attachments: parsed.attachments,
      has_attachments: parsed.has_attachments,
    };
  }

  async getRawMessageSource(itemId: string): Promise<string> {
    const token = await this.token();
    const message = await this.gFetch<{ raw?: string }>(token, `/users/me/messages/${itemId}?format=raw`);
    if (!message.raw) throw new Error('Gmail did not return the original message source.');
    return decodeBase64Url(message.raw);
  }

  private parseMessage(msg: GmailMessage): MailMessage {
    const headers = msg.payload?.headers ?? [];
    const h = (name: string) => getHeader(headers, name);
    const from = parseFrom(h('From'));
    const attachments = extractAttachments(msg.id, msg.payload ?? {});

    return {
      item_id: msg.id,
      // Repurpose change_key to store threadId — used as threadId when sending replies.
      change_key: msg.threadId ?? '',
      subject: h('Subject') || '(no subject)',
      from_name: from.name,
      from_email: from.email || null,
      to_recipients: parseAddressList(h('To')),
      cc_recipients: parseAddressList(h('Cc')),
      body_html: extractBody(msg.payload ?? {}),
      date_time_received: msToIso(msg.internalDate ?? '0'),
      is_read: !msg.labelIds?.includes('UNREAD'),
      has_attachments: attachments.filter(a => !a.is_inline).length > 0,
      attachments: attachments.filter(a => !a.is_inline),
      size: msg.sizeEstimate,
    };
  }

  // ── Folders / labels ───────────────────────────────────────────────────────

  async listFolders(): Promise<MailFolder[]> {
    const token = await this.token();
    const res = await this.gFetch<{ labels?: GmailLabel[] }>(token, '/users/me/labels');
    const labels = res.labels ?? [];

    // Include key system labels so that buildUnreadCounts can populate inbox/sent/trash counts.
    const SYSTEM_LABEL_IDS = new Set(['INBOX', 'SENT', 'TRASH', 'SPAM', 'DRAFT']);
    const relevantLabels = labels.filter(
      l => l.type === 'user' || SYSTEM_LABEL_IDS.has(l.id),
    );

    // The list endpoint already returns id+name for every label.
    // Fetching individual details per label to get message counts caused rate-limit errors
    // that silently dropped random labels. Fetch details only for the small set of system
    // labels we actually display unread counts for; use 0 for the rest.
    const COUNTED_IDS = new Set(['INBOX', 'SENT', 'TRASH', 'SPAM', 'DRAFT']);
    const countedLabels = relevantLabels.filter(l => COUNTED_IDS.has(l.id));
    const details = await Promise.all(
      countedLabels.map(l =>
        this.gFetch<GmailLabelDetail>(token, `/users/me/labels/${l.id}`).catch(() => null),
      ),
    );
    const countMap = new Map<string, GmailLabelDetail>();
    for (const d of details) {
      if (d) countMap.set(d.id, d);
    }

    return relevantLabels.map(l => ({
      folder_id: l.id,
      display_name: l.name,
      total_count: countMap.get(l.id)?.messagesTotal ?? 0,
      unread_count: countMap.get(l.id)?.messagesUnread ?? 0,
    }));
  }

  async getInboxUnread(): Promise<number> {
    const token = await this.token();
    const label = await this.gFetch<GmailLabelDetail>(token, '/users/me/labels/INBOX');
    return label.messagesUnread ?? 0;
  }

  // ── Send ───────────────────────────────────────────────────────────────────

  async sendMail({ to, cc, bcc, subject, bodyHtml, replyToItemId, replyToChangeKey, attachments, fromIdentityId }: SendMailParams): Promise<void> {
    const token = await this.token();

    let inReplyToMsgId: string | null = null;
    if (replyToItemId) {
      try {
        // Fetch the original message to get its RFC 2822 Message-ID header for threading
        const orig = await this.gFetch<GmailMessage>(
          token,
          `/users/me/messages/${replyToItemId}?format=metadata&metadataHeaders=Message-ID`,
        );
        inReplyToMsgId = getHeader(orig.payload?.headers ?? [], 'Message-ID') || null;
      } catch { /* non-critical */ }
    }

    const headerLines = [
      `To: ${to.join(', ')}`,
      ...(cc && cc.length > 0 ? [`Cc: ${cc.join(', ')}`] : []),
      ...(bcc && bcc.length > 0 ? [`Bcc: ${bcc.join(', ')}`] : []),
      `Subject: ${subject.replace(/\r?\n/g, ' ')}`,
      'MIME-Version: 1.0',
    ];
    if (fromIdentityId) {
      const identity = this.cachedIdentities?.find(i => i.id === fromIdentityId);
      const fromHeader = identity?.name && identity.name !== fromIdentityId
        ? `From: ${identity.name} <${fromIdentityId}>`
        : `From: ${fromIdentityId}`;
      headerLines.push(fromHeader);
    }
    if (inReplyToMsgId) {
      headerLines.push(`In-Reply-To: ${inReplyToMsgId}`);
      headerLines.push(`References: ${inReplyToMsgId}`);
    }

    let mime: string;
    if (attachments && attachments.length > 0) {
      const boundary = `__bnd_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      headerLines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);

      const parts: string[] = [
        `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${bodyHtml}`,
        ...attachments.map(att => {
          // Wrap base64 data at 76 chars per line (RFC 2045)
          const wrapped = att.data.match(/.{1,76}/g)?.join('\r\n') ?? att.data;
          return (
            `--${boundary}\r\n` +
            `Content-Type: ${att.contentType}; name="${att.name}"\r\n` +
            `Content-Disposition: attachment; filename="${att.name}"\r\n` +
            `Content-Transfer-Encoding: base64\r\n\r\n` +
            wrapped
          );
        }),
      ];
      mime = headerLines.join('\r\n') + '\r\n\r\n' + parts.join('\r\n') + `\r\n--${boundary}--`;
    } else {
      headerLines.push('Content-Type: text/html; charset=UTF-8');
      mime = headerLines.join('\r\n') + '\r\n\r\n' + bodyHtml;
    }

    const body: Record<string, string> = { raw: encodeBase64Url(mime) };
    // replyToChangeKey stores the threadId (set in parseMessage)
    if (replyToChangeKey) body.threadId = replyToChangeKey;

    await this.gPost(token, '/users/me/messages/send', body);
  }

  async saveDraft({ to, cc, bcc, subject, bodyHtml }: SaveDraftParams): Promise<string> {
    const token = await this.token();
    const headerLines = [
      `To: ${to.join(', ')}`,
      ...(cc && cc.length > 0 ? [`Cc: ${cc.join(', ')}`] : []),
      ...(bcc && bcc.length > 0 ? [`Bcc: ${bcc.join(', ')}`] : []),
      `Subject: ${subject.replace(/\r?\n/g, ' ')}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
    ];
    const mime = headerLines.join('\r\n') + '\r\n\r\n' + bodyHtml;
    const resp = await this.gPost(token, '/users/me/drafts', {
      message: { raw: encodeBase64Url(mime) },
    });
    return (resp as any)?.id ?? '';
  }

  // ── Read / unread ──────────────────────────────────────────────────────────

  async markRead(items: MailItemRef[]): Promise<void> {
    if (!items.length) return;
    const token = await this.token();
    await this.gPost(token, '/users/me/messages/batchModify', {
      ids: items.map(i => i.item_id),
      removeLabelIds: ['UNREAD'],
    });
  }

  async markUnread(items: MailItemRef[]): Promise<void> {
    if (!items.length) return;
    const token = await this.token();
    await this.gPost(token, '/users/me/messages/batchModify', {
      ids: items.map(i => i.item_id),
      addLabelIds: ['UNREAD'],
    });
  }

  // ── Delete / trash ─────────────────────────────────────────────────────────

  async moveToTrash(itemId: string): Promise<void> {
    const token = await this.token();
    await this.gPost(token, `/users/me/messages/${itemId}/trash`, {});
  }

  async permanentlyDelete(itemId: string): Promise<void> {
    const token = await this.token();
    await this.gFetch(token, `/users/me/messages/${itemId}`, { method: 'DELETE' });
  }

  async bulkMoveToTrash(conversationIds: string[]): Promise<void> {
    if (!conversationIds.length) return;
    const token = await this.token();
    // threads.trash() operates at thread level — no need to fetch individual message IDs.
    const CONCURRENCY = 5;
    for (let i = 0; i < conversationIds.length; i += CONCURRENCY) {
      const batch = conversationIds.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(id => this.gPost(token, `/users/me/threads/${id}/trash`, {})));
    }
  }

  async bulkPermanentlyDelete(conversationIds: string[]): Promise<void> {
    if (!conversationIds.length) return;
    const token = await this.token();
    const CONCURRENCY = 5;
    for (let i = 0; i < conversationIds.length; i += CONCURRENCY) {
      const batch = conversationIds.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(id => this.gFetch(token, `/users/me/threads/${id}`, { method: 'DELETE' })));
    }
  }

  async bulkMoveToFolder(conversationIds: string[], folderId: string): Promise<void> {
    if (!conversationIds.length) return;
    const token = await this.token();
    const targetLabel = folderToLabel(folderId);
    if (!targetLabel) return;
    const MUTABLE_SYSTEM = ['INBOX', 'TRASH', 'SPAM'];
    const removeLabelIds = MUTABLE_SYSTEM.includes(targetLabel)
      ? MUTABLE_SYSTEM.filter(l => l !== targetLabel)
      : ['INBOX'];

    // Collect all message IDs (needed by batchModify which operates at message level).
    const allMessageIds: string[] = [];
    const CONCURRENCY = 5;
    for (let i = 0; i < conversationIds.length; i += CONCURRENCY) {
      const batch = conversationIds.slice(i, i + CONCURRENCY);
      const threads = await Promise.all(
        batch.map(id =>
          this.gFetch<GmailThread>(token, `/users/me/threads/${id}?format=metadata&metadataHeaders=Subject`)
            .catch(() => null),
        ),
      );
      for (const thread of threads) {
        if (thread?.messages) allMessageIds.push(...thread.messages.map(m => m.id));
      }
    }
    if (!allMessageIds.length) return;
    await this.gPost(token, '/users/me/messages/batchModify', {
      ids: allMessageIds,
      addLabelIds: [targetLabel],
      removeLabelIds,
    });
  }

  // ── Attachments ────────────────────────────────────────────────────────────

  async openAttachment(attachment: MailAttachment): Promise<void> {
    const [messageId, attachmentId] = attachment.attachment_id.split(':');
    const accessToken = await this.token();
    return invoke('gmail_open_attachment', { accessToken, messageId, attachmentId, filename: attachment.name });
  }

  async getAttachmentData(attachment: MailAttachment): Promise<string> {
    const [messageId, attachmentId] = attachment.attachment_id.split(':');
    const accessToken = await this.token();
    // Delegate to the Rust command which uses the correct URL_SAFE_NO_PAD decoder
    // and returns clean standard base64.
    return invoke<string>('gmail_get_attachment_data', { accessToken, messageId, attachmentId });
  }


  async moveToFolder(itemId: string, folderId: string): Promise<void> {
    const token = await this.token();
    const targetLabel = folderToLabel(folderId);
    if (!targetLabel) return;

    // SENT and DRAFT are immutable Gmail labels — the API rejects any attempt to remove them.
    // INBOX, TRASH and SPAM are mutually exclusive: removing the others when targeting one.
    const MUTABLE_SYSTEM = ['INBOX', 'TRASH', 'SPAM'];
    let removeLabelIds: string[];
    if (MUTABLE_SYSTEM.includes(targetLabel)) {
      // System destination: remove the other mutable system labels
      removeLabelIds = MUTABLE_SYSTEM.filter(l => l !== targetLabel);
    } else {
      // Custom label destination: only remove INBOX (archive out of inbox)
      removeLabelIds = ['INBOX'];
    }

    await this.gPost(token, `/users/me/messages/${itemId}/modify`, {
      addLabelIds: [targetLabel],
      removeLabelIds,
    });
  }

  async searchContacts(query: string, maxCount = 25): Promise<Contact[]> {
    if (!query.trim()) return [];
    const token = await this.token();
    const headers = { Authorization: `Bearer ${token}` };
    const pageSize = String(Math.min(maxCount, 30));
    const readMask = 'names,emailAddresses';
    const request = async (endpoint: string, source: Contact['source']): Promise<Contact[]> => {
      const params = new URLSearchParams({ query, pageSize, readMask });
      const res = await fetch(`https://people.googleapis.com/v1/${endpoint}?${params}`, { headers });
      if (!res.ok) throw new Error(`Google People ${endpoint} failed (${res.status})`);
      const data = await res.json() as { results?: Array<{ person: { names?: Array<{ displayName: string }>; emailAddresses?: Array<{ value: string }> } }> };
      return (data.results ?? []).flatMap(({ person }) => {
        const name = person.names?.[0]?.displayName;
        return (person.emailAddresses ?? []).flatMap(({ value: email }) => email ? [{ email, name, source }] : []);
      });
    };

    // Both endpoints use a lazy search cache. Warm it before the real searches;
    // failures are harmless here and the actual requests retain useful errors.
    if (!this.contactSearchWarmup) {
      const warm = (endpoint: string) => fetch(
        `https://people.googleapis.com/v1/${endpoint}?${new URLSearchParams({ query: '', pageSize: '1', readMask })}`,
        { headers },
      ).then(() => undefined, () => undefined);
      this.contactSearchWarmup = Promise.all([
        warm('people:searchContacts'),
        warm('otherContacts:search'),
      ]).then(() => undefined);
    }
    await this.contactSearchWarmup;

    const settled = await Promise.allSettled([
      request('people:searchContacts', 'google-contact'),
      request('otherContacts:search', 'google-other-contact'),
    ]);
    const results = settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
    if (results.length === 0 && settled.every(result => result.status === 'rejected')) {
      throw (settled[0] as PromiseRejectedResult).reason;
    }
    const seen = new Set<string>();
    return results.filter(contact => {
      const key = contact.email.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, maxCount);
  }

  async getContactPhoto(email: string): Promise<string | null> {
    const token = await this.token();
    // Search for the person to get their resourceName, then fetch the photo
    const params = new URLSearchParams({ query: email, pageSize: '1', readMask: 'photos,emailAddresses' });
    const res = await fetch(`https://people.googleapis.com/v1/people:searchContacts?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json() as { results?: Array<{ person: { photos?: Array<{ url: string }>; emailAddresses?: Array<{ value: string }> } }> };
    const match = data.results?.find(({ person }) =>
      person.emailAddresses?.some(({ value }) => value.toLowerCase() === email.toLowerCase())
    );
    const photoUrl = match?.person.photos?.find(photo => photo.url)?.url;
    if (!photoUrl) return null;
    const imgRes = await fetch(photoUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!imgRes.ok) return null;
    const buf = await imgRes.arrayBuffer();
    return btoa(Array.from(new Uint8Array(buf), b => String.fromCodePoint(b)).join(''));
  }
}

// ── Search helpers ────────────────────────────────────────────────────────────

/** Resolve 'today' / 'yesterday' to a YYYY-MM-DD string; pass through otherwise. */
function resolveSearchDate(date: string): string {
  const d = new Date();
  if (date === 'today') return d.toISOString().split('T')[0];
  if (date === 'yesterday') {
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  }
  return date;
}

/**
 * Build a Gmail search query string (q parameter) from a MailSearchQuery.
 * Gmail operators: from:, to:, cc:, bcc:, subject:, in:, after:/before:
 */
export function buildGmailQuery(query: MailSearchQuery): string {
  const parts: string[] = [];

  if (query.from)    parts.push(`from:${query.from}`);
  if (query.to)      parts.push(`to:${query.to}`);
  if (query.cc)      parts.push(`cc:${query.cc}`);
  if (query.bcc)     parts.push(`bcc:${query.bcc}`);
  if (query.subject) {
    const sub = query.subject.includes(' ') ? `"${query.subject}"` : query.subject;
    parts.push(`subject:${sub}`);
  }
  if (query.text) parts.push(query.text);

  if (query.folder) {
    // Map known folder keys to Gmail labels/in-operands
    const inLabel = (folderToLabel(query.folder) ?? query.folder).toLowerCase();
    parts.push(`in:${inLabel}`);
  }

  if (query.date) {
    const resolved = resolveSearchDate(query.date);
    // Gmail after/before use YYYY/MM/DD format
    const [y, m, day] = resolved.split('-');
    const afterDate = `${y}/${m}/${day}`;
    const nextDay = new Date(resolved);
    nextDay.setDate(nextDay.getDate() + 1);
    const [ny, nm, nd] = nextDay.toISOString().split('T')[0].split('-');
    const beforeDate = `${ny}/${nm}/${nd}`;
    parts.push(`after:${afterDate} before:${beforeDate}`);
  }

  return parts.join(' ');
}
