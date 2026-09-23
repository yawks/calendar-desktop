// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { processEmailQuotes } from '../utils/emailQuoteParser';
import { forwardedGmailOutlookHtml, forwardedGmailOutlookText } from './__fixtures__/forwardedGmailOutlookMessage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string | { defaultValue?: string }) =>
    typeof fallback === 'string' ? fallback : fallback.defaultValue ?? '' }),
}));
vi.mock('../../../shared/store/ThemeStore', () => ({ useTheme: () => ({ resolved: 'light' }) }));
vi.mock('../../../shared/store/FontSizeStore', () => ({ useFontSize: () => ({ fontSize: 'medium' }) }));
vi.mock('../../../shared/services/fileService', () => ({ openExternalUrl: vi.fn() }));
vi.mock('../../../shared/platform', () => ({ platform: { isNativeAndroid: false } }));

import { EmailHtmlBody } from './EmailHtmlBody';

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('EmailHtmlBody regression: forwarded Gmail/Outlook message', () => {
  it('processes the real-world nesting without removing its visible content', () => {
    const root = document.createElement('div');
    root.innerHTML = forwardedGmailOutlookHtml;

    expect(() => processEmailQuotes(root, {
      label: 'Previous message',
      quoteMarker: '---------- Forwarded message ---------',
    })).not.toThrow();
    expect(root.textContent).toContain('Cordialement');
    expect(root.textContent).toContain('Pour le coup je ne suis pas intéressé');
  });

  it('does not reset an imperatively measured iframe on a React rerender', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const render = () => (
      <EmailHtmlBody html={forwardedGmailOutlookHtml} bodyText={forwardedGmailOutlookText} />
    );

    await act(async () => root.render(render()));
    const iframe = host.querySelector('iframe');
    expect(iframe).not.toBeNull();
    iframe!.style.height = '2029px';
    iframe!.style.visibility = 'visible';

    await act(async () => root.render(render()));

    expect(iframe!.style.height).toBe('2029px');
    expect(iframe!.style.visibility).toBe('visible');
    await act(async () => root.unmount());
  });
});
