// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeDeepLinks } from './NativeDeepLinks';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), setActiveTab: vi.fn(), reveal: vi.fn(),
  consume: vi.fn(), invalidate: vi.fn(), exit: vi.fn(),
  listeners: new Map<string, (event: any) => void>(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@capacitor/app', () => ({ App: {
  exitApp: mocks.exit,
  getLaunchUrl: async () => undefined,
  addListener: async (name: string, listener: (event: any) => void) => {
    mocks.listeners.set(name, listener);
    return { remove: vi.fn() };
  },
} }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('../store/LayoutStore', () => ({ useLayout: () => ({ setActiveTab: mocks.setActiveTab }) }));
vi.mock('../store/ThemeStore', () => ({ useTheme: () => ({ resolved: 'dark' }) }));
vi.mock('.', () => ({ platform: {
  isNativeAndroid: true, consumeNotificationUrl: mocks.consume,
  revealNotificationView: mocks.reveal,
} }));
vi.mock('../queryClient', () => ({ queryClient: {
  invalidateQueries: mocks.invalidate, cancelQueries: vi.fn(),
} }));
vi.mock('../../features/mail/components/ContactAvatar', () => ({ ContactAvatar: () => null }));

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.listeners.clear();
  mocks.consume.mockResolvedValue(null);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0; });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<NativeDeepLinks />));
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('Android resume', () => {
  it('keeps the preview when a previous conversation reports its body ready', async () => {
    await act(async () => mocks.listeners.get('appUrlOpen')!({ url: 'courrier://mail/account/a/conversation/b' }));
    await act(async () => globalThis.dispatchEvent(new CustomEvent('courrier:notification-opened', {
      detail: { accountId: 'a', conversationId: 'previous' },
    })));
    expect(host.querySelector('.notification-opening')).not.toBeNull();
    await act(async () => globalThis.dispatchEvent(new CustomEvent('courrier:notification-opened', {
      detail: { accountId: 'other-account', conversationId: 'b' },
    })));
    expect(host.querySelector('.notification-opening')).not.toBeNull();
    await act(async () => globalThis.dispatchEvent(new CustomEvent('courrier:notification-opened', {
      detail: { accountId: 'a', conversationId: 'b' },
    })));
    expect(host.childElementCount).toBe(0);
  });

  it('returns to the list from the preview back button', async () => {
    const url = 'courrier://mail/account/a/conversation/b';
    await act(async () => mocks.listeners.get('appUrlOpen')!({ url }));
    const button = host.querySelector<HTMLButtonElement>('.notification-opening__nav button')!;
    expect(button.getAttribute('aria-label')).toBeTruthy();
    await act(async () => button.click());
    expect(host.childElementCount).toBe(0);
    expect(mocks.navigate).toHaveBeenLastCalledWith('/', { replace: true });
    await act(async () => mocks.listeners.get('appUrlOpen')!({ url }));
    expect(host.childElementCount).toBe(0);
  });

  it('dismisses only an unavailable notification matching the current target', async () => {
    await act(async () => mocks.listeners.get('appUrlOpen')!({ url: 'courrier://mail/account/a/conversation/b' }));
    for (const [accountId, conversationId, accepted] of [['a', 'old', false], ['other', 'b', false], ['a', 'b', true]] as const) {
      const event = new CustomEvent('courrier:notification-unavailable', { cancelable: true, detail: { accountId, conversationId } });
      await act(async () => { globalThis.dispatchEvent(event); });
      expect(event.defaultPrevented).toBe(accepted);
      expect(host.childElementCount).toBe(accepted ? 0 : 1);
    }
    expect(mocks.navigate).toHaveBeenLastCalledWith('/', { replace: true });
  });

  it('keeps the native cover until the preview has committed and painted', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const url = 'courrier://mail/account/a/conversation/b';
    await act(async () => {
      mocks.listeners.get('appUrlOpen')!({ url });
      expect(host.querySelector('.notification-opening')).not.toBeNull();
    });
    expect(host.querySelector('.notification-opening')).not.toBeNull();
    expect(mocks.reveal).not.toHaveBeenCalled();
    await act(async () => {
      mocks.listeners.get('appUrlOpen')!({ url });
      mocks.listeners.get('appStateChange')!({ isActive: true });
    });
    expect(mocks.reveal).not.toHaveBeenCalled();
    await act(async () => frames.shift()!(0));
    expect(mocks.reveal).not.toHaveBeenCalled();
    await act(async () => frames.shift()!(0));
    expect(mocks.reveal).toHaveBeenCalledOnce();
  });

  it('lets the mail screen handle Back and removes the notification cover', async () => {
    await act(async () => mocks.listeners.get('appUrlOpen')!({ url: 'courrier://mail/account/a/conversation/b' }));
    expect(host.childElementCount).toBe(1);
    const handleBack = (event: Event) => event.preventDefault();
    globalThis.addEventListener('courrier:android-back', handleBack, { once: true });
    await act(async () => mocks.listeners.get('backButton')!({ canGoBack: true }));
    expect(host.childElementCount).toBe(0);
    expect(mocks.exit).not.toHaveBeenCalled();
  });

  it('exits when no screen handles Back and there is no history', async () => {
    await act(async () => mocks.listeners.get('backButton')!({ canGoBack: false }));
    expect(mocks.exit).toHaveBeenCalledOnce();
  });

  it('reveals the current screen and refreshes mail without navigating', async () => {
    await act(async () => {
      mocks.listeners.get('appStateChange')!({ isActive: false });
      mocks.listeners.get('appStateChange')!({ isActive: true });
    });
    expect(mocks.reveal).toHaveBeenCalledOnce();
    expect(mocks.invalidate).toHaveBeenCalledWith({ queryKey: ['mail'], refetchType: 'active' });
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.setActiveTab).not.toHaveBeenCalled();
    expect(host.childElementCount).toBe(0);
  });

  it('reveals the WebView when a duplicate notification is ignored', async () => {
    const url = 'courrier://mail/account/a/conversation/b';
    await act(async () => mocks.listeners.get('appUrlOpen')!({ url }));
    expect(mocks.navigate).toHaveBeenCalledOnce();
    mocks.reveal.mockClear();
    await act(async () => mocks.listeners.get('appUrlOpen')!({ url }));
    expect(mocks.reveal).toHaveBeenCalledOnce();
    expect(mocks.navigate).toHaveBeenCalledOnce();
  });

  it('reveals the WebView when a notification target is rejected', async () => {
    await act(async () => mocks.listeners.get('appUrlOpen')!({ url: 'courrier://mail/invalid' }));
    expect(mocks.reveal).toHaveBeenCalledOnce();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(host.childElementCount).toBe(0);
  });
});
