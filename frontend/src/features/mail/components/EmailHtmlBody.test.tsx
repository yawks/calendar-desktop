// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useMailContentRules } from '../../../shared/store/MailContentRulesStore';
import { processEmailQuotes } from '../utils/emailQuoteParser';
import { forwardedGmailOutlookHtml, forwardedGmailOutlookText } from './__fixtures__/forwardedGmailOutlookMessage';

vi.mock('../../../shared/store/MailContentRulesStore', () => ({ useMailContentRules: vi.fn(() => ({ rules: [], save: vi.fn() })) }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string | { defaultValue?: string }) =>
    typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? _key }),
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
  vi.mocked(useMailContentRules).mockReturnValue({ rules: [], save: vi.fn() });
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

  it('fits a fixed-width email and recalculates after images load', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const component = createRoot(host);
    await act(async () => component.render(<EmailHtmlBody html="<table width='1400'><tr><td>Wide email</td></tr></table>" />));
    const frame = host.querySelector('iframe')!;
    const doc = frame.contentDocument!;
    doc.body.innerHTML = '<div class="ew">Wide email</div>';
    const content = doc.querySelector<HTMLElement>('.ew')!;
    const setProperty = vi.spyOn(content.style, 'setProperty');
    const removeProperty = vi.spyOn(content.style, 'removeProperty');
    let contentHeight = 400;
    vi.spyOn(content, 'getBoundingClientRect').mockImplementation(() => ({ height: contentHeight } as DOMRect));
    Object.defineProperty(doc.documentElement, 'scrollHeight', { get: () => Number.parseFloat(frame.style.height) || 0 });
    let availableWidth = 480;
    Object.defineProperty(doc.documentElement, 'clientWidth', { get: () => availableWidth });
    Object.defineProperty(content, 'scrollWidth', { get: () => 1400 });

    await act(async () => frame.dispatchEvent(new Event('load')));
    expect(setProperty).toHaveBeenLastCalledWith('zoom', String(480 / 1400), 'important');
    expect(frame.style.visibility).toBe('visible');

    for (const width of [320, 1024, 1600]) {
      availableWidth = width;
      doc.dispatchEvent(new Event('load'));
      if (width < 1400) {
        expect(setProperty).toHaveBeenLastCalledWith('zoom', String(width / 1400), 'important');
      } else {
        expect(removeProperty).toHaveBeenCalledWith('zoom');
      }
    }
    for (let measurement = 0; measurement < 10; measurement++) {
      doc.dispatchEvent(new Event('load'));
      expect(frame.style.height).toBe('404px');
    }
    contentHeight = 200;
    doc.dispatchEvent(new Event('load'));
    expect(frame.style.height).toBe('204px');
    await act(async () => component.unmount());
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

describe('EmailHtmlBody content filtering', () => {
  it('reveals and hides the original without modifying the supplied email', async () => {
    vi.mocked(useMailContentRules).mockReturnValue({ rules: [{ id: '1', text: 'ATTENTION: email externe.', enabled: true }], save: vi.fn() });
    const host = document.createElement('div'); document.body.append(host);
    const component = createRoot(host);
    const html = '<div>ATTENTION: email externe.</div><p>Bonjour</p>';
    await act(async () => component.render(<EmailHtmlBody html={html} />));
    expect(host.querySelector('iframe')!.srcdoc).not.toContain('ATTENTION: email externe.');
    expect(host.querySelector('iframe')!.srcdoc).toContain('Bonjour');
    expect(host.querySelector('button')).toBeNull();
    await act(async () => component.render(<EmailHtmlBody html={html} showHiddenContent />));
    expect(host.querySelector('iframe')!.srcdoc).toContain('ATTENTION: email externe.');
    await act(async () => component.render(<EmailHtmlBody html={html} showHiddenContent={false} />));
    expect(host.querySelector('iframe')!.srcdoc).not.toContain('ATTENTION: email externe.');
    expect(html).toContain('ATTENTION: email externe.');
    await act(async () => component.unmount());
  });
  it('filters plain text messages while escaping their HTML characters', async () => {
    vi.mocked(useMailContentRules).mockReturnValue({ rules: [{ id: '1', text: 'External email.', enabled: true }], save: vi.fn() });
    const host = document.createElement('div'); document.body.append(host);
    const component = createRoot(host);
    await act(async () => component.render(<EmailHtmlBody html="" bodyText="External email. Hello <script>" />));
    expect(host.querySelector('iframe')!.srcdoc).toContain('Hello &lt;script&gt;');
    expect(host.querySelector('iframe')!.srcdoc).not.toContain('External email.');
    await act(async () => component.unmount());
  });
});
