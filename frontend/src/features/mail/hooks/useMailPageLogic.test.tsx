// @vitest-environment jsdom
import { act, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { useMailPageLogic } from './useMailPageLogic';
import type { ComposerRestoreData } from '../types';
const f = vi.hoisted(() => ({ accounts: [{ id: 'account', email: 'sender@example.com', displayName: 'Sender' }], empty: [], conversation: vi.fn(), send: vi.fn(), trash: vi.fn(), remove: vi.fn(), move: vi.fn(), snooze: vi.fn(), query: { data: [], errors: [], refetch: vi.fn() }, folders: { allAccountFolders: new Map(), allModeDynamicFolders: [], mergedCounts: {}, errors: [] }, t: (key: string) => key }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: f.t }) }));
vi.mock('../../../shared/store/ExchangeAuthStore', () => ({ useExchangeAuth: () => ({ accounts: f.accounts, getValidToken: f.t }) }));
vi.mock('../../../shared/store/GoogleAuthStore', () => ({ useGoogleAuth: () => ({ accounts: f.empty }) }));
vi.mock('../../../shared/store/ImapAuthStore', () => ({ useImapAuth: () => ({ accounts: f.empty }) }));
vi.mock('../../../shared/store/JmapAuthStore', () => ({ useJmapAuth: () => ({ accounts: f.empty }) }));
vi.mock('../../../shared/store/ThemeStore', () => ({ useTheme: () => ({ preference: 'light', setPreference: vi.fn() }) }));
vi.mock('../../../shared/store/OfflineMailStore', () => ({ useOfflineMailSettings: () => ({ settings: { enabled: false } }) }));
vi.mock('./useOfflineMailSync', () => ({ useOfflineMailSync: () => ({ synchronize: vi.fn() }) }));
vi.mock('./useContactBackfill', () => ({ useContactBackfill: () => ({}) }));
vi.mock('./useContactSuggestions', () => ({ useContactSuggestions: () => f.empty }));
vi.mock('../utils/contactIndex', () => ({ cleanupContactIndex: async () => 0, recordContactObservations: async () => {}, searchContactIndex: async () => [] }));
vi.mock('../providers/EwsMailProvider', () => ({ EwsMailProvider: class { providerType = 'ews'; capabilities = {}; moveToTrash = f.trash; } }));
vi.mock('./useMailMutations', () => ({ useMailMutations: () => ({ sendMail: f.send, moveToTrash: f.remove, moveThread: f.move, snoozeThread: f.snooze }) }));
vi.mock('./useMailQueries', async importOriginal => ({ ...await importOriginal<typeof import('./useMailQueries')>(), useMailFolders: () => f.query, useAllAccountFolders: () => f.folders, useMailThreads: () => f.query, useAllAccountThreads: () => f.query, useMailConversation: (...args: unknown[]) => { f.conversation(...args); return f.query; }, useMailSearch: () => f.query, useAllAccountSearch: () => f.query, useAllAccountIdentities: () => f.empty }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it('retires the temporary preview after sending and deletes only the server item', async () => {
  vi.useFakeTimers();
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const root = createRoot(document.createElement('div'));
  let logic!: ReturnType<typeof useMailPageLogic>;
  function Harness() { logic = useMailPageLogic(); return null; }
  const onSent = vi.fn();
  let completeSend!: () => void;
  f.send.mockImplementation(() => new Promise<void>(resolve => { completeSend = resolve; }));
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>));
    await act(async () => logic.scheduleSend(['recipient@example.com'], [], [], 'Subject', '<p>Body</p>', { isNewMessage: true, toRecipients: [], ccRecipients: [], bccRecipients: [] } as unknown as ComposerRestoreData, undefined, undefined, onSent));
    const preview = logic.messages[0];
    expect(preview.item_id).toMatch(/^__optimistic__/);
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(f.send).toHaveBeenCalledOnce();
    expect(onSent).not.toHaveBeenCalled();
    expect(logic.actionToast?.onCancel).toBeUndefined();
    await act(async () => logic.handleDeleteMessage(preview));
    expect(f.trash).not.toHaveBeenCalled();
    await act(async () => completeSend());
    expect(onSent).toHaveBeenCalledOnce();
    expect(logic.selectedThread).toBeNull();
    expect(logic.messages).toEqual([]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['mail', 'account', 'threads', 'sentitems'] });
    await act(async () => logic.setSelectedThread({ conversation_id: 'server-conversation', accountId: 'account' } as never));
    await act(async () => logic.handleDeleteMessage({ ...preview, item_id: 'server-item' }));
    expect(f.trash).toHaveBeenCalledOnce();
    expect(f.trash).toHaveBeenCalledWith('server-item');
  } finally {
    await act(async () => root.unmount());
    client.clear();
    vi.useRealTimers();
  }
});

