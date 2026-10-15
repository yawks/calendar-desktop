// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { MessageBlockHeader } from './MessageBlockHeader';
import type { MailMessage } from '../types';
vi.mock('../../../shared/store/ThemeStore', () => ({ useTheme: () => ({ resolved: 'light' }) }));
vi.mock('./ContactAvatar', () => ({ ContactAvatar: () => null }));
vi.mock('./OriginalMessageModal', () => ({ OriginalMessageModal: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
it('offers the hidden content action only when needed and closes the menu on toggle', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host), toggle = vi.fn(), expand = vi.fn();
  const message = { item_id: '1', from_name: 'Sender', from_email: 'sender@example.com', to_recipients: [], cc_recipients: [], date_time_received: '2026-10-14', attachments: [], subject: 'Test' } as unknown as MailMessage;
  const render = async (hidden: boolean, showing = false) => act(async () => root.render(<MessageBlockHeader message={message} expanded onToggleExpand={expand} onReply={vi.fn()} onReplyAll={vi.fn()} onForward={vi.fn()} onTrash={vi.fn()} onToggleRead={vi.fn()} hasHiddenContent={hidden} showHiddenContent={showing} onToggleHiddenContent={toggle} />));
  const open = async () => act(async () => { Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('mail.actions'))!.click(); });
  await render(false); await open();
  expect(host.textContent).not.toContain('settings.mailContentRules.showOriginal');
  await render(true);
  const action = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('settings.mailContentRules.showOriginal'))!;
  await act(async () => action.click());
  expect(toggle).toHaveBeenCalledOnce(); expect(expand).not.toHaveBeenCalled();
  expect(host.querySelector('.mail-actions-menu')).toBeNull();
  await render(true, true); await open();
  expect(host.textContent).toContain('settings.mailContentRules.hideOriginal');
  expect(host.querySelector('button[aria-pressed="true"]')).not.toBeNull();
  await act(async () => root.unmount()); host.remove();
});
