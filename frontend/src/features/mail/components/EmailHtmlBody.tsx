import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../../shared/store/ThemeStore';
import { useFontSize } from '../../../shared/store/FontSizeStore';
import { openExternalUrl } from '../../../shared/services/fileService';
import { disableSenderDarkModeCss } from '../utils/emailDarkMode';
import { findQuoteMarker, processEmailQuotes } from '../utils/emailQuoteParser';

function parseHexColor(raw: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(raw.trim());
  return m ? [Number.parseInt(m[1], 16), Number.parseInt(m[2], 16), Number.parseInt(m[3], 16)] : null;
}

function sanitizeEmailHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  parsed.querySelectorAll('script, iframe, frame, object, embed, base, meta[http-equiv="refresh"]').forEach(element => element.remove());
  parsed.querySelectorAll<HTMLElement>('*').forEach(element => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith('on') || ((name === 'href' || name === 'src') && value.startsWith('javascript:'))) {
        element.removeAttribute(attribute.name);
      }
    }
  });
  return parsed.body.innerHTML;
}

export function EmailHtmlBody({ html, bodyText }: { readonly html: string; readonly bodyText?: string }) {
  const { t } = useTranslation();
  const { resolved } = useTheme();
  const { fontSize } = useFontSize();
  const fontScale = fontSize === 'small' ? 0.85 : fontSize === 'medium' ? 1 : fontSize === 'intermediate' ? 1.1 : 1.2;
  const isDark = resolved === 'dark';
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [iframeHeight, setIframeHeight] = useState(200);

  const bgRaw = getComputedStyle(document.documentElement).getPropertyValue('--bg');
  const bgParsed = parseHexColor(bgRaw) ?? [28, 30, 32];
  const [bgR, bgG, bgB] = bgParsed;
  const bgCss = `rgb(${bgR}, ${bgG}, ${bgB})`;

  useEffect(() => () => resizeObserverRef.current?.disconnect(), []);

  useEffect(() => {
    setIframeHeight(200);
  }, [html, bodyText, resolved, fontSize]);

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
  /* Applying the involutive filter a second time keeps media colours unchanged.
     !important prevents styles embedded by the sender from overriding it. */
  .ew img, .ew video, .ew canvas, .ew iframe, .ew svg, .ew .qt-toggle {
    filter: url(#dm) !important;
  }
  .ew .ew-bg-media-host { isolation: isolate; }
  .ew .ew-bg-media-layer {
    position: absolute !important;
    inset: 0 !important;
    z-index: -1 !important;
    display: block !important;
    pointer-events: none !important;
    border-radius: inherit;
    filter: url(#dm) !important;
  }` : '';

  const prevMsgLabel = t('mail.previousMessage', 'Previous message');
  const attributionTemplate = t('mail.quoteAttribution', {
    date: '%DATE%', sender: '%SENDER%', defaultValue: 'On %DATE%, %SENDER% wrote:',
  });

  // Detect quote boundary from plain text, then pass the marker to the iframe script.
  const quoteMarker = bodyText ? findQuoteMarker(bodyText) : null;

  const safeHtml = sanitizeEmailHtml(disableSenderDarkModeCss(html))
    .replaceAll(/\bsrc=["']cid:[^"']*["']/gi, 'src=""');

  const handleFrameLoad = () => {
    const frame = iframeRef.current;
    const doc = frame?.contentDocument;
    if (!frame || !doc?.body || !doc.documentElement) return;

    const root = doc.querySelector<HTMLElement>('.ew') ?? doc.body;
    processEmailQuotes(root, { label: prevMsgLabel, quoteMarker, attributionTemplate });

    if (isDark) {
      doc.querySelectorAll<HTMLElement>('.ew *').forEach(element => {
        if (element.matches('img, video, canvas, iframe, svg, .qt-toggle')) return;
        const computed = frame.contentWindow?.getComputedStyle(element);
        if (!computed?.backgroundImage || computed.backgroundImage === 'none') return;
        const layer = doc.createElement('span');
        layer.className = 'ew-bg-media-layer';
        for (const [property, value] of [
          ['background-image', computed.backgroundImage], ['background-size', computed.backgroundSize],
          ['background-position', computed.backgroundPosition], ['background-repeat', computed.backgroundRepeat],
          ['background-origin', computed.backgroundOrigin], ['background-clip', computed.backgroundClip],
          ['background-attachment', computed.backgroundAttachment],
        ]) layer.style.setProperty(property, value, 'important');
        if (computed.position === 'static') element.style.setProperty('position', 'relative', 'important');
        element.style.setProperty('background-image', 'none', 'important');
        element.classList.add('ew-bg-media-host');
        element.insertBefore(layer, element.firstChild);
      });
    }

    const resize = () => {
      const height = Math.max(
        doc.body.scrollHeight, doc.body.offsetHeight,
        doc.documentElement.scrollHeight, doc.documentElement.offsetHeight,
      );
      if (height > 0) setIframeHeight(height + 4);
    };
    resizeObserverRef.current?.disconnect();
    const observer = new ResizeObserver(resize);
    observer.observe(doc.body);
    observer.observe(doc.documentElement);
    resizeObserverRef.current = observer;
    doc.addEventListener('load', resize, true);
    doc.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(anchor => {
      const href = anchor.href;
      if (!href || href.startsWith('javascript:')) {
        anchor.removeAttribute('href');
        return;
      }
      anchor.removeAttribute('href');
      anchor.setAttribute('role', 'link');
      anchor.tabIndex = 0;
      const openLink = (event: Event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        openExternalUrl(href);
      };
      anchor.addEventListener('click', openLink, true);
      anchor.addEventListener('keydown', event => {
        if (event.key === 'Enter') openLink(event);
      }, true);
    });
    resize();
  };

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
  .qt-attribution { margin: 4px 0 10px; font-size: ${12 * fontScale}px; color: #5f6368; }
</style>
</head>
<body>${darkModeSvg}<div class="ew">${safeHtml}</div></body>
</html>`;

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcdoc}
      sandbox="allow-same-origin allow-scripts"
      onLoad={handleFrameLoad}
      className="mail-email-iframe"
      title="email-body"
      style={{ height: iframeHeight }}
    />
  );
}
