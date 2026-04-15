import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../../shared/store/ThemeStore';
import { invoke } from '@tauri-apps/api/core';

function parseHexColor(raw: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(raw.trim());
  return m ? [Number.parseInt(m[1], 16), Number.parseInt(m[2], 16), Number.parseInt(m[3], 16)] : null;
}

export function EmailHtmlBody({ html }: { readonly html: string }) {
  const { t } = useTranslation();
  const { resolved } = useTheme();
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
    font-size: 14px; line-height: 1.6;
    color: #202124; background: #fff;
    word-break: break-word; overflow-wrap: anywhere;
  }
  img { max-width: 100%; height: auto; }
  a { color: #1a73e8; cursor: pointer; }
  pre, code { white-space: pre-wrap; word-break: break-all; font-size: 13px; }
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
    font-size: 12px; font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
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
    function isQuote(el) {
      if (!el || el.nodeType !== 1) return false;
      var cls = typeof el.className === 'string' ? el.className : '';
      return el.tagName === 'BLOCKQUOTE' || cls.indexOf('mail-quoted') >= 0;
    }
    function wrap(el, depth) {
      var d = depth % 4;
      var color = COLORS[d];
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
      while (el.firstChild) inner.appendChild(el.firstChild);
      w.appendChild(btn);
      w.appendChild(inner);
      if (el.parentNode) el.parentNode.replaceChild(w, el);
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var open = inner.style.display !== 'none';
        inner.style.display = open ? 'none' : '';
        chev.textContent = open ? '\\u25b6' : '\\u25bc';
        window.parent.postMessage({ type: 'resize', height: document.body.scrollHeight }, '*');
      });
      processEl(inner, depth + 1);
    }
    function processEl(node, depth) {
      Array.from(node.children).forEach(function(child) {
        if (isQuote(child)) wrap(child, depth);
        else processEl(child, depth);
      });
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