it('clears the selected identifier before switching its folder context', async () => {
  const client = new QueryClient();
  const root = createRoot(document.createElement('div'));
  let logic!: ReturnType<typeof useMailPageLogic>;
  function Harness() { logic = useMailPageLogic(); return null; }
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>));
    for (const [source, destination] of [['inbox', 'drafts'], ['drafts', 'sentitems']] as const) {
      await act(async () => logic.selectFolder(source));
      await act(async () => logic.setSelectedThread({ conversation_id: 'old-identifier' } as never));
      await act(async () => logic.selectFolder(source));
      expect(logic.selectedThread?.conversation_id).toBe('old-identifier');
      f.conversation.mockClear();
      await act(async () => logic.selectFolder(destination));
      expect(logic.selectedFolder).toBe(destination);
      expect(logic.selectedThread).toBeNull();
      expect(f.conversation.mock.calls.length).toBeGreaterThan(0);
      for (const call of f.conversation.mock.calls) expect(call[1]).toBeNull();
    }
    await act(async () => logic.setSelectedThread({ conversation_id: 'another-account' } as never));
    await act(async () => logic.selectFolder('sentitems', 'other-account'));
    expect(logic.selectedThread).toBeNull();
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});

for (const operation of ['trash', 'move', 'snooze'] as const) {
  it(`does not replay an expired ${operation} action when archiving the next email`, async () => {
    vi.useFakeTimers();
    f.remove.mockClear();
    f.move.mockClear();
    f.snooze.mockClear();
    const client = new QueryClient();
    const root = createRoot(document.createElement('div'));
    let logic!: ReturnType<typeof useMailPageLogic>;
    function Harness() { logic = useMailPageLogic(); return null; }
    try {
      await act(async () => root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>));
      await act(async () => logic.setSelectedThread({ conversation_id: 'first', accountId: 'account' } as never));
      await act(async () => {
        if (operation === 'trash') logic.moveToTrash('first');
        else if (operation === 'move') await logic.handleMove('archive');
        else await logic.handleSnooze('2099-01-01T10:00:00Z');
      });
      await act(async () => vi.advanceTimersByTimeAsync(5000));
      const perform = operation === 'trash' ? f.remove : operation === 'move' ? f.move : f.snooze;
      expect(perform).toHaveBeenCalledOnce();
      await act(async () => logic.setSelectedThread({ conversation_id: 'second', accountId: 'account' } as never));
      await act(async () => logic.handleMove('archive'));
      expect(perform).toHaveBeenCalledOnce();
      await act(async () => vi.advanceTimersByTimeAsync(5000));
      expect(f.move).toHaveBeenCalledTimes(operation === 'move' ? 2 : 1);
      expect(f.move.mock.calls.at(-1)?.[0]).toMatchObject({ conversationId: 'second', targetFolderId: 'archive' });
    } finally {
      await act(async () => root.unmount());
      client.clear();
      vi.useRealTimers();
    }
  });
}

