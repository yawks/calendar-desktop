import { useEffect } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { useNavigate } from 'react-router-dom';
import { platform } from '.';

export function NativeDeepLinks() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!platform.isNativeAndroid) return;
    const listener = CapacitorApp.addListener('appUrlOpen', ({ url }) => {
      const match = /^courrier:\/\/mail\/account\/([^/]+)\/conversation\/([^/]+)$/.exec(url);
      if (match) navigate('/?account=' + encodeURIComponent(decodeURIComponent(match[1])) + '&conversation=' + encodeURIComponent(decodeURIComponent(match[2])));
    });
    return () => { void listener.then(handle => handle.remove()); };
  }, [navigate]);
  return null;
}
