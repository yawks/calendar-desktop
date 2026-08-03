import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../../shared/store/ThemeStore';
import { useFontSize } from '../../../shared/store/FontSizeStore';
import { invoke } from '@tauri-apps/api/core';
import { findQuoteMarker, processEmailQuotes } from '../utils/emailQuoteParser';

function parseHexColor(raw: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(raw.trim());
  return m ? [Number.parseInt(m[1], 16), Number.parseInt(m[2], 16), Number.parseInt(m[3], 16)] : null;
}

export function EmailHtmlBody({ html, bodyText }: { readonly html: string; readonly bodyText?: string }) {
  const { t } = useTranslation();
  const { resolved } = useTheme();
  const { fontSize } = useFontSize();
  const fontScale = fontSize === 'small' ? 0.85 : fontSize === 'medium' ? 1 : 1.2;
  const isDark = resolved === 'dark';
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeHeight, setIframeHeight] = useState(200);

  const bgRaw = getComputedStyle(document.documentElement).getPropertyValue('--bg');
  const bgParsed = parseHexColor(bgRaw) ?? [28, 30, 32];
  const [bgR, bgG, bgB] = bgParsed;
  const bgCss = `rgb(${bgR}, ${bgG}, ${bgB})`;

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.data?.type === 'open-url' && typeof e.data.url === 'string') {
        invoke('open_url', { url: e.data.url }).catch(console.error);
      }
      if (e.data?.type === 'resize' && typeof e.data.height === 'number') {
        setIframeHeight(e.data.height + 4);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const kr = ((255 + bgR) / 255).toFixed(4);
  const kg = ((255 + bgG) / 255).toFixed(4);
  const kb = ((255 + bgB) / 255).toFixed(4);
  const darkModeSvg = isDark
    ? `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">
        <filter id="dm" color-interpolation-filters="sRGB">
          <feColorMatrix type="matrix"
            values="-1 0 0 0 ${kr}  0 -1 0 0 ${kg}  0 0 -1 0 ${kb}  0 0 0 1 0"/>
        </filter>
       </svg>`
    : '';
  const darkModeStyle = isDark ? `
  html, body { background: ${bgCss}; }
  .ew { filter: url(#dm); }
  .ew img, .ew video, .ew canvas, .ew iframe, .ew svg, .ew .qt-toggle { filter: url(#dm); }` : '';

  const prevMsgLabel = t('mail.previousMessage', 'Previous message');

  // Detect quote boundary from plain text, then pass the marker to the iframe script.
  const quoteMarker = bodyText ? findQuoteMarker(bodyText) : null;

  const safeHtml = html.replaceAll(/\bsrc=["']cid:[^"']*["']/gi, 'src=""');

  const srcdoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; overflow: hidden; }
  .ew {
    padding: 4px 0;
    font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
    font-size: ${14 * fontScale}px; line-height: 1.6;
    color: #202124; background: #fff;
    word-break: break-word; overflow-wrap: anywhere;
  }
  img { max-width: 100%; height: auto; }
  a { color: #1a73e8; cursor: pointer; }
  pre, code { white-space: pre-wrap; word-break: break-all; font-size: ${13 * fontScale}px; }
  table { max-width: 100%; }
  blockquote {
    border-left: 3px solid #dadce0;
    margin: 8px 0; padding-left: 12px; color: #70757a;
  }
  .qt { margin-top: 12px; border-radius: 4px; overflow: hidden; }
  .qt-toggle {
    display: flex; align-items: center; justify-content: center;
    width: 42px; height: 24px; margin: 4px 8px;
    background: rgba(127,127,127,.12); border: 1px solid currentColor;
    border-radius: 7px; cursor: pointer;
    font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
  }
  .qt-toggle:hover { background: rgba(127,127,127,.22); }
  .qt-toggle:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
  .qt-dots { font-size: ${12 * fontScale}px; font-weight: 700; letter-spacing: 2px; line-height: 1; }
  .qt-inner { padding: 2px 12px 10px; }
  .qt-inner > :first-child { margin-top: 0; }${darkModeStyle}
</style>
</head>
<body>${darkModeSvg}<div class="ew">${safeHtml}</div>
<script>
  document.addEventListener('click', function(e) {
    var a = e.target.closest('a');
    if (a && a.href && !a.href.startsWith('javascript:')) {
      e.preventDefault();
      window.parent.postMessage({ type: 'open-url', url: a.href }, '*');
    }
  });
  (function() {
    (${processEmailQuotes.toString()})(document.querySelector('.ew') || document.body, {
      label: ${JSON.stringify(prevMsgLabel).replaceAll('</', '<\\/')},
      quoteMarker: ${JSON.stringify(quoteMarker).replaceAll('</', '<\\/')}
    });
  })();
  var ro = new ResizeObserver(function() {
    window.parent.postMessage({ type: 'resize', height: document.body.scrollHeight }, '*');
  });
  ro.observe(document.body);
  window.parent.postMessage({ type: 'resize', height: document.body.scrollHeight }, '*');
</script>
</body>
</html>`;

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcdoc}
      sandbox="allow-scripts"
      className="mail-email-iframe"
      title="email-body"
      style={{ height: iframeHeight }}
    />
  );
}
