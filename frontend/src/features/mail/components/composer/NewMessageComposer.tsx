import { Paperclip, Send } from 'lucide-react';
import { useState, useRef, useEffect, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { RecipientEntry, RecipientInput } from '../RecipientInput';
import { ComposerAttachment, readFilesAsBase64 } from '../../providers/MailProvider';
import { ComposerRestoreData } from '../../composerTypes';
import { CloseComposerPopover } from './CloseComposerPopover';
import { FromAccountSelector } from './FromAccountSelector';
import { FormattingToolbar } from './FormattingToolbar';
import { ComposerAttachmentPanel } from './ComposerAttachmentPanel';
import { handleImagePaste } from '../../utils';

interface NewMessageComposerProps {
  readonly contacts: { email: string; name?: string }[];
  readonly restoreData?: ComposerRestoreData | null;
  readonly onSend: (to: string[], cc: string[], bcc: string[], subject: string, body: string, attachments: ComposerAttachment[]) => Promise<void>;
  readonly onCancel: () => void;
  readonly onSaveDraft?: (to: string[], cc: string[], bcc: string[], subject: string, bodyHtml: string) => void;
  readonly onDeleteDraft?: () => Promise<void>;
  readonly fromAccounts?: { id: string; email: string; name?: string; color?: string }[];
  readonly fromAccountId?: string;
  readonly onFromAccountChange?: (id: string) => void;
}

export function NewMessageComposer({ contacts, restoreData, onSend, onCancel, onSaveDraft, onDeleteDraft, fromAccounts, fromAccountId, onFromAccountChange }: NewMessageComposerProps) {
  const { t } = useTranslation();
  const [recipients, setRecipients] = useState<RecipientEntry[]>(restoreData?.recipients ?? []);
  const [ccRecipients, setCcRecipients] = useState<RecipientEntry[]>(restoreData?.cc ?? []);
  const [bccRecipients, setBccRecipients] = useState<RecipientEntry[]>(restoreData?.bcc ?? []);
  const [showCc, setShowCc] = useState((restoreData?.cc?.length ?? 0) > 0);
  const [showBcc, setShowBcc] = useState((restoreData?.bcc?.length ?? 0) > 0);
  const [subject, setSubject] = useState(restoreData?.subject ?? '');
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (restoreData?.bodyHtml && bodyRef.current) {
      bodyRef.current.innerHTML = restoreData.bodyHtml;
    }
  }, [restoreData]);

  const handleAttachFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    const newAtts = await readFilesAsBase64(e.target.files);
    setAttachments(prev => [...prev, ...newAtts]);
    e.target.value = '';
  };

  const handleTransferRecipient = (entry: RecipientEntry, fromField: string, toField: string) => {
    const remove = (set: RecipientEntry[], setter: React.Dispatch<React.SetStateAction<RecipientEntry[]>>) =>
      setter(set.filter(r => r.email.toLowerCase() !== entry.email.toLowerCase()));
    const add = (set: RecipientEntry[], setter: React.Dispatch<React.SetStateAction<RecipientEntry[]>>) => {
      if (!set.some(r => r.email.toLowerCase() === entry.email.toLowerCase()))
        setter([...set, entry]);
    };
    if (fromField === 'to') remove(recipients, setRecipients);
    if (fromField === 'cc') remove(ccRecipients, setCcRecipients);
    if (fromField === 'bcc') remove(bccRecipients, setBccRecipients);
    if (toField === 'to') add(recipients, setRecipients);
    if (toField === 'cc') { setShowCc(true); add(ccRecipients, setCcRecipients); }
    if (toField === 'bcc') { setShowBcc(true); add(bccRecipients, setBccRecipients); }
  };

  const doSend = async () => {
    if (recipients.length === 0) return;
    const bodyHtml = bodyRef.current?.innerHTML ?? '';
    setSending(true);
    try { await onSend(recipients.map(r => r.email), ccRecipients.map(r => r.email), bccRecipients.map(r => r.email), subject, bodyHtml, attachments); }
    finally { setSending(false); }
  };
  const handleSubmit = async (e: FormEvent) => { e.preventDefault(); doSend(); };

  const handleClose = () => {
    if (onSaveDraft) {
      const bodyHtml = bodyRef.current?.innerHTML ?? '';
      const hasContent = recipients.length > 0 || subject.trim().length > 0 || bodyHtml.trim().length > 0;
      if (hasContent) {
        onSaveDraft(
          recipients.map(r => r.email),
          ccRecipients.map(r => r.email),
          bccRecipients.map(r => r.email),
          subject,
          bodyHtml,
        );
      }
    }
    onCancel();
  };

  return (
    <div className="mail-new-composer">
      <form className="mail-new-composer__form" onSubmit={handleSubmit}
        onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) { e.preventDefault(); doSend(); } }}>
        <div className="mail-new-composer__toolbar">
          <button type="submit" className="btn-primary" disabled={sending || recipients.length === 0}>
            <Send size={15} />
            {sending ? t('mail.sending', 'Sending…') : t('mail.send', 'Send')}
          </button>
          <button type="button" className="btn-secondary" onClick={() => fileInputRef.current?.click()}>
            <Paperclip size={15} />
            {t('mail.attach', 'Joindre')}
          </button>
          <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleAttachFiles} />
          <div style={{ flex: 1 }} />
          <CloseComposerPopover onSaveDraft={handleClose} onDiscard={onDeleteDraft ?? onCancel} />
        </div>
        {fromAccounts && fromAccounts.length > 1 && (
          <FromAccountSelector
            accounts={fromAccounts}
            selectedId={fromAccountId ?? ''}
            onChange={id => onFromAccountChange?.(id)}
            label={t('mail.from', 'From')}
          />
        )}
        <div className="mail-composer__field">
          <span className="mail-composer__label">{t('mail.to', 'To')}</span>
          <RecipientInput
            value={recipients}
            onChange={setRecipients}
            contacts={contacts}
            autoFocus
            fieldId="to"
            onDropFromOtherField={(entry, from) => handleTransferRecipient(entry, from, 'to')}
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
            <RecipientInput
              value={ccRecipients}
              onChange={setCcRecipients}
              contacts={contacts}
              fieldId="cc"
              onDropFromOtherField={(entry, from) => handleTransferRecipient(entry, from, 'cc')}
            />
          </div>
        )}
        {showBcc && (
          <div className="mail-composer__field">
            <span className="mail-composer__label">Bcc:</span>
            <RecipientInput
              value={bccRecipients}
              onChange={setBccRecipients}
              contacts={contacts}
              fieldId="bcc"
              onDropFromOtherField={(entry, from) => handleTransferRecipient(entry, from, 'bcc')}
            />
          </div>
        )}
        <div className="mail-composer__field">
          <span className="mail-composer__label">{t('mail.subject', 'Subject')}</span>
          <input
            className="mail-composer__input"
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder={t('mail.subjectPlaceholder', 'Objet')}
            spellCheck={false}
            onKeyDown={e => { if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); bodyRef.current?.focus(); } }}
          />
        </div>
        <FormattingToolbar bodyRef={bodyRef} />
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
          onPaste={handleImagePaste}
        />
      </form>
    </div>
  );
}
