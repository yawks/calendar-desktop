import { afterEach, describe, expect, it, vi } from 'vitest';
import { mailCommand } from './mailApi';

describe('mailCommand', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('uses a same-origin provider endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 'inbox' }]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(mailCommand('imap_list_folders', { accountId: 'a' })).resolves.toEqual([{ id: 'inbox' }]);
    expect(fetchMock).toHaveBeenCalledWith('/api/mail/commands/imap_list_folders', expect.objectContaining({ credentials: 'same-origin' }));
  });
});
