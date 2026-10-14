// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { useMailPageLogic } from './useMailPageLogic';
import type { ComposerRestoreData } from '../types';
const f = vi.hoisted(() => ({ accounts: [{ id: 'account', email: 'sender@example.com', displayName: 'Sender' }], empty: [], send: vi.fn(), trash: vi.fn(), query: { data: [], errors: [], refetch: vi.fn() }, folders: { allAccountFolders: new Map(), allModeDynamicFolders: [], mergedCounts: {}, errors: [] }, t: (key: string) => key }));
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
vi.mock('./useMailMutations', () => ({ useMailMutations: () => ({ sendMail: f.send }) }));
vi.mock('./useMailQueries', async importOriginal => ({ ...await importOriginal<typeof import('./useMailQueries')>(), useMailFolders: () => f.query, useAllAccountFolders: () => f.folders, useMailThreads: () => f.query, useAllAccountThreads: () => f.query, useMailConversation: () => f.query, useMailSearch: () => f.query, useAllAccountSearch: () => f.query, useAllAccountIdentities: () => f.empty }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it('retires the temporary preview after sending and deletes only the server item', async () => {
  vi.useFakeTimers();
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const root = createRoot(document.createElement('div'));
  let logic!: ReturnType<typeof useMailPageLogic>;
  function Harness() { logic = useMailPageLogic(); return null; }
  let completeSend!: () => void;
  f.send.mockImplementation(() => new Promise<void>(resolve => { completeSend = resolve; }));
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>));
    await act(async () => logic.scheduleSend(['recipient@example.com'], [], [], 'Subject', '<p>Body</p>', { isNewMessage: true, toRecipients: [], ccRecipients: [], bccRecipients: [] } as unknown as ComposerRestoreData));
    const preview = logic.messages[0];
    expect(preview.item_id).toMatch(/^__optimistic__/);
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(f.send).toHaveBeenCalledOnce();
    expect(logic.actionToast?.onCancel).toBeUndefined();
    await act(async () => logic.handleDeleteMessage(preview));
    expect(f.trash).not.toHaveBeenCalled();
    await act(async () => completeSend());
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
