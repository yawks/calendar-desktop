import { beforeEach, expect, it, vi } from 'vitest';
import { ImapMailProvider } from './ImapMailProvider';
import { buildGmailQuery } from './GmailMailProvider';

const { mailCommand } = vi.hoisted(() => ({ mailCommand: vi.fn() }));
vi.mock('../../../shared/api/mailApi', () => ({ mailCommand }));
beforeEach(() => mailCommand.mockReset());

it.each(['Trash', 'trash', 'TRASH'])('keeps Gmail trash searches scoped: %s', folder => {
  expect(buildGmailQuery({ folder, text: 'Luiz' })).toBe('Luiz in:trash');
});

it('resolves the IMAP trash alias to the discovered trash folder', async () => {
  const provider = new ImapMailProvider({
    id: 'account', email: 'user@example.com', displayName: 'User',
    imapServer: 'imap.example.com', imapPort: 993, imapUseSsl: true,
    imapUseStarttls: false, imapUsername: 'user', imapPassword: '',
    smtpServer: 'smtp.example.com', smtpPort: 465, smtpUseSsl: true,
    smtpUseStarttls: false, smtpUsername: 'user', smtpPassword: '',
  });
  mailCommand.mockResolvedValueOnce([
    { folder_id: 'Deleted Messages', display_name: 'Trash' },
  ]);
  await provider.listFolders();
  mailCommand.mockResolvedValueOnce([]);
  await provider.searchThreads({ folder: 'Trash', text: 'Luiz' });
  expect(mailCommand).toHaveBeenLastCalledWith('imap_list_threads', expect.objectContaining({ folder: 'Deleted Messages' }));
});