it('reports a missing notification target only after the conversation request finishes', async () => {
  const client = new QueryClient();
  const root = createRoot(document.createElement('div'));
  let logic!: ReturnType<typeof useMailPageLogic>;
  function Harness() { logic = useMailPageLogic(); return null; }
  const unavailable = vi.fn((event: Event) => event.preventDefault());
  globalThis.addEventListener('courrier:notification-unavailable', unavailable);
  const original = { ...f.query };
  try {
    Object.assign(f.query, { isSuccess: true, isFetching: true, isPaused: false, isError: false });
    await act(async () => root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>));
    await act(async () => logic.setSelectedThread({ conversation_id: 'missing', accountId: 'account' } as never));
    expect(unavailable).not.toHaveBeenCalled();
    Object.assign(f.query, { isFetching: false, isPaused: true });
    await act(async () => root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>));
    expect(unavailable).not.toHaveBeenCalled();
    Object.assign(f.query, { isPaused: false });
    await act(async () => root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>));
    expect(unavailable).toHaveBeenCalledOnce();
    expect(unavailable.mock.calls[0][0]).toMatchObject({ detail: { accountId: 'account', conversationId: 'missing' } });
    expect(logic.error).toBe('mail.messageUnavailable');
  } finally {
    globalThis.removeEventListener('courrier:notification-unavailable', unavailable);
    await act(async () => root.unmount());
    for (const key of Object.keys(f.query)) if (!(key in original)) delete (f.query as Record<string, unknown>)[key];
    Object.assign(f.query, original);
    client.clear();
  }
});

it('preserves a notification selected when mail mounts after vault unlock', async () => {
  const client = new QueryClient();
  const root = createRoot(document.createElement('div'));
  let logic!: ReturnType<typeof useMailPageLogic>;
  function Harness() {
    logic = useMailPageLogic();
    useLayoutEffect(() => {
      logic.openThread({ conversation_id: 'notified', accountId: 'account' } as never);
      logic.adoptNotificationInboxContext('account');
    }, []);
    return null;
  }
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>));
    expect(logic.selectedThread?.conversation_id).toBe('notified');
    expect(logic.selectedAccountId).toBe('account');
    await act(async () => logic.selectAccount('other-account'));
    expect(logic.selectedThread).toBeNull();
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});

it('clears the detail selection immediately when discarding the last draft', async () => {
  vi.useFakeTimers();
  const client = new QueryClient();
  const root = createRoot(document.createElement('div'));
  let logic!: ReturnType<typeof useMailPageLogic>;
  function Harness() { logic = useMailPageLogic(); return null; }
  const previousData = f.query.data;
  const draft = { conversation_id: 'last-draft', accountId: 'account', unread_count: 0, display_name: 'Drafts', topic: 'Draft', to_recipients: [], cc_recipients: [] };
  try {
    f.query.data = [draft] as never[];
    await act(async () => root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>));
    await act(async () => logic.selectFolder('drafts'));
    await act(async () => logic.setSelectedThread(draft as never));
    await act(async () => logic.moveToTrash('last-draft'));
    expect(logic.threads).toEqual([]);
    expect(logic.selectedThread).toBeNull();
    expect(f.conversation.mock.calls.at(-1)?.[1]).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(logic.selectedThread).toBeNull();
  } finally {
    f.query.data = previousData;
    await act(async () => root.unmount());
    client.clear();
    vi.useRealTimers();
  }
});


for (const outcome of ['failure', 'undo'] as const) {
  it(`retains the shared draft when send ends with ${outcome}`, async () => {
    vi.useFakeTimers();
    const client = new QueryClient();
    const root = createRoot(document.createElement('div'));
    let logic!: ReturnType<typeof useMailPageLogic>;
    function Harness() { logic = useMailPageLogic(); return null; }
    const onSent = vi.fn();
    f.send.mockRejectedValue(new Error('offline'));
    try {
      await act(async () => root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>));
      await act(async () => logic.scheduleSend(['recipient@example.com'], [], [], 'Shared', '<p>Text</p>', {
        isNewMessage: true, toRecipients: [], ccRecipients: [], bccRecipients: [],
      } as unknown as ComposerRestoreData, undefined, undefined, onSent));
      if (outcome === 'undo') await act(async () => logic.actionToast?.onCancel?.());
      await act(async () => vi.advanceTimersByTimeAsync(10_000));
      expect(onSent).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      client.clear();
      vi.useRealTimers();
    }
  });
}
