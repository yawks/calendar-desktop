import { useCallback, useEffect } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { useNavigate } from 'react-router-dom';
import { platform } from '.';

export function NativeDeepLinks() {
  const navigate = useNavigate();
  const openDeepLink = useCallback((url: string) => {
    const deepLink = new URL(url);
    const match = /^\/account\/([^/]+)\/conversation\/([^/]+)$/.exec(deepLink.pathname);
    if (!match || deepLink.hostname !== 'mail') return;
    const params = new URLSearchParams({
      account: decodeURIComponent(match[1]),
      conversation: decodeURIComponent(match[2]),
    });
    const action = deepLink.searchParams.get('action');
    if (action) params.set('action', action);
    navigate('/?' + params.toString());
  }, [navigate]);

  useEffect(() => {
    if (!platform.isNativeAndroid) return;
    void CapacitorApp.getLaunchUrl().then(result => {
      if (result?.url) openDeepLink(result.url);
    });
    const listener = CapacitorApp.addListener('appUrlOpen', ({ url }) => openDeepLink(url));
    return () => { void listener.then(handle => handle.remove()); };
  }, [openDeepLink]);
  return null;
}
