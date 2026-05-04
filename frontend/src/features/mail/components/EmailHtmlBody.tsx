import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../../shared/store/ThemeStore';
import { useFontSize } from '../../../shared/store/FontSizeStore';
import { invoke } from '@tauri-apps/api/core';

function parseHexColor(raw: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(raw.trim());
  return m ? [Number.parseInt(m[1], 16), Number.parseInt(m[2], 16), Number.parseInt(m[3], 16)] : null;
}

/**
 * Find the first line in the plain text body that marks the start of a quoted
 * reply (Outlook separator, "On … wrote:", "> " prefix, etc.).
 */
function findQuoteMarker(bodyText: string): string | null {
  const DIVIDERS = [
    /^-{3,}[^\n]{0,40}-{3,}$/,           // -----Original Message-----
    /^_{5,}$/,                              // ___________
    /^On\s[\s\S]{10,}wrote:\s*$/,           // On [date] [person] wrote:
    /^Le\s[\s\S]+a\sécrit\s*:\s*$/,   // Le [date] [person] a écrit :
  ];
  for (const line of bodyText.split('\n')) {
    const t = line.trim();
    if (t && DIVIDERS.some(re => re.test(t))) return t;
    // First line that starts with "> " means the whole block is quoted
    if (t.startsWith('>')) return t;
  }
  return null;
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
    display: flex; align-items: center; gap: 6px;
    background: none; border: none;
    padding: 5px 10px; width: 100%;
    text-align: left; cursor: pointer;
    font-size: ${12 * fontScale}px; font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
  }
  .qt-toggle:hover { opacity: 0.75; }
  .qt-chevron { font-size: 10px; }
  .qt-inner { padding: 0 12px 10px; }${darkModeStyle}
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
    var COLORS = ['hsl(210,70%,55%)', 'hsl(145,55%,45%)', 'hsl(35,80%,50%)', 'hsl(300,45%,55%)'];
    var BG_RGBS = [[100,160,220], [60,180,100], [220,150,50], [180,80,200]];

    // Text-based quote divider patterns (Outlook, Exchange, various clients).
    // Only match lines that ARE the separator itself — not header fields like From:/To:
    // which follow the separator and should stay inside the collapsible block.
    var DIVIDER_RE = [
      /^-{3,}[^\\n]{0,40}-{3,}$/,
      /^_{5,}$/,
      /^On\\s[\\s\\S]+wrote:\\s*$/,
      /^Le\\s[\\s\\S]+a\\s\\u00e9crit\\s*:\\s*$/,
    ];

    function isDividerText(text) {
      var t = text.trim();
      return DIVIDER_RE.some(function(re) { return re.test(t); });
    }

    function isQuote(el) {
      if (!el || el.nodeType !== 1) return false;
      var cls = typeof el.className === 'string' ? el.className : '';
      if (el.tagName !== 'BLOCKQUOTE' && cls.indexOf('mail-quoted') < 0) return false;
      // Don't individually collapse tiny blockquotes — they are header fields
      // (From:, To:, Date:…) that appear inside a quoted section and should
      // stay visible as plain indented text, not become separate toggles.
      var text = (el.textContent || '').trim();
      var hasBlockChildren = !!el.querySelector('p,div,blockquote,table,ul,ol');
      return text.length >= 80 || hasBlockChildren;
    }

    // quoteMarker: the first line of the quoted fragment detected from plain text
    var quoteMarker = ${quoteMarker ? JSON.stringify(quoteMarker) : 'null'};

    function makeToggle(color, depth) {
      var d = depth % 4;
      color = COLORS[d];
      var rgb = BG_RGBS[d];
      var w = document.createElement('div');
      w.className = 'qt';
      w.style.borderLeft = '3px solid ' + color;
      w.style.background = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0.06)';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'qt-toggle';
      btn.style.color = color;
      var chev = document.createElement('span');
      chev.className = 'qt-chevron';
      chev.textContent = '\\u25b6';
      var lbl = document.createElement('span');
      lbl.textContent = ${JSON.stringify(prevMsgLabel)};
      btn.appendChild(chev);
      btn.appendChild(lbl);
      var inner = document.createElement('div');
      inner.className = 'qt-inner';
      inner.style.display = 'none';
      w.appendChild(btn);
      w.appendChild(inner);
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var open = inner.style.display !== 'none';
        inner.style.display = open ? 'none' : '';
        chev.textContent = open ? '\\u25b6' : '\\u25bc';
        window.parent.postMessage({ type: 'resize', height: document.body.scrollHeight }, '*');
      });
      return { wrapper: w, inner: inner };
    }

    function wrap(el, depth) {
      var t = makeToggle(null, depth);
      while (el.firstChild) t.inner.appendChild(el.firstChild);
      if (el.parentNode) el.parentNode.replaceChild(t.wrapper, el);
      processEl(t.inner, depth + 1);
    }

    // Wrap all siblings AFTER the divider element into one toggle, replacing the
    // divider itself with the wrapper. The divider is discarded (the toggle button
    // already says "Previous message"). This avoids infinite recursion: the divider
    // never ends up inside t.inner so it cannot re-trigger wrapSiblingsFrom.
    function wrapSiblingsFrom(el, depth) {
      var parent = el.parentNode;
      if (!parent) return;
      var toMove = [];
      var cur = el.nextSibling;
      while (cur) { toMove.push(cur); cur = cur.nextSibling; }
      if (toMove.length === 0) {
        // Nothing after the divider — just remove the separator line.
        parent.removeChild(el);
        return;
      }
      var t = makeToggle(null, depth);
      toMove.forEach(function(node) { t.inner.appendChild(node); });
      parent.replaceChild(t.wrapper, el);
      processEl(t.inner, depth + 1);
    }

    function processEl(node, depth) {
      var children = Array.from(node.children);
      for (var i = 0; i < children.length; i++) {
        var child = children[i];
        if (isQuote(child)) {
          wrap(child, depth);
          // Re-read children after DOM mutation
          children = Array.from(node.children);
        } else {
          // Only test leaf-like elements (no deep children) as dividers to avoid
          // false positives on container divs whose textContent includes "From:".
          var childText = child.textContent || '';
          var isLeafLike = child.children.length === 0 || childText.trim().length < 200;
          var isDiv = isLeafLike && (
            (quoteMarker && childText.trim() === quoteMarker) || isDividerText(childText)
          );
          if (isDiv) {
            wrapSiblingsFrom(child, depth);
            return;
          }
          processEl(child, depth);
        }
      }
    }

    processEl(document.querySelector('.ew') || document.body, 0);
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
