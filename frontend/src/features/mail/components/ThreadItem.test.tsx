// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import type { MailProvider } from '../providers/MailProvider';
import type { MailThread } from '../types';
import { ThreadItem } from './ThreadItem';
vi.mock('../../../shared/store/MailContentRulesStore', () => ({ useMailContentRules: () => ({ rules: [{ id: '1', text: 'ATTENTION: email externe. Ne cliquez pas sur les liens.', enabled: true }] }) }));
vi.mock('../../../shared/store/ThemeStore', () => ({ useTheme: () => ({ preference: 'light' }) }));
vi.mock('../../../shared/platform/notificationOpening', () => ({ useNotificationOpening: () => false }));
vi.mock('./ContactAvatar', () => ({ ContactAvatar: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
it('loads an unmodified body near the viewport to replace a truncated banner preview', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let intersect: IntersectionObserverCallback;
  globalThis.IntersectionObserver = class {
    constructor(callback: IntersectionObserverCallback) { intersect = callback; }
    observe() {} disconnect() {} unobserve() {} takeRecords() { return []; }
    root = null; rootMargin = ''; thresholds = [];
  };
  const body = 'ATTENTION: email externe. Ne cliquez pas sur les liens. Bonjour, le vrai message.';
  const provider = { accountId: 'account', providerType: 'gmail', getThread: vi.fn(async () => [{ item_id: 'message', date_time_received: '2026-10-14', body_loaded: false }]), getMessageContent: vi.fn(async () => ({ body_text: body })) } as unknown as MailProvider;
  const thread: MailThread = { conversation_id: 'thread', topic: 'Subject', snippet: body.slice(0, 38), last_delivery_time: '2026-10-14', message_count: 1, unread_count: 1, from_name: 'Sender', from_email: 'sender@example.com', has_attachments: false };
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host), client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={client}><ThreadItem thread={thread} provider={provider} isSelected={false} isChecked={false} isInSnoozedFolder={false} onSelect={vi.fn()} onToggleRead={vi.fn()} onDelete={vi.fn()} onToggleCheck={vi.fn()} /></QueryClientProvider>));
  expect(provider.getThread).not.toHaveBeenCalled();
  await act(async () => {
    intersect!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    await new Promise(resolve => setTimeout(resolve, 30));
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(provider.getMessageContent).toHaveBeenCalledWith('message', 'thread');
  expect(host.querySelector('.mail-thread-item__snippet-text')?.textContent).toBe('Bonjour, le vrai message.');
  expect(body).toContain('ATTENTION:');
  await act(async () => root.unmount()); client.clear(); host.remove();
});
