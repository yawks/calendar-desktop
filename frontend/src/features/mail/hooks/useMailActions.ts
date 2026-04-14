import { useCallback } from 'react';
import { MailMessage, MailAttachment } from '../types';
import { ComposerAttachment } from '../providers/MailProvider';
import { invoke } from '@tauri-apps/api/core';

export function useMailActions({
  setComposing,
  setReplyingTo,
  setSelectedThread,
  setComposerRestoreData,
  setComposingDraftItemId,

  resolveProvider,
  silentRefresh,
  setError,
  composingAccountId,
  composingDraftItemId,
  selectedThread,
  setToast,
}: any) {

  const onSend = useCallback(async (to: string[], cc: string[], bcc: string[], subject: string, body: string, attachments: ComposerAttachment[]) => {
    const p = resolveProvider(composingAccountId);
    if (!p) return;
    try {
      await p.sendMail({ to, cc, bcc, subject, bodyHtml: body, attachments });
      setComposing(false);
      if (composingDraftItemId) {
         // await p.deleteItems([composingDraftItemId.itemId], 'drafts');
      }
      silentRefresh();
    } catch (e: any) {
      setError(String(e));
    }
  }, [composingAccountId, resolveProvider, setComposing, composingDraftItemId, silentRefresh, setError]);

  const onSaveDraft = useCallback(async (to: string[], cc: string[], bcc: string[], subject: string, bodyHtml: string) => {
     const p = resolveProvider(composingAccountId);
     if (!p) return;
     try {
       await p.saveDraft({ to, cc, bcc, subject, bodyHtml });
     } catch (e) {
       console.error('Failed to save draft:', e);
     }
  }, [composingAccountId, resolveProvider]);

  const onDeleteDraft = useCallback(async () => {
    if (!composingDraftItemId) {
      setComposing(false);
      return;
    }
    const p = resolveProvider(composingDraftItemId.accountId);
    if (!p) return;
    try {
      setComposing(false);
      setComposingDraftItemId(null);
      silentRefresh();
    } catch (e: any) {
      setError(String(e));
    }
  }, [composingDraftItemId, resolveProvider, setComposing, setComposingDraftItemId, silentRefresh, setError]);

  const handleReply = useCallback((msg: MailMessage, all: boolean) => {
    setReplyingTo(msg);
    setComposerRestoreData({
      isNewMessage: false,
      recipients: all ? [msg.from_email, ...msg.to_recipients.map(r => r.email)].map(e => ({ email: e as string })) : [{ email: msg.from_email as string }],
      cc: all ? msg.cc_recipients.map(r => ({ email: r.email })) : [],
      bcc: [],
      subject: msg.subject.toLowerCase().startsWith('re:') ? msg.subject : `Re: ${msg.subject}`,
      bodyHtml: `<br><br><div class="gmail_quote">Le ${new Date(msg.date_time_received).toLocaleString()} ${msg.from_name} &lt;${msg.from_email}&gt; a écrit :<br><blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex">${msg.body_html}</blockquote></div>`,
      replyingToMsg: msg,
    });
    setComposing(true);
    setSelectedThread(null);
  }, [setReplyingTo, setComposerRestoreData, setComposing, setSelectedThread]);

  const handleForward = useCallback((msg: MailMessage) => {
    setComposerRestoreData({
      isNewMessage: true,
      recipients: [],
      cc: [],
      bcc: [],
      subject: msg.subject.toLowerCase().startsWith('fwd:') ? msg.subject : `Fwd: ${msg.subject}`,
      bodyHtml: `<br><br>---------- Forwarded message ---------<br>De : ${msg.from_name} &lt;${msg.from_email}&gt;<br>Date : ${new Date(msg.date_time_received).toLocaleString()}<br>Sujet : ${msg.subject}<br><br>${msg.body_html}`,
      replyingToMsg: null,
    });
    setComposing(true);
    setSelectedThread(null);
  }, [setComposerRestoreData, setComposing, setSelectedThread]);

  const downloadAttachment = useCallback(async (att: MailAttachment) => {
    const p = resolveProvider(selectedThread?.accountId);
    if (!p) return;
    try {
      const data = await p.getAttachmentData(att);
      const path = await invoke<string>('save_file_to_downloads', { filename: att.name, data });
      setToast({ message: `Fichier enregistré dans ${path}` });
      setTimeout(() => setToast(null), 5000);
    } catch (e: any) { setError(String(e)); }
  }, [resolveProvider, selectedThread, setError, setToast]);

  const getRawAttachmentData = useCallback(async (att: MailAttachment): Promise<string> => {
    const p = resolveProvider(selectedThread?.accountId);
    if (!p) throw new Error('Provider introuvable');
    return p.getAttachmentData(att);
  }, [resolveProvider, selectedThread]);

  return { onSend, onSaveDraft, onDeleteDraft, handleReply, handleForward, downloadAttachment, getRawAttachmentData };
}
