import { useCallback, useEffect } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { useNavigate } from 'react-router-dom';
import { platform } from '.';
import { useLayout } from '../store/LayoutStore';

export function NativeDeepLinks() {
  const navigate = useNavigate();
  const { setActiveTab } = useLayout();
  const openDeepLink = useCallback(async (url: string) => {
    const deepLink = new URL(url);
    const match = /^\/account\/([^/]+)\/conversation\/([^/]+)$/.exec(deepLink.pathname);
    if (!match || deepLink.hostname !== 'mail') {
      console.warn('[notification-link] rejected malformed target');
      return;
    }
    console.info('[notification-link] accepted target');
    const params = new URLSearchParams({
      account: decodeURIComponent(match[1]),
      conversation: decodeURIComponent(match[2]),
    });
    const action = deepLink.searchParams.get('action');
    if (action) params.set('action', action);
    const notificationThread = await platform.notificationThread?.(decodeURIComponent(match[1]), decodeURIComponent(match[2]));
    // Do not display Inbox while the direct-conversation metadata is loading.
    navigate('/?' + params.toString(), { state: { notificationThread } });
    setActiveTab('mail');
  }, [navigate, setActiveTab]);

  useEffect(() => {
    if (!platform.isNativeAndroid) return;
    const consumeNativeTarget = () => void platform.consumeNotificationUrl().then(url => {
      if (url) void openDeepLink(url);
    });
    consumeNativeTarget();
    void CapacitorApp.getLaunchUrl().then(result => {
      if (result?.url) void openDeepLink(result.url);
    });
    const listener = CapacitorApp.addListener('appUrlOpen', ({ url }) => void openDeepLink(url));
    const stateListener = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) consumeNativeTarget();
    });
    return () => {
      void listener.then(handle => handle.remove());
      void stateListener.then(handle => handle.remove());
    };
  }, [openDeepLink]);
  return null;
}
