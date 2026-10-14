import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mailCommand } = vi.hoisted(() => ({ mailCommand: vi.fn() }));

vi.mock('../../../shared/api/mailApi', () => ({ mailCommand }));

import { EwsMailProvider } from './EwsMailProvider';

describe('EwsMailProvider', () => {
  beforeEach(() => mailCommand.mockReset());

  it('moves each Exchange item once even when conversation envelopes repeat it', async () => {
    mailCommand.mockImplementation(async (command: string) => {
      if (command === 'mail_get_thread_headers') return [{ item_id: 'first' }, { item_id: 'first' }, { item_id: 'second' }];
    });
    const provider = new EwsMailProvider('account', async () => 'token');

    await provider.bulkMoveToFolder(['conversation', 'conversation'], 'archive-folder');

    expect(mailCommand).toHaveBeenCalledWith('mail_bulk_move_to_folder', {
      accessToken: 'token', itemIds: ['first', 'second'], folderId: 'archive-folder',
    });
    expect(mailCommand.mock.calls.filter(([command]) => command === 'mail_bulk_move_to_folder')).toHaveLength(1);
  });

  it('reports a header lookup failure instead of claiming the move succeeded', async () => {
    mailCommand.mockRejectedValueOnce(new Error('ErrorItemNotFound: Item not found.'));
    const provider = new EwsMailProvider('account', async () => 'token');

    await expect(provider.bulkMoveToFolder(['conversation'], 'archive-folder')).rejects.toThrow('ErrorItemNotFound');
    expect(mailCommand).not.toHaveBeenCalledWith('mail_bulk_move_to_folder', expect.anything());
  });

  it('loads the complete draft before opening the editor', async () => {
    const draft = { item_id: 'draft-item', body_html: '<p>Saved draft text</p>', attachments: [{ id: 'attachment' }] };
    mailCommand.mockResolvedValueOnce([draft]);
    const provider = new EwsMailProvider('account', async () => 'token');

    const messages = await provider.getThread('draft-item', false, true);

    expect(mailCommand).toHaveBeenCalledOnce();
    expect(mailCommand).toHaveBeenCalledWith('mail_get_thread', {
      accessToken: 'token', conversationId: 'draft-item', includeTrash: false,
      isDraft: true, includeDrafts: false,
    });
    expect(messages).toEqual([{ ...draft, body_loaded: true }]);
  });

  it('loads thread envelopes without downloading every message body', async () => {
    mailCommand.mockResolvedValueOnce([
      { item_id: 'older', body_html: '', subject: 'Thread' },
      { item_id: 'newer', body_html: '', subject: 'Thread' },
    ]);
    const provider = new EwsMailProvider('account', async () => 'token');

    const messages = await provider.getThread('conversation', false, false, true);

    expect(mailCommand).toHaveBeenCalledWith('mail_get_thread_headers', {
      accessToken: 'token',
      conversationId: 'conversation',
      includeTrash: false,
      isDraft: false,
      includeDrafts: true,
    });
    expect(messages).toEqual([
      expect.objectContaining({ item_id: 'older', body_loaded: false }),
      expect.objectContaining({ item_id: 'newer', body_loaded: false }),
    ]);
  });
});
