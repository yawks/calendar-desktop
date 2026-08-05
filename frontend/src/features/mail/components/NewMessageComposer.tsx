import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { FromAccount, MailIdentity, ComposerRestoreData } from '../types';
import { ComposerAttachment } from '../providers/MailProvider';
import { RecipientEntry, RecipientInput } from './RecipientInput';
import { ComposerAttachmentPanel } from './ComposerAttachmentPanel';
import { MailEditor, MailEditorHandle } from './MailEditor';
import { CloseComposerPopover } from './MailComposer';
import { IdentitySelector } from './IdentitySelector';
import { Paperclip, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSignatures, buildInitialHTMLWithSignature } from '../../../shared/store/SignatureStore';

export interface NewMessageComposerProps {
  readonly contacts: { email: string; name?: string }[];
  readonly provider?: import('../providers/MailProvider').MailProvider | null;
  readonly restoreData: ComposerRestoreData | null;
  readonly onSend: (to: string[], cc: string[], bcc: string[], subject: string, body: string, attachments: ComposerAttachment[], fromIdentityId: string | undefined, recipients: { to: RecipientEntry[]; cc: RecipientEntry[]; bcc: RecipientEntry[] }) => Promise<void>;
  readonly onCancel: () => void;
  readonly onSaveDraft: (to: string[], cc: string[], bcc: string[], subject: string, body: string) => void;
  readonly onDeleteDraft?: () => void;
  readonly fromAccounts: FromAccount[];
  readonly fromAccountId: string;
  readonly onFromAccountChange: (id: string) => void;
  /** JMAP identities — shown instead of fromAccounts when provided */
  readonly identities?: MailIdentity[];
  readonly selectedIdentityId?: string;
  readonly onIdentityChange?: (id: string) => void;
}

export interface NewMessageComposerHandle {
  hasChanges: () => boolean;
  getDraftData: () => { to: string[]; cc: string[]; bcc: string[]; subject: string; bodyHtml: string };
}

