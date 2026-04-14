import React, { RefObject, useEffect, useRef, useState } from 'react';
import { MailMessage, ComposerRestoreData } from '../types';
import {
  Bold, Italic, List, ListOrdered, Paperclip, Send, Trash2, Underline, X
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ComposerAttachment } from '../providers/MailProvider';
import { RecipientEntry, RecipientInput } from './RecipientInput';
import { ComposerAttachmentPanel } from './ComposerAttachmentPanel';

export interface MailComposerProps {
  readonly replyTo?: MailMessage;
  readonly mode?: 'reply' | 'replyAll' | 'forward';
  readonly contacts: { email: string; name?: string }[];
  readonly currentUserEmail?: string;
  readonly restoreData?: ComposerRestoreData | null;
  readonly onSend: (to: string[], cc: string[], bcc: string[], subject: string, body: string, attachments: ComposerAttachment[]) => Promise<void>;
  readonly onCancel: () => void;
  readonly onSaveDraft?: (to: string[], cc: string[], bcc: string[], subject: string, body: string) => void;
}

export function MailComposer({ replyTo, mode, contacts, currentUserEmail, restoreData, onSend, onCancel, onSaveDraft }: MailComposerProps) {
  const { t } = useTranslation();
  const [toRecipients, setToRecipients] = useState<RecipientEntry[]>([]);
  const [ccRecipients, setCcRecipients] = useState<RecipientEntry[]>([]);
  const [bccRecipients, setBccRecipients] = useState<RecipientEntry[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState('');
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    if (restoreData) {
      setToRecipients(restoreData.toRecipients);
      setCcRecipients(restoreData.ccRecipients);
      setBccRecipients(restoreData.bccRecipients);
      setSubject(restoreData.subject);
      setAttachments(restoreData.attachments);
      setShowCc(restoreData.showCc);
      setShowBcc(restoreData.showBcc);
      if (bodyRef.current) bodyRef.current.innerHTML = restoreData.body;
    } else if (replyTo && mode) {
      const to: RecipientEntry[] = [];
      const cc: RecipientEntry[] = [];

      if (mode === 'forward') {
        setSubject(`Fwd: ${replyTo.subject}`);
      } else {
        setSubject(`Re: ${replyTo.subject}`);
        to.push({ email: replyTo.from_email || '', name: replyTo.from_name || undefined });

        if (mode === 'replyAll') {
          const others = [...(replyTo.to_recipients || []), ...(replyTo.cc_recipients || [])]
            .filter(r => r.email !== currentUserEmail && r.email !== replyTo.from_email);
          cc.push(...others.map(r => ({ email: r.email, name: r.name || undefined })));
        }
      }
      setToRecipients(to);
      setCcRecipients(cc);
      setShowCc(cc.length > 0);
    }
  }, [replyTo, mode, currentUserEmail, restoreData]);

  const handleSend = async () => {
    setIsSending(true);
    try {
      await onSend(
        toRecipients.map(r => r.email),
        ccRecipients.map(r => r.email),
        bccRecipients.map(r => r.email),
        subject,
        bodyRef.current?.innerHTML || '',
        attachments
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newAttachments: ComposerAttachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();
      const content = await new Promise<string>((resolve) => {
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(file);
      });
      newAttachments.push({
        name: file.name,
        contentType: file.type,
        data: content,
        size: file.size
      });
    }
    setAttachments([...attachments, ...newAttachments]);
  };

  return (
    <div className="mail-composer">
      <div className="mail-composer__header">
        <div className="mail-composer__field">
          <span className="mail-composer__label">{t('mail.to', 'À')}</span>
          <RecipientInput
            value={toRecipients}
            onChange={setToRecipients}
            contacts={contacts}
            fieldId="to"
          />
          <div className="mail-composer__field-actions">
            {!showCc && <button onClick={() => setShowCc(true)}>Cc</button>}
            {!showBcc && <button onClick={() => setShowBcc(true)}>Bcc</button>}
          </div>
        </div>

        {showCc && (
          <div className="mail-composer__field">
            <span className="mail-composer__label">{t('mail.cc', 'Cc')}</span>
            <RecipientInput
              value={ccRecipients}
              onChange={setCcRecipients}
              contacts={contacts}
              fieldId="cc"
            />
            <button className="mail-composer__field-remove" onClick={() => setShowCc(false)}><X size={14}/></button>
          </div>
        )}

        {showBcc && (
          <div className="mail-composer__field">
            <span className="mail-composer__label">Bcc</span>
            <RecipientInput
              value={bccRecipients}
              onChange={setBccRecipients}
              contacts={contacts}
              fieldId="bcc"
            />
            <button className="mail-composer__field-remove" onClick={() => setShowBcc(false)}><X size={14}/></button>
          </div>
        )}

        <div className="mail-composer__field">
          <input
            type="text"
            className="mail-composer__subject-input"
            placeholder={t('mail.subject', 'Objet')}
            value={subject}
            onChange={e => setSubject(e.target.value)}
          />
        </div>
      </div>

      <FormattingToolbar bodyRef={bodyRef} />

      <div
        ref={bodyRef}
        className="mail-composer__body"
        contentEditable
        onBlur={() => onSaveDraft?.(
          toRecipients.map(r => r.email),
          ccRecipients.map(r => r.email),
          bccRecipients.map(r => r.email),
          subject,
          bodyRef.current?.innerHTML || ''
        )}
      />

      {attachments.length > 0 && (
        <ComposerAttachmentPanel
          attachments={attachments}
          onRemove={(idx) => setAttachments(attachments.filter((_, i) => i !== idx))}
        />
      )}

      <div className="mail-composer__footer">
        <div className="mail-composer__footer-left">
          <button
            className="mail-composer__send-btn"
            onClick={handleSend}
            disabled={isSending || toRecipients.length === 0}
          >
            <Send size={16} />
            <span>{isSending ? t('mail.sending', 'Envoi...') : t('mail.send', 'Envoyer')}</span>
          </button>
          <label className="mail-composer__attach-btn">
            <Paperclip size={18} />
            <input type="file" multiple onChange={handleFileChange} style={{ display: 'none' }} />
          </label>
        </div>
        <button className="mail-composer__cancel-btn" onClick={onCancel}>
          <Trash2 size={18} />
        </button>
      </div>
    </div>
  );
}

function FormattingToolbar({ bodyRef }: { readonly bodyRef: RefObject<HTMLDivElement> }) {
  const exec = (cmd: string, val?: string) => {
    document.execCommand(cmd, false, val);
    bodyRef.current?.focus();
  };

  return (
    <div className="mail-composer__toolbar">
      <button onClick={() => exec('bold')} title="Gras"><Bold size={16} /></button>
      <button onClick={() => exec('italic')} title="Italique"><Italic size={16} /></button>
      <button onClick={() => exec('underline')} title="Souligné"><Underline size={16} /></button>
      <div className="mail-composer__toolbar-sep" />
      <button onClick={() => exec('insertUnorderedList')} title="Liste à puces"><List size={16} /></button>
      <button onClick={() => exec('insertOrderedList')} title="Liste numérotée"><ListOrdered size={16} /></button>
    </div>
  );
}
