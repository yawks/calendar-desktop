import { useCallback, useEffect } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { useNavigate } from 'react-router-dom';
import { platform } from '.';
import { useLayout } from '../store/LayoutStore';

export function NativeDeepLinks() {
  const navigate = useNavigate();
  const { setActiveTab } = useLayout();
  const openDeepLink = useCallback((url: string) => {
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
    // MailPage owns the account/thread/reply workflow. It must be mounted before
    // navigating, otherwise a deep link received while Calendar has focus is lost.
    setActiveTab('mail');
    navigate('/?' + params.toString());
  }, [navigate, setActiveTab]);

  useEffect(() => {
    if (!platform.isNativeAndroid) return;
    const consumeNativeTarget = () => void platform.consumeNotificationUrl().then(url => {
      if (url) openDeepLink(url);
    });
    consumeNativeTarget();
    void CapacitorApp.getLaunchUrl().then(result => {
      if (result?.url) openDeepLink(result.url);
    });
    const listener = CapacitorApp.addListener('appUrlOpen', ({ url }) => openDeepLink(url));
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
