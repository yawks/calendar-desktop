import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './i18n';
import App from './App';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  globalThis.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(console.error));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
