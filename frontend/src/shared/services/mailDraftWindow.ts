import type { ComposerRestoreData } from '../../features/mail/types';
import { openAppWindow } from './windowService';

const CHANNEL = 'courrier-mail-draft';
type Message = { type: 'ready' | 'probe' } | { type: 'draft'; id: string; draft: ComposerRestoreData } | { type: 'received'; id: string };

export function receiveMailDrafts(onDraft: (draft: ComposerRestoreData) => void): () => void {
  const channel = new BroadcastChannel(CHANNEL);
  const received = new Set<string>();
  channel.onmessage = ({ data }: MessageEvent<Message>) => {
    if (data.type === 'probe') channel.postMessage({ type: 'ready' });
    if (data.type === 'draft') {
      if (!received.has(data.id)) {
        received.add(data.id);
        onDraft(data.draft);
      }
      channel.postMessage({ type: 'received', id: data.id });
    }
  };
  channel.postMessage({ type: 'ready' });
  return () => channel.close();
}

export async function openMailDraftWindow(draft: ComposerRestoreData): Promise<void> {
  const channel = new BroadcastChannel(CHANNEL);
  const id = crypto.randomUUID();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sent = false;
  try {
    const delivered = new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Mail window unavailable')), 60_000);
      channel.onmessage = ({ data }: MessageEvent<Message>) => {
        if (data.type === 'ready' && !sent) {
          sent = true;
          channel.postMessage({ type: 'draft', id, draft });
        }
        if (data.type === 'received' && data.id === id) resolve();
      };
    });
    // Attach rejection handling before opening a window, which may itself fail.
    const opening = openAppWindow('/', 'courrier-main');
    await Promise.all([opening.then(() => channel.postMessage({ type: 'probe' })), delivered]);
  } finally {
    clearTimeout(timer);
    channel.close();
  }
}
