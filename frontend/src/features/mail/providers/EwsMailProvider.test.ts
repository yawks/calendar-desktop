import { describe, expect, it, vi } from 'vitest';

const { mailCommand } = vi.hoisted(() => ({ mailCommand: vi.fn() }));

vi.mock('../../../shared/api/mailApi', () => ({ mailCommand }));

import { EwsMailProvider } from './EwsMailProvider';

describe('EwsMailProvider', () => {
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
