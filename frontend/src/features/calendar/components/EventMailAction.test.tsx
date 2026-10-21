// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import EventMailAction from './EventMailAction';
const f = vi.hoisted(() => ({ navigate: vi.fn(), setActiveTab: vi.fn(), openWindow: vi.fn(), layout: 'tabbed' }));
vi.mock('../../../shared/services/mailDraftWindow', () => ({ openMailDraftWindow: f.openWindow }));
vi.mock('react-router-dom', () => ({ useNavigate: () => f.navigate }));
vi.mock('../../../shared/store/LayoutStore', () => ({ useLayout: () => ({ setActiveTab: f.setActiveTab, layout: f.layout }) }));
vi.mock('../../../shared/store/GoogleAuthStore', () => ({ useGoogleAuth: () => ({ accounts: [{ id: 'me', email: 'me@example.test' }] }) }));
vi.mock('../../../shared/store/ExchangeAuthStore', () => ({ useExchangeAuth: () => ({ accounts: [] }) }));
vi.mock('../../../shared/store/ImapAuthStore', () => ({ useImapAuth: () => ({ accounts: [] }) }));
vi.mock('../../../shared/store/JmapAuthStore', () => ({ useJmapAuth: () => ({ accounts: [] }) }));
import '../../../i18n';
it.each(['tabbed', 'windows'])('opens the draft in the correct window (%s)', async layout => {
  vi.clearAllMocks();
  f.layout = layout;
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  const root = createRoot(host);
  const onClose = vi.fn();
  try {
    await act(async () => root.render(<EventMailAction event={{ id: 'event', calendarId: 'cal', title: 'Planning', start: '', end: '', isAllday: false, category: 'time' }} calendar={{ id: 'cal', name: 'Calendar', type: 'google', googleAccountId: 'me', color: '', url: '', visible: true }} onClose={onClose} />));
    await act(async () => host.querySelector('button')!.click());
    expect(onClose).toHaveBeenCalledOnce();
    if (layout === 'windows') {
      expect(f.openWindow).toHaveBeenCalledWith(expect.objectContaining({ fromAccountId: 'me', initialFocus: 'to' }));
      expect(f.navigate).not.toHaveBeenCalled();
      expect(f.setActiveTab).not.toHaveBeenCalled();
    } else {
      expect(f.setActiveTab).toHaveBeenCalledWith('mail');
      expect(f.navigate).toHaveBeenCalledWith('/mail', { state: { eventDraft: expect.objectContaining({ fromAccountId: 'me', initialFocus: 'to' }) } });
    }
  } finally { await act(async () => root.unmount()); }
});
