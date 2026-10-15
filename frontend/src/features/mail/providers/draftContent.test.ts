import { afterEach, expect, it, vi } from 'vitest';
import type { ImapAccount } from '../../../shared/types';

const { mailCommand } = vi.hoisted(() => ({ mailCommand: vi.fn() }));
vi.mock('../../../shared/api/mailApi', () => ({ mailCommand }));

import { GmailMailProvider } from './GmailMailProvider';
import { ImapMailProvider } from './ImapMailProvider';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); mailCommand.mockReset(); });

for (const kind of ['gmail', 'imap'] as const) {
  it.each([true, false])(`${kind} loads the body before returning a draft: %s`, async isDraft => {
    const provider = kind === 'gmail'
      ? new GmailMailProvider('account', async () => 'token')
      : new ImapMailProvider({ id: 'account' } as ImapAccount);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ messages: [{ id: 'message', payload: { headers: [] } }] }),
    })));
    mailCommand.mockResolvedValue([{ item_id: '42', body_html: '' }]);
    const content = { body_html: '<p>Saved draft</p>', body_text: 'Saved draft', ics_mime: undefined, attachments: [], has_attachments: false };
    const loadContent = vi.spyOn(provider, 'getMessageContent').mockResolvedValue(content);
    const conversationId = kind === 'gmail' ? 'thread' : 'Drafts:42';

    const messages = await provider.getThread(conversationId, false, isDraft);

    expect(messages).toHaveLength(1);
    expect(messages[0].body_loaded).toBe(isDraft);
    if (isDraft) {
      expect(loadContent).toHaveBeenCalledWith(kind === 'gmail' ? 'message' : 'Drafts:42');
      expect(messages[0]).toMatchObject(content);
    } else {
      expect(loadContent).not.toHaveBeenCalled();
    }
  });

  it(`${kind} reports a draft body failure instead of opening an empty editor`, async () => {
    const provider = kind === 'gmail'
      ? new GmailMailProvider('account', async () => 'token')
      : new ImapMailProvider({ id: 'account' } as ImapAccount);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ messages: [{ id: 'message', payload: { headers: [] } }] }) })));
    mailCommand.mockResolvedValue([{ item_id: '42', body_html: '' }]);
    vi.spyOn(provider, 'getMessageContent').mockRejectedValue(new Error('Body unavailable'));

    await expect(provider.getThread(kind === 'gmail' ? 'thread' : 'Drafts:42', false, true)).rejects.toThrow('Body unavailable');
  });
}
