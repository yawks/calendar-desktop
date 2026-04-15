import { useEffect, useRef, useState } from 'react';
import { FromAccount, ComposerRestoreData } from '../types';
import { ComposerAttachment } from '../providers/MailProvider';
import { RecipientEntry, RecipientInput } from './RecipientInput';
import { ComposerAttachmentPanel } from './ComposerAttachmentPanel';
import { Bold, ChevronDown, Italic, List, ListOrdered, Paperclip, Send, Underline, X } from 'lucide-react';
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
  fromAccounts, fromAccountId, onFromAccountChange
}: NewMessageComposerProps) {
  const { t } = useTranslation();
  const [toRecipients, setToRecipients] = useState<RecipientEntry[]>(restoreData?.toRecipients ?? []);
  const [ccRecipients, setCcRecipients] = useState<RecipientEntry[]>(restoreData?.ccRecipients ?? []);
  const [bccRecipients, setBccRecipients] = useState<RecipientEntry[]>(restoreData?.bccRecipients ?? []);
  const [showCc, setShowCc] = useState((restoreData?.showCc) ?? false);
  const [showBcc, setShowBcc] = useState((restoreData?.showBcc) ?? false);
  const [subject, setSubject] = useState(restoreData?.subject ?? '');
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>(restoreData?.attachments ?? []);
  const [fromOpen, setFromOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const fromRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (restoreData?.body && bodyRef.current) {
      bodyRef.current.innerHTML = restoreData.body;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const bodyHtml = bodyRef.current?.innerHTML ?? '';
    setSending(true);
    try {
      await onSend(
        toRecipients.map(r => r.email),
        ccRecipients.map(r => r.email),
        bccRecipients.map(r => r.email),
        subject,
        bodyHtml,
        attachments,
      );
    } finally {
      setSending(false);
    }
  };

  const handleClose = () => {
    if (onSaveDraft) {
      const bodyHtml = bodyRef.current?.innerHTML ?? '';
      const hasContent = toRecipients.length > 0 || subject.trim().length > 0 || bodyHtml.trim().length > 0;
      if (hasContent) {
        onSaveDraft(
          toRecipients.map(r => r.email),
          ccRecipients.map(r => r.email),
          bccRecipients.map(r => r.email),
          subject,
          bodyHtml,
        );
      }
    }
    onCancel();
  };

  const handleAttachFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    const newAtts: ComposerAttachment[] = [];
    for (let i = 0; i < e.target.files.length; i++) {
      const file = e.target.files[i];
      const reader = new FileReader();
      const content = await new Promise<string>((resolve) => {
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(file);
      });
      newAtts.push({ name: file.name, contentType: file.type, data: content, size: file.size });
    }
    setAttachments(prev => [...prev, ...newAtts]);
    e.target.value = '';
  };

  const exec = (cmd: string) => {
    document.execCommand(cmd, false, undefined);
    bodyRef.current?.focus();
  };

  const selectedAccount = fromAccounts.find(a => a.id === fromAccountId) ?? fromAccounts[0];

  return (
    <div className="mail-new-composer">
      <form
        className="mail-new-composer__form"
        onSubmit={e => { e.preventDefault(); doSend(); }}
        onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) { e.preventDefault(); doSend(); } }}
      >
        {/* Toolbar */}
        <div className="mail-new-composer__toolbar">
          <button type="submit" className="btn-primary" disabled={sending || toRecipients.length === 0}>
            <Send size={15} />
            {sending ? t('mail.sending', 'Sending…') : t('mail.send', 'Send')}
          </button>
          <button type="button" className="btn-secondary" onClick={() => fileInputRef.current?.click()}>
            <Paperclip size={15} />
            {t('mail.attach', 'Joindre')}
          </button>
          <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleAttachFiles} />
          <div style={{ flex: 1 }} />
          {/* Close with save-draft popover */}
          <CloseComposerPopover
            onSaveDraft={handleClose}
            onDiscard={onDeleteDraft ?? onCancel}
          />
        </div>

        {/* From account selector (multi-account mode only) */}
        {fromAccounts.length > 1 && (
          <div className="mail-composer__field" ref={fromRef} style={{ position: 'relative' }}>
            <span className="mail-composer__label">{t('mail.from', 'From')}:</span>
            <button
              type="button"
              className="from-account-btn"
              onClick={() => setFromOpen(o => !o)}
            >
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

        {/* To */}
        <div className="mail-composer__field">
          <span className="mail-composer__label">{t('mail.to', 'To')}</span>
          <RecipientInput
            value={toRecipients}
            onChange={setToRecipients}
            contacts={contacts}
            fieldId="to"
          />
          {!showCc && (
            <button type="button" className="mail-composer__cc-btn" onClick={() => setShowCc(true)}>Cc</button>
          )}
          {!showBcc && (
            <button type="button" className="mail-composer__cc-btn" onClick={() => setShowBcc(true)}>Bcc</button>
          )}
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

        {/* Subject */}
        <div className="mail-composer__field">
          <span className="mail-composer__label">{t('mail.subject', 'Subject')}</span>
          <input
            className="mail-composer__input"
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder={t('mail.subjectPlaceholder', 'Objet')}
            spellCheck={false}
          />
        </div>

        {/* Formatting toolbar */}
        <div className="mail-composer__toolbar">
          <button type="button" onClick={() => exec('bold')} title="Gras"><Bold size={16} /></button>
          <button type="button" onClick={() => exec('italic')} title="Italique"><Italic size={16} /></button>
          <button type="button" onClick={() => exec('underline')} title="Souligné"><Underline size={16} /></button>
          <div className="mail-composer__toolbar-sep" />
          <button type="button" onClick={() => exec('insertUnorderedList')} title="Liste à puces"><List size={16} /></button>
          <button type="button" onClick={() => exec('insertOrderedList')} title="Liste numérotée"><ListOrdered size={16} /></button>
        </div>

        <ComposerAttachmentPanel
          attachments={attachments}
          onRemove={i => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
        />

        <div
          ref={bodyRef}
          className="mail-composer__body mail-new-composer__body"
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          data-placeholder={t('mail.bodyPlaceholder', 'Écrivez votre message…')}
          onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) { e.preventDefault(); doSend(); } }}
        />
      </form>
    </div>
  );
}

function CloseComposerPopover({
  onSaveDraft,
  onDiscard,
}: {
  readonly onSaveDraft: () => void;
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
      <button type="button" className="btn-icon" onClick={() => setOpen(o => !o)}>
        <X size={16} />
      </button>
      {open && (
        <div className="close-composer-popover">
          <button
            type="button"
            className="close-composer-popover__option"
            onClick={() => { setOpen(false); onSaveDraft(); }}
          >
            {t('mail.saveDraft', 'Enregistrer le brouillon')}
          </button>
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
