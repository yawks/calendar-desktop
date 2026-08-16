import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './i18n';
import App from './App';
import { platform } from './shared/platform';

globalThis.addEventListener('error', event => {
  const detail = event.error instanceof Error ? event.error.stack : undefined;
  console.error('[GlobalError]', detail ?? event.message, `${event.filename}:${event.lineno}:${event.colno}`);
});
globalThis.addEventListener('unhandledrejection', event => {
  const detail = event.reason instanceof Error ? event.reason.stack : event.reason;
  console.error('[UnhandledRejection]', detail);
});

if ('serviceWorker' in navigator && import.meta.env.PROD && !platform.isNativeAndroid) {
  globalThis.addEventListener('load', () => {
    let hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      globalThis.location.reload();
    });

    void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => {
        const checkForUpdate = () => { void registration.update().catch(console.error); };
        checkForUpdate();
        globalThis.setInterval(checkForUpdate, 60 * 60 * 1000);
        globalThis.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') checkForUpdate();
        });
      })
      .catch(console.error);
  });
} else if ('serviceWorker' in navigator && platform.isNativeAndroid) {
  void navigator.serviceWorker.getRegistrations()
    .then(registrations => Promise.all(registrations.map(registration => registration.unregister())))
    .catch(console.error);
  if ('caches' in globalThis) {
    void caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key)))).catch(console.error);
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
