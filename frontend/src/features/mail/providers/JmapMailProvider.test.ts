import { beforeEach, expect, it, vi } from 'vitest';

const { mailCommand } = vi.hoisted(() => ({ mailCommand: vi.fn() }));
vi.mock('../../../shared/api/mailApi', () => ({ mailCommand }));

import { JmapMailProvider } from './JmapMailProvider';

beforeEach(() => mailCommand.mockReset());

it.each([true, false])('requests message bodies only when opening a draft: %s', async isDraft => {
  const provider = new JmapMailProvider({
    id: 'account', email: 'sender@example.com', displayName: 'Sender',
    sessionUrl: 'https://example.com/jmap/session', token: 'test-token',
  });
  const message = { item_id: 'draft', body_html: isDraft ? '<p>Saved content</p>' : '' };
  mailCommand.mockResolvedValueOnce([message]);

  const messages = await provider.getThread('thread', false, isDraft);

  expect(mailCommand).toHaveBeenCalledOnce();
  expect(mailCommand).toHaveBeenCalledWith('jmap_get_thread', {
    config: expect.objectContaining({ load_message_bodies: isDraft }),
    conversationId: 'thread',
  });
  expect(messages).toEqual([{ ...message, body_loaded: isDraft }]);
});
