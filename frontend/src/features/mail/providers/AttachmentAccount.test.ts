import { afterEach, expect, it, vi } from 'vitest';
import { EwsMailProvider } from './EwsMailProvider';
import { GmailMailProvider } from './GmailMailProvider';
import { ImapMailProvider } from './ImapMailProvider';
import { JmapMailProvider } from './JmapMailProvider';
import type { MailAttachment } from '../types';
const { command } = vi.hoisted(() => ({ command: vi.fn(async () => 'aGVsbG8=') }));
vi.mock('../../../shared/api/mailApi', () => ({ mailCommand: command }));
afterEach(() => { command.mockClear(); vi.unstubAllGlobals(); });
const attachment: MailAttachment = { attachment_id: 'INBOX:42:1', name: 'file.docx', content_type: 'application/octet-stream', size: 5, is_inline: false };

it('uses the owning Exchange account token even with identical attachment IDs', async () => {
  const token = vi.fn(async (id: string) => `test-${id}`);
  for (const owner of ['account-a', 'account-b']) {
    await new EwsMailProvider(owner, token).getAttachmentData(attachment);
    expect(token).toHaveBeenLastCalledWith(owner);
    expect(command).toHaveBeenLastCalledWith('mail_get_attachment_data', { accessToken: `test-${owner}`, attachmentId: attachment.attachment_id });
  }
});
it('uses the owning Gmail account token', async () => {
  const request = vi.fn(async () => new Response(JSON.stringify({ data: 'aGVsbG8=' })));
  vi.stubGlobal('fetch', request);
  const token = vi.fn(async (id: string) => `test-${id}`);
  for (const owner of ['account-a', 'account-b']) {
    await new GmailMailProvider(owner, token).getAttachmentData({ ...attachment, attachment_id: 'message:blob' });
    expect(token).toHaveBeenLastCalledWith(owner);
    expect(request).toHaveBeenLastCalledWith('https://www.googleapis.com/gmail/v1/users/me/messages/message/attachments/blob', expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer test-${owner}` }) }));
  }
});
it('uses the owning IMAP configuration for identical folder/message/part IDs', async () => {
  for (const owner of ['account-a', 'account-b']) {
    await new ImapMailProvider({ id: owner, email: `${owner}@example.test`, displayName: owner, imapServer: 'imap.example.test', imapPort: 993, imapUseSsl: true, imapUseStarttls: false, imapUsername: owner, imapPassword: 'test-password', smtpServer: 'smtp.example.test', smtpPort: 465, smtpUseSsl: true, smtpUseStarttls: false, smtpUsername: owner, smtpPassword: 'test-password' }).getAttachmentData(attachment);
    expect(command).toHaveBeenLastCalledWith('imap_get_attachment_data', expect.objectContaining({ config: expect.objectContaining({ email: `${owner}@example.test`, imap_username: owner }), folder: 'INBOX', messageId: '42', attachmentId: '1' }));
  }
});
it('uses the owning JMAP configuration for identical blob IDs', async () => {
  for (const owner of ['account-a', 'account-b']) {
    await new JmapMailProvider({ id: owner, email: `${owner}@example.test`, displayName: owner, sessionUrl: 'https://example.test/jmap', token: `test-${owner}` }).getAttachmentData(attachment);
    expect(command).toHaveBeenLastCalledWith('jmap_get_attachment_data', expect.objectContaining({ config: expect.objectContaining({ email: `${owner}@example.test`, token: `test-${owner}` }), blobId: attachment.attachment_id }));
  }
});
