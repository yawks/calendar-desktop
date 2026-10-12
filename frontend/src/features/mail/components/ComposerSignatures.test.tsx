// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAllAccountIdentities } from '../hooks/useMailQueries';
import { EwsMailProvider } from '../providers/EwsMailProvider';
import { beforeAll, expect, it, vi } from 'vitest';
import type { ComposerRestoreData, MailIdentity, MailMessage } from '../types';

vi.mock('./RecipientInput', () => ({ RecipientInput: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock('../../../shared/store/SignatureStore', async importOriginal => ({
  ...await importOriginal<typeof import('../../../shared/store/SignatureStore')>(),
  useSignatures: () => ({ getSignature: (id: string) => (id === 'alias' || id === 'alias@example.test') ? '<p>My signature</p>' : '', signaturePosition: 'above-quoted' }),
}));
import { MailComposer } from './MailComposer';
import { NewMessageComposer } from './NewMessageComposer';

beforeAll(() => {
  globalThis.requestAnimationFrame = callback => setTimeout(() => callback(0), 0) as unknown as number;
  globalThis.cancelAnimationFrame = id => clearTimeout(id);
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const identity: MailIdentity = { id: 'alias', email: 'alias@example.test', name: 'Alias', mayDelete: false };
const replyTo = { item_id: 'message-2', from_email: 'sender@example.test', to_recipients: [{ email: identity.email }], subject: 'Conversation', date_time_received: '2026-10-12T10:00:00Z', body_html: '<p>Latest</p><blockquote><p>Earlier</p></blockquote>', body_text: '', attachments: [] } as unknown as MailMessage;
const noop = () => {};

for (const kind of ['new', 'reply', 'replyAll'] as const) {
  for (const scenario of ['ready', 'delayed', 'draft'] as const) {
    const delayed = scenario === 'delayed';
    const restoreData: ComposerRestoreData | null = scenario === 'draft' ? { isNewMessage: kind === 'new', replyingToMsg: null, body: '<p>Draft</p><div data-courrier-sig="1"><p>Saved signature</p></div>', toRecipients: [], ccRecipients: [], bccRecipients: [], subject: '', attachments: [], showCc: false, showBcc: false } : null;
    it(`${kind}: inserts the default signature with an empty selected ID (${scenario})`, async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = createRoot(host);
      const render = (identities: MailIdentity[]) => kind === 'new'
        ? <NewMessageComposer contacts={[]} identities={identities} selectedIdentityId="" fromAccounts={[]} fromAccountId="account" onFromAccountChange={noop} restoreData={restoreData} onSend={async () => {}} onCancel={noop} onSaveDraft={noop} />
        : <MailComposer replyTo={replyTo} mode={kind} contacts={[]} identities={identities} selectedIdentityId="" restoreData={restoreData} onSend={async () => {}} onCancel={noop} />;
      await act(async () => root.render(render(delayed ? [] : [identity])));
      if (delayed) await act(async () => root.render(render([identity])));
      expect(host.querySelectorAll('[data-courrier-sig]')).toHaveLength(1);
      expect(host.querySelector('.mail-quoted [data-courrier-sig]')).toBeNull();
      expect(host.querySelector('[data-courrier-sig]')?.textContent).toBe(scenario === 'draft' ? 'Saved signature' : 'My signature');
      await act(async () => root.render(render([identity])));
      expect(host.querySelectorAll('[data-courrier-sig]')).toHaveLength(1);
      expect(host.querySelector('.mail-quoted [data-courrier-sig]')).toBeNull();
      await act(async () => root.unmount());
      host.remove();
    });
  }
}

// EWS has no listIdentities API: the signature key is its email, not its account ID.

for (const mode of ['reply', 'replyAll'] as const) {
  it(`EWS ${mode}: keeps the signature visible outside folded conversation history`, async () => {
    const account = { id: 'ews-account', email: 'alias@example.test', label: 'Exchange', provider: new EwsMailProvider('ews-account', async () => null, 'alias@example.test') };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    function Reply() {
      const identities = useAllAccountIdentities([account]).filter(i => i.accountId === account.id);
      return <MailComposer replyTo={replyTo} mode={mode} contacts={[]} identities={identities} selectedIdentityId="" onSend={async () => {}} onCancel={noop} />;
    }
    await act(async () => root.render(<QueryClientProvider client={client}><Reply /></QueryClientProvider>));
    const signature = host.querySelector('[data-courrier-sig]');
    expect(signature?.textContent).toBe('My signature');
    expect(signature?.closest('.mail-quoted')).toBeNull();
    expect(host.querySelector('.mail-quoted__editable-content')?.getAttribute('style')).toContain('display: none');
    await act(async () => root.unmount());
    client.clear();
    host.remove();
  });
}
