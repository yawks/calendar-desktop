import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MailAttachment, MailIdentity, MailMessage, ComposerRestoreData } from '../types';
import { Paperclip, Send, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ComposerAttachment } from '../providers/MailProvider';
import { RecipientEntry, RecipientInput } from './RecipientInput';
import { ComposerAttachmentPanel } from './ComposerAttachmentPanel';
import { MailEditor, MailEditorHandle } from './MailEditor';
import { formatFullDate } from '../utils';

// ── Helper: build the initial HTML for a reply/forward ────────────────────────

function buildReplyHTML(
  replyTo: MailMessage,
  t: (key: string, fallback: string) => string,
): string {
  const sep    = t('mail.originalMessage', '----- Message d\'origine -----');
  const fLabel = t('mail.from',    'De');
  const tLabel = t('mail.to',      'À');
  const dLabel = t('mail.date',    'Date');
  const sLabel = t('mail.subject', 'Objet');

  const from = replyTo.from_name
    ? `${replyTo.from_name} &lt;${replyTo.from_email}&gt;`
    : (replyTo.from_email ?? '');
  const to = replyTo.to_recipients
    .map(r => (r.name ? `${r.name} &lt;${r.email}&gt;` : r.email))
    .join(', ');
  const date = formatFullDate(replyTo.date_time_received);

  return (
    `<p></p>` +
    `<div class="mail-quoted mail-quoted--level-1">` +
      `<div class="mail-quoted__separator">${sep}</div>` +
      `<div class="mail-quoted__headers">` +
        `<div><span class="mail-quoted__hdr-key">${fLabel} :</span> ${from}</div>` +
        `<div><span class="mail-quoted__hdr-key">${tLabel} :</span> ${to}</div>` +
        `<div><span class="mail-quoted__hdr-key">${dLabel} :</span> ${date}</div>` +
        `<div><span class="mail-quoted__hdr-key">${sLabel} :</span> ${replyTo.subject}</div>` +
      `</div>` +
      `<div class="mail-quoted__body">${replyTo.body_html}</div>` +
    `</div>`
  );
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface MailComposerProps {
  readonly replyTo?: MailMessage;
  readonly mode?: 'reply' | 'replyAll' | 'forward';
  readonly contacts: { email: string; name?: string }[];
  readonly currentUserEmail?: string;
  readonly restoreData?: ComposerRestoreData | null;
  readonly identities?: MailIdentity[];
  readonly selectedIdentityId?: string;
  readonly onIdentityChange?: (id: string) => void;
  readonly onGetAttachmentData?: (att: MailAttachment) => Promise<string>;
  readonly onSend: (to: string[], cc: string[], bcc: string[], subject: string, body: string, attachments: ComposerAttachment[], fromIdentityId?: string) => Promise<void>;
  readonly onCancel: () => void;
  readonly onSaveDraft?: (to: string[], cc: string[], bcc: string[], subject: string, body: string) => void;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function MailComposer({
  replyTo, mode, contacts, currentUserEmail,
  restoreData, identities, selectedIdentityId, onIdentityChange,
  onGetAttachmentData, onSend, onCancel, onSaveDraft,
}: MailComposerProps) {
  const { t } = useTranslation();

  const [toRecipients,  setToRecipients]  = useState<RecipientEntry[]>([]);
  const [ccRecipients,  setCcRecipients]  = useState<RecipientEntry[]>([]);
  const [bccRecipients, setBccRecipients] = useState<RecipientEntry[]>([]);
  const [showCc,  setShowCc]  = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState('');
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [isSending, setIsSending] = useState(false);

  const editorRef   = useRef<MailEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Compute initial HTML once (draft restore OR quoted reply block)
  const initialHTML = useMemo(() => {
    if (restoreData?.body) return restoreData.body;
    if (replyTo && mode)   return buildReplyHTML(replyTo, t);
    return '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initialise form fields from restoreData or reply props
  useEffect(() => {
    if (restoreData) {
      setToRecipients(restoreData.toRecipients);
      setCcRecipients(restoreData.ccRecipients);
      setBccRecipients(restoreData.bccRecipients);
      setSubject(restoreData.subject);
      setAttachments(restoreData.attachments);
      setShowCc(restoreData.showCc);
      setShowBcc(restoreData.showBcc);
      return;
    }
    if (replyTo && mode) {
      const to: RecipientEntry[] = [];
      const cc: RecipientEntry[] = [];
      if (mode === 'forward') {
        setSubject(`Fwd: ${replyTo.subject}`);
        // Fetch and pre-attach the original message's attachments
        if (onGetAttachmentData && replyTo.attachments?.length) {
          Promise.allSettled(
            replyTo.attachments
              .filter(a => !a.is_inline)
              .map(async (a) => {
                const data = await onGetAttachmentData(a);
                return { name: a.name, contentType: a.content_type, size: a.size, data } satisfies ComposerAttachment;
              })
          ).then(results => {
            const fetched = results.flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
            if (fetched.length > 0) setAttachments(fetched);
          });
        }
      } else {
        setSubject(`Re: ${replyTo.subject}`);
        to.push({ email: replyTo.from_email || '', name: replyTo.from_name || undefined });
        if (mode === 'replyAll') {
          const others = [
            ...(replyTo.to_recipients || []),
            ...(replyTo.cc_recipients || []),
          ].filter(r => r.email !== currentUserEmail && r.email !== replyTo.from_email);
          cc.push(...others.map(r => ({ email: r.email, name: r.name || undefined })));
        }
      }
      setToRecipients(to);
      setCcRecipients(cc);
      setShowCc(cc.length > 0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSend = async () => {
    setIsSending(true);
    try {
      await onSend(
        toRecipients.map(r => r.email),
        ccRecipients.map(r => r.email),
        bccRecipients.map(r => r.email),
        subject,
        editorRef.current?.getHTML() ?? '',
        attachments,
        selectedIdentityId,
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleSaveDraft = () => {
    onSaveDraft?.(
      toRecipients.map(r => r.email),
      ccRecipients.map(r => r.email),
      bccRecipients.map(r => r.email),
      subject,
      editorRef.current?.getHTML() ?? '',
    );
    onCancel();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const newAtts: ComposerAttachment[] = [];
    for (const file of Array.from(files)) {
      const reader = new FileReader();
      const content = await new Promise<string>(resolve => {
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(file);
      });
      newAtts.push({ name: file.name, contentType: file.type, data: content, size: file.size });
    }
    setAttachments(prev => [...prev, ...newAtts]);
  };

  return (
    <div className="mail-composer">

      {/* ── Top toolbar: Send | Attach | [spacer] | X ── */}
      <div className="mail-composer__top-toolbar">
        <button
          type="button"
          className="btn-primary"
          onClick={handleSend}
          disabled={isSending || toRecipients.length === 0}
        >
          <Send size={15} />
          {isSending ? t('mail.sending', 'Envoi…') : t('mail.send', 'Envoyer')}
        </button>

        <button
          type="button"
          className="btn-ghost"
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip size={15} />
          {t('mail.attach', 'Joindre')}
        </button>
        <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleFileChange} />

        <div style={{ flex: 1 }} />

        <CloseComposerPopover
          onSaveDraft={onSaveDraft ? handleSaveDraft : undefined}
          onDiscard={onCancel}
        />
      </div>

      {/* ── Fields ── */}
      <div className="mail-composer__fields">
        {identities && identities.length >= 1 && (
          <div className="mail-composer__field">
            <span className="mail-composer__label">{t('mail.from', 'De')}</span>
            <select
              className="mail-composer__input"
              value={selectedIdentityId}
              onChange={e => onIdentityChange?.(e.target.value)}
            >
              {identities.map(id => (
                <option key={id.id} value={id.id}>
                  {id.name ? `${id.name} <${id.email}>` : id.email}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mail-composer__field">
          <span className="mail-composer__label">{t('mail.to', 'À')}</span>
          <RecipientInput value={toRecipients} onChange={setToRecipients} contacts={contacts} fieldId="to" autoFocus={mode === 'forward'} />
          <div className="mail-composer__field-actions">
            {!showCc  && <button type="button" className="mail-composer__cc-btn" onClick={() => setShowCc(true)}>Cc</button>}
            {!showBcc && <button type="button" className="mail-composer__cc-btn" onClick={() => setShowBcc(true)}>Bcc</button>}
          </div>
        </div>

        {showCc && (
          <div className="mail-composer__field">
            <span className="mail-composer__label">{t('mail.cc', 'Cc')}</span>
            <RecipientInput value={ccRecipients} onChange={setCcRecipients} contacts={contacts} fieldId="cc" />
            <button type="button" className="mail-composer__field-remove" onClick={() => setShowCc(false)}><X size={14} /></button>
          </div>
        )}

        {showBcc && (
          <div className="mail-composer__field">
            <span className="mail-composer__label">Bcc</span>
            <RecipientInput value={bccRecipients} onChange={setBccRecipients} contacts={contacts} fieldId="bcc" />
            <button type="button" className="mail-composer__field-remove" onClick={() => setShowBcc(false)}><X size={14} /></button>
          </div>
        )}

        <div className="mail-composer__field">
          <span className="mail-composer__label">{t('mail.subject', 'Objet')}</span>
          <input
            type="text"
            className="mail-composer__input"
            placeholder={t('mail.subjectPlaceholder', 'Objet')}
            value={subject}
            onChange={e => setSubject(e.target.value)}
          />
        </div>
      </div>

      {/* ── Attachments (above formatting toolbar) ── */}
      <ComposerAttachmentPanel
        attachments={attachments}
        onRemove={idx => setAttachments(prev => prev.filter((_, i) => i !== idx))}
      />

      {/* ── Tiptap editor (formatting toolbar + body) ── */}
      <MailEditor
        ref={editorRef}
        initialHTML={initialHTML}
        placeholder={t('mail.bodyPlaceholder', 'Écrivez votre réponse…')}
        disableAutoFocus={mode === 'forward'}
        onSend={handleSend}
      />
    </div>
  );
}

// ── Close popover (Save draft / Discard) ──────────────────────────────────────

export function CloseComposerPopover({
  onSaveDraft,
  onDiscard,
}: {
  readonly onSaveDraft?: () => void;
  readonly onDiscard: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="btn-icon" onClick={() => setOpen(o => !o)} title={t('mail.close', 'Fermer')}>
        <X size={16} />
      </button>
      {open && (
        <div className="close-composer-popover">
          {onSaveDraft && (
            <button
              type="button"
              className="close-composer-popover__option"
              onClick={() => { setOpen(false); onSaveDraft(); }}
            >
              {t('mail.saveDraft', 'Enregistrer le brouillon')}
            </button>
          )}
          <button
            type="button"
            className="close-composer-popover__option close-composer-popover__option--danger"
            onClick={() => { setOpen(false); onDiscard(); }}
          >
            {t('mail.discard', 'Supprimer')}
          </button>
        </div>
      )}
    </div>
  );
}