export const NewMessageComposer = forwardRef<NewMessageComposerHandle, NewMessageComposerProps>(function NewMessageComposer({
  contacts, provider, restoreData, onSend, onCancel, onSaveDraft, onDeleteDraft,
  fromAccounts, fromAccountId, onFromAccountChange,
  identities, selectedIdentityId, onIdentityChange,
}: NewMessageComposerProps, ref) {
  const { t } = useTranslation();
  const { getSignature, signaturePosition } = useSignatures();

  const [toRecipients,  setToRecipients]  = useState<RecipientEntry[]>(restoreData?.toRecipients ?? []);
  const [ccRecipients,  setCcRecipients]  = useState<RecipientEntry[]>(restoreData?.ccRecipients ?? []);
  const [bccRecipients, setBccRecipients] = useState<RecipientEntry[]>(restoreData?.bccRecipients ?? []);
  const [showCc,  setShowCc]  = useState(restoreData?.showCc ?? false);
  const [showBcc, setShowBcc] = useState(restoreData?.showBcc ?? false);
  const [subject, setSubject] = useState(restoreData?.subject ?? '');
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>(restoreData?.attachments ?? []);
  const fieldsModifiedRef = useRef(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef    = useRef<MailEditorHandle>(null);

  // Capture initial identity + signature at mount (useMemo has empty deps)
  const initialIdentityId = selectedIdentityId ?? identities?.[0]?.id ?? fromAccountId ?? '';
  const initialSignatureRef = useRef(initialIdentityId ? getSignature(initialIdentityId) : '');
  const initialPositionRef  = useRef(signaturePosition);

  // Initial body HTML — with signature baked in (evaluated once on mount)
  const initialHTML = useMemo(() => {
    if (restoreData?.body) return restoreData.body;
    return buildInitialHTMLWithSignature('', initialSignatureRef.current, initialPositionRef.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Swap signature when the selected identity changes mid-composition
  const prevIdentityIdRef = useRef(initialIdentityId);
  useEffect(() => {
    const newId = selectedIdentityId ?? identities?.[0]?.id ?? fromAccountId ?? '';
    if (newId === prevIdentityIdRef.current) return;
    prevIdentityIdRef.current = newId;
    editorRef.current?.replaceSignatureBlock(getSignature(newId), signaturePosition);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdentityId, identities, fromAccountId]);

  useImperativeHandle(ref, () => ({
    hasChanges: () => (
      fieldsModifiedRef.current || (editorRef.current?.isModified() ?? false)
    ),
    getDraftData: () => ({
      to: toRecipients.map(r => r.email),
      cc: ccRecipients.map(r => r.email),
      bcc: bccRecipients.map(r => r.email),
      subject,
      bodyHtml: editorRef.current?.getHTML() ?? '',
    }),
  }), [toRecipients, ccRecipients, bccRecipients, subject]);

  const markFieldsModified = <T,>(setter: React.Dispatch<React.SetStateAction<T>>) =>
    (value: React.SetStateAction<T>) => {
      fieldsModifiedRef.current = true;
      setter(value);
    };

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
        selectedIdentityId,
        { to: toRecipients, cc: ccRecipients, bcc: bccRecipients },
      );
    } finally {
      setSending(false);
    }
  };

  const handleClose = () => {
    const bodyHtml   = editorRef.current?.getHTML() ?? '';
    const hasContent = toRecipients.length > 0 || ccRecipients.length > 0 || bccRecipients.length > 0 || subject.trim() || bodyHtml.trim();
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

  const handleRecipientDrop = (targetField: 'to' | 'cc' | 'bcc') => (
    entry: RecipientEntry,
    sourceField: string,
  ) => {
    if (sourceField === targetField || !['to', 'cc', 'bcc'].includes(sourceField)) return;

    const removeFromSource = (recipients: RecipientEntry[]) =>
      recipients.filter(recipient => recipient.email.toLowerCase() !== entry.email.toLowerCase());
    const addToTarget = (recipients: RecipientEntry[]) =>
      recipients.some(recipient => recipient.email.toLowerCase() === entry.email.toLowerCase())
        ? recipients
        : [...recipients, entry];

    fieldsModifiedRef.current = true;
    if (sourceField === 'to') setToRecipients(removeFromSource);
    if (sourceField === 'cc') setCcRecipients(removeFromSource);
    if (sourceField === 'bcc') setBccRecipients(removeFromSource);

    if (targetField === 'to') setToRecipients(addToTarget);
    if (targetField === 'cc') setCcRecipients(addToTarget);
    if (targetField === 'bcc') setBccRecipients(addToTarget);
  };

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

        {/* ── From: identities (JMAP / all accounts) ── */}
        {identities && identities.length >= 1 && (
          <div className="mail-composer__field">
            <IdentitySelector
              label={t('mail.from', 'De')}
              identities={identities}
              selectedIdentityId={selectedIdentityId}
              onSelect={(id) => onIdentityChange?.(id)}
            />
          </div>
        )}

        {/* ── From: multi-account (non-JMAP) ── */}
        {(!identities || identities.length === 0) && fromAccounts.length > 1 && (
          <div className="mail-composer__field">
            <IdentitySelector
              label={t('mail.from', 'De')}
              identities={fromAccounts.map(a => ({
                id: a.id,
                email: a.email,
                name: a.name ?? a.email,
                accountColor: a.color ?? undefined,
                mayDelete: false,
              }))}
              selectedIdentityId={fromAccountId}
              onSelect={onFromAccountChange}
            />
          </div>
        )}

        {/* ── To ── */}
        <div className="mail-composer__field">
          <span className="mail-composer__label">{t('mail.to', 'À')}</span>
          <RecipientInput value={toRecipients} onChange={markFieldsModified(setToRecipients)} contacts={contacts} provider={provider} fieldId="to" onDropFromOtherField={handleRecipientDrop('to')} />
          {!showCc  && <button type="button" className="mail-composer__cc-btn" onClick={() => setShowCc(true)}>Cc</button>}
          {!showBcc && <button type="button" className="mail-composer__cc-btn" onClick={() => setShowBcc(true)}>Bcc</button>}
        </div>

        {showCc && (
          <div className="mail-composer__field">
            <span className="mail-composer__label">{t('mail.cc', 'Cc')}</span>
            <RecipientInput value={ccRecipients} onChange={markFieldsModified(setCcRecipients)} contacts={contacts} provider={provider} fieldId="cc" onDropFromOtherField={handleRecipientDrop('cc')} />
          </div>
        )}

        {showBcc && (
          <div className="mail-composer__field">
            <span className="mail-composer__label">Bcc:</span>
            <RecipientInput value={bccRecipients} onChange={markFieldsModified(setBccRecipients)} contacts={contacts} provider={provider} fieldId="bcc" onDropFromOtherField={handleRecipientDrop('bcc')} />
          </div>
        )}

        {/* ── Subject ── */}
        <div className="mail-composer__field">
          <span className="mail-composer__label">{t('mail.subject', 'Objet')}</span>
          <input
            className="mail-composer__input"
            type="text"
            value={subject}
            onChange={e => { fieldsModifiedRef.current = true; setSubject(e.target.value); }}
            placeholder={t('mail.subjectPlaceholder', 'Objet')}
            spellCheck={false}
          />
        </div>

        {/* ── Attachments (above formatting toolbar) ── */}
        <ComposerAttachmentPanel
          attachments={attachments}
          onRemove={i => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
        />

        {/* ── Tiptap editor (toolbar + body) ── */}
        <MailEditor
          ref={editorRef}
          initialHTML={initialHTML}
          placeholder={t('mail.bodyPlaceholder', 'Écrivez votre message…')}
          onSend={doSend}
        />
      </form>
    </div>
  );
});
