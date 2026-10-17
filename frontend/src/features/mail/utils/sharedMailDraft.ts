import type { AndroidShare } from '../../../shared/platform/nativeAndroid';
import type { ComposerRestoreData } from '../types';

export function sharedMailDraft(share: Omit<AndroidShare, 'id'>): ComposerRestoreData {
  const text = share.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return {
    toRecipients: [], ccRecipients: [], bccRecipients: [],
    subject: share.subject, body: text ? `<p>${text.replace(/\r\n?|\n/g, '<br>')}</p>` : '',
    attachments: share.attachments, showCc: false, showBcc: false,
    isNewMessage: true, isShared: true, replyingToMsg: null,
  };
}
