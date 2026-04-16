import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FromAccount, ComposerRestoreData } from '../types';
import { ComposerAttachment } from '../providers/MailProvider';
import { RecipientEntry, RecipientInput } from './RecipientInput';
import { ComposerAttachmentPanel } from './ComposerAttachmentPanel';
import { MailEditor, MailEditorHandle } from './MailEditor';
import { CloseComposerPopover } from './MailComposer';
import { ChevronDown, Paperclip, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface NewMessageComposerProps {
  readonly contacts: { email: string; name?: string }[];
  readonly restoreData: ComposerRestoreData | null;
  readonly onSend: (to: string[], cc: string[], bcc: string[], subject: string, body: string, attachments: ComposerAttachment[]) => Promise<void>;
  readonly onCancel: () => void;
  readonly onSaveDraft: (to: string[], cc: string[], bcc: string[], subject: string, body: string) => void;
  readonly onDeleteDraft?: () => void;
  readonly fromAccounts: FromAccount[];
  readonly fromAccountId: string;
  readonly onFromAccountChange: (id: string) => void;
}

export function NewMessageComposer({
  contacts, restoreData, onSend, onCancel, onSaveDraft, onDeleteDraft,
  fromAccounts, fromAccountId, onFromAccountChange,
}: NewMessageComposerProps) {
  const { t } = useTranslation();

  const [toRecipients,  setToRecipients]  = useState<RecipientEntry[]>(restoreData?.toRecipients ?? []);
  const [ccRecipients,  setCcRecipients]  = useState<RecipientEntry[]>(restoreData?.ccRecipients ?? []);
  const [bccRecipients, setBccRecipients] = useState<RecipientEntry[]>(restoreData?.bccRecipients ?? []);
  const [showCc,  setShowCc]  = useState(restoreData?.showCc ?? false);
  const [showBcc, setShowBcc] = useState(restoreData?.showBcc ?? false);
  const [subject, setSubject] = useState(restoreData?.subject ?? '');
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>(restoreData?.attachments ?? []);
  const [fromOpen, setFromOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const fromRef      = useRef<HTMLDivElement>(null);
  const editorRef    = useRef<MailEditorHandle>(null);

  // Initial body HTML — evaluated once on mount
  const initialHTML = useMemo(() => restoreData?.body ?? '', []); // eslint-disable-line react-hooks/exhaustive-deps

  // Close from-dropdown on outside click
  useEffect(() => {
    if (!fromOpen) return;
    const handler = (e: Event) => {
      if (fromRef.current && !fromRef.current.contains(e.target as Node)) setFromOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [fromOpen]);

  const doSend = async () => {
    if (toRecipients.length === 0) return;
    setSending(true);
    try {
      await onSend(
        toRecipients.map(r => r.email),
        ccRecipients.map(r => r.email),
        bccRecipients.map(r => r.email),
        subject,
        editorRef.current?.getHTML() ?? '',
        attachments,
      );
    } finally {
      setSending(false);
    }
  };

  const handleClose = () => {
    const bodyHtml   = editorRef.current?.getHTML() ?? '';
    const hasContent = toRecipients.length > 0 || subject.trim() || bodyHtml.trim();
    if (hasContent) {
      onSaveDraft(
        toRecipients.map(r => r.email),
        ccRecipients.map(r => r.email),
        bccRecipients.map(r => r.email),
        subject,
        bodyHtml,
      );
    }
    onCancel();
  };

  const handleAttachFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    const newAtts: ComposerAttachment[] = [];
    for (let i = 0; i < e.target.files.length; i++) {
      const file = e.target.files[i];
      const reader = new FileReader();
      const content = await new Promise<string>(resolve => {
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(file);
      });
      newAtts.push({ name: file.name, contentType: file.type, data: content, size: file.size });
    }
    setAttachments(prev => [...prev, ...newAtts]);
    e.target.value = '';
  };

  const selectedAccount = fromAccounts.find(a => a.id === fromAccountId) ?? fromAccounts[0];

  return (
    <div className="mail-new-composer">
      <form
        className="mail-new-composer__form"
        onSubmit={e => { e.preventDefault(); doSend(); }}
      >
        {/* ── Top action bar ── */}
        <div className="mail-new-composer__toolbar">
          <button type="submit" className="btn-primary" disabled={sending || toRecipients.length === 0}>
            <Send size={15} />
            {sending ? t('mail.sending', 'Envoi…') : t('mail.send', 'Envoyer')}
          </button>
          <button type="button" className="btn-ghost" onClick={() => fileInputRef.current?.click()}>
            <Paperclip size={15} />
            {t('mail.attach', 'Joindre')}
          </button>
          <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleAttachFiles} />
          <div style={{ flex: 1 }} />
          <CloseComposerPopover onSaveDraft={handleClose} onDiscard={onDeleteDraft ?? onCancel} />
        </div>

        {/* ── From (multi-account only) ── */}
        {fromAccounts.length > 1 && (
          <div className="mail-composer__field" ref={fromRef} style={{ position: 'relative' }}>
            <span className="mail-composer__label">{t('mail.from', 'De')}:</span>
            <button type="button" className="from-account-btn" onClick={() => setFromOpen(o => !o)}>
              <span className="from-account-name" style={{ color: selectedAccount?.color ?? 'var(--primary)' }}>
                {selectedAccount?.name ?? selectedAccount?.email}
              </span>
              <span className="from-account-email">
                {selectedAccount?.name ? `<${selectedAccount.email}>` : ''}
              </span>
              <ChevronDown size={12} style={{ marginLeft: 'auto', opacity: 0.5 }} />
            </button>
            {fromOpen && (
              <ul className="from-account-dropdown">
                {fromAccounts.map(a => (
                  <li
                    key={a.id}
                    className={`from-account-option${a.id === fromAccountId ? ' from-account-option--active' : ''}`}
                    onClick={() => { onFromAccountChange(a.id); setFromOpen(false); }}
                  >
                    <span className="from-account-name" style={{ color: a.color ?? 'var(--primary)' }}>{a.name ?? a.email}</span>
                    <span className="from-account-email">{a.name ? `<${a.email}>` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* ── To ── */}
        <div className="mail-composer__field">
          <span className="mail-composer__label">{t('mail.to', 'À')}</span>
          <RecipientInput value={toRecipients} onChange={setToRecipients} contacts={contacts} fieldId="to" />
          {!showCc  && <button type="button" className="mail-composer__cc-btn" onClick={() => setShowCc(true)}>Cc</button>}
          {!showBcc && <button type="button" className="mail-composer__cc-btn" onClick={() => setShowBcc(true)}>Bcc</button>}
        </div>

        {showCc && (
          <div className="mail-composer__field">
            <span className="mail-composer__label">{t('mail.cc', 'Cc')}</span>
            <RecipientInput value={ccRecipients} onChange={setCcRecipients} contacts={contacts} fieldId="cc" />
          </div>
        )}

        {showBcc && (
          <div className="mail-composer__field">
            <span className="mail-composer__label">Bcc:</span>
            <RecipientInput value={bccRecipients} onChange={setBccRecipients} contacts={contacts} fieldId="bcc" />
          </div>
        )}

        {/* ── Subject ── */}
        <div className="mail-composer__field">
          <span className="mail-composer__label">{t('mail.subject', 'Objet')}</span>
          <input
            className="mail-composer__input"
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder={t('mail.subjectPlaceholder', 'Objet')}
            spellCheck={false}
          />
        </div>

        {/* ── Tiptap editor (toolbar + body) ── */}
        <MailEditor
          ref={editorRef}
          initialHTML={initialHTML}
          placeholder={t('mail.bodyPlaceholder', 'Écrivez votre message…')}
          onSend={doSend}
        />

        {/* ── Attachments ── */}
        <ComposerAttachmentPanel
          attachments={attachments}
          onRemove={i => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
        />
      </form>
    </div>
  );
}

