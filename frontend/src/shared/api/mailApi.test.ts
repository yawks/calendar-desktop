import { afterEach, describe, expect, it, vi } from 'vitest';
import { mailCommand } from './mailApi';
import { hasNativeTransport, invokeNative } from './nativeTransport';

vi.mock('./nativeTransport', () => ({ hasNativeTransport: vi.fn(() => false), invokeNative: vi.fn() }));

describe('mailCommand', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(hasNativeTransport).mockReturnValue(false);
    vi.mocked(invokeNative).mockReset();
  });
  for (const native of [false, true]) {
    it(`identifies a missing item operation on ${native ? 'native' : 'web'} without including arguments`, async () => {
      const message = 'ErrorItemNotFound: Item not found.';
      vi.mocked(hasNativeTransport).mockReturnValue(native);
      vi.mocked(invokeNative).mockRejectedValue(message);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: message }), { status: 500 })));
      await expect(mailCommand('mail_mark_read', { accessToken: 'secret-token', itemId: 'private-id' }))
        .rejects.toThrow('[mail_mark_read] ErrorItemNotFound: Item not found.');
    });
  }
  it('preserves other errors', async () => {
    const error = new Error('Network unavailable');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));
    await expect(mailCommand('mail_move_to_folder', {})).rejects.toBe(error);
  });
  it('uses a same-origin provider endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 'inbox' }]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(mailCommand('imap_list_folders', { accountId: 'a' })).resolves.toEqual([{ id: 'inbox' }]);
    expect(fetchMock).toHaveBeenCalledWith('/api/mail/commands/imap_list_folders', expect.objectContaining({ credentials: 'same-origin' }));
  });
});
