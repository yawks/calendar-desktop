import { afterEach, expect, it, vi } from 'vitest';
import { openMailDraftWindow, receiveMailDrafts } from './mailDraftWindow';
import type { ComposerRestoreData } from '../../features/mail/types';
const f = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('./windowService', () => ({ openAppWindow: f.open }));
const channels = new Set<FakeChannel>();
class FakeChannel {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  constructor(readonly name: string) { channels.add(this); }
  postMessage(data: unknown) {
    for (const channel of channels) if (channel !== this && channel.name === this.name) {
      queueMicrotask(() => { if (channels.has(channel)) channel.onmessage?.({ data }); });
    }
  }
  close() { channels.delete(this); }
}
const draft = { fromAccountId: 'account', toRecipients: [{ email: 'organizer@example.test' }], ccRecipients: [{ email: 'guest@example.test' }], initialFocus: 'subject' } as ComposerRestoreData;
afterEach(() => { channels.clear(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it.each([true, false])('delivers exactly once to a %s existing mail window without exposing draft data in its URL', async existing => {
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  const received = vi.fn();
  let stop = existing ? receiveMailDrafts(received) : () => {};
  f.open.mockImplementation(async () => { if (!existing) stop = receiveMailDrafts(received); return null; });
  await openMailDraftWindow(draft);
  expect(f.open).toHaveBeenLastCalledWith('/', 'courrier-main');
  expect(received).toHaveBeenCalledOnce();
  expect(received).toHaveBeenCalledWith(draft);
  stop();
  expect(channels.size).toBe(0);
});
it('cleans up and reports failure if opening the mail window fails', async () => {
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  f.open.mockRejectedValueOnce(new Error('Window unavailable'));
  await expect(openMailDraftWindow(draft)).rejects.toThrow('Window unavailable');
  expect(channels.size).toBe(0);
});
it('reports a locked or unresponsive window without leaving a channel open', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  f.open.mockResolvedValueOnce(null);
  const delivered = expect(openMailDraftWindow(draft)).rejects.toThrow('Mail window unavailable');
  await vi.advanceTimersByTimeAsync(60_000);
  await delivered;
  expect(channels.size).toBe(0);
});
