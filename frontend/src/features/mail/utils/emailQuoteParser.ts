export interface QuoteParserOptions {
  label: string;
  quoteMarker?: string | null;
}

/**
 * Self-contained DOM transformer: wraps quoted reply sections in collapsible
 * toggles. All sub-functions are defined inside so that
 * `processEmailQuotes.toString()` produces self-sufficient JavaScript that can
 * be injected verbatim into an iframe <script> tag.
 */
export function processEmailQuotes(ew: Element, opts: QuoteParserOptions): void {
  const { label, quoteMarker } = opts;

  const COLORS = ['hsl(210,70%,55%)', 'hsl(145,55%,45%)', 'hsl(35,80%,50%)', 'hsl(300,45%,55%)'];
  const BG_RGBS: [number, number, number][] = [[100, 160, 220], [60, 180, 100], [220, 150, 50], [180, 80, 200]];

  const DIVIDER_RE = [
    /^-{2,}\s*(?:original|forwarded)\s+message\s*-{2,}$/i,
    /^-{3,}[^\n]{0,60}-{3,}$/,
    /^_{5,}$/,
    /^On\s[\s\S]+wrote\s*:\s*$/i,
    /^Le\s[\s\S]+a\s+écrit\s*:\s*$/i,
    /^Am\s[\s\S]+schrieb[\s\S]*:\s*$/i,
    /^El\s[\s\S]+escribió\s*:\s*$/i,
  ];

  const QUOTE_SELECTORS = [
    '.gmail_quote', '.yahoo_quoted', '.protonmail_quote', 'blockquote[type="cite"]',
    '.moz-cite-prefix + blockquote', '[data-skiff-mail="quoted-text"]',
    // Outlook prefixes ids with one additional `x_` every time a message is
    // quoted. Matching the suffix therefore works at every nesting depth.
    '[id$="mail-editor-reference-message-container"]',
  ];

  const HEADER_FIELD_RE = /^(?:from|to|cc|bcc|date|sent|subject|de|à|envoyé|objet)\s*:/i;

  function normaliseText(text: string): string {
    return text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function isDividerText(text: string): boolean {
    const t = text.trim();
    return DIVIDER_RE.some(re => re.test(t));
  }

  function isQuote(el: Element, depth: number): boolean {
    const cls = typeof (el as HTMLElement).className === 'string' ? (el as HTMLElement).className : '';
    const isKnownContainer = QUOTE_SELECTORS.some(selector => el.matches(selector));
    if (el.tagName !== 'BLOCKQUOTE' && !cls.includes('mail-quoted') && !isKnownContainer) return false;
    if (isKnownContainer || cls.includes('mail-quoted')) return true;
    // Skip very short blockquotes — they are header fields (From:, To:, Date:…)
    // that should stay visible as indented text, not become individual toggles.
    const text = (el.textContent ?? '').trim();
    const hasBlockChildren = !!el.querySelector('p,div,blockquote,table,ul,ol');
    // Once a real quote has been opened, even a short nested blockquote is a
    // genuine older level. Keep ignoring blockquotes used as mail header rows.
    return text.length >= 80 || hasBlockChildren || (depth > 0 && !HEADER_FIELD_RE.test(text));
  }

  function makeToggle(depth: number): { wrapper: HTMLElement; inner: HTMLElement } {
    const d = depth % 4;
    const color = COLORS[d];
    const rgb = BG_RGBS[d];
    const w = document.createElement('div');
    w.className = 'qt';
    w.dataset.quoteDepth = String(depth + 1);
    w.style.borderLeft = `3px solid ${color}`;
    w.style.background = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.06)`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'qt-toggle';
    btn.style.color = color;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-expanded', 'false');
    const dots = document.createElement('span');
    dots.className = 'qt-dots';
    dots.setAttribute('aria-hidden', 'true');
    dots.textContent = '•••';
    btn.appendChild(dots);
    const inner = document.createElement('div');
    inner.className = 'qt-inner';
    inner.style.display = 'none';
    w.appendChild(btn);
    w.appendChild(inner);
    btn.addEventListener('click', (e: Event) => {
      e.stopPropagation();
      const open = inner.style.display !== 'none';
      inner.style.display = open ? 'none' : '';
      btn.setAttribute('aria-expanded', String(!open));
    });
    return { wrapper: w, inner };
  }

  function wrap(el: Element, depth: number): void {
    const t = makeToggle(depth);
    while (el.firstChild) t.inner.appendChild(el.firstChild);
    el.parentNode?.replaceChild(t.wrapper, el);
    processNode(t.inner, depth + 1);
  }

  function wrapSiblingsFrom(el: Element, depth: number): void {
    const parent = el.parentNode;
    if (!parent) return;
    const toMove: Node[] = [];
    let cur: Node | null = el.nextSibling;
    while (cur) {
      // Skip pure-whitespace text nodes so they don't count as "content".
      const isEmpty = cur.nodeType === 3 && (cur.textContent ?? '').trim() === '';
      if (!isEmpty) toMove.push(cur);
      cur = cur.nextSibling;
    }
    if (toMove.length === 0) {
      parent.removeChild(el);
      return;
    }
    const t = makeToggle(depth);
    for (const node of toMove) t.inner.appendChild(node);
    parent.replaceChild(t.wrapper, el);
    processNode(t.inner, depth + 1);
  }

  function processNode(node: Element, depth: number): void {
    let children = Array.from(node.children);
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (isQuote(child, depth)) {
        wrap(child, depth);
        children = Array.from(node.children);
      } else {
        const childText = child.textContent ?? '';
        const text = normaliseText(childText);
        const marker = quoteMarker == null ? null : normaliseText(quoteMarker);
        const isOutlookHeader = child.id.endsWith('divRplyFwdMsg') || child.id.endsWith('reply139content');
        const isLeafLike = child.children.length === 0 || text.length < 300 || isOutlookHeader;
        const isDiv = isLeafLike && (
          isOutlookHeader ||
          (marker != null && (text === marker || text.startsWith(marker))) ||
          isDividerText(childText)
        );
        if (isDiv) {
          wrapSiblingsFrom(child, depth);
          return;
        }
        processNode(child, depth);
      }
    }
  }

  processNode(ew, 0);
}

/** Pure helper — also exported for unit tests. */
export function findQuoteMarker(bodyText: string): string | null {
  const DIVIDERS = [
    /^-{2,}\s*(?:original|forwarded)\s+message\s*-{2,}$/i,
    /^-{3,}[^\n]{0,60}-{3,}$/,
    /^_{5,}$/,
    /^On\s[\s\S]{10,}wrote\s*:\s*$/i,
    /^Le\s[\s\S]+a\s+écrit\s*:\s*$/i,
    /^Am\s[\s\S]+schrieb[\s\S]*:\s*$/i,
    /^El\s[\s\S]+escribió\s*:\s*$/i,
  ];
  for (const line of bodyText.split('\n')) {
    const t = line.trim();
    if (t && DIVIDERS.some(re => re.test(t))) return t;
    if (t.startsWith('>')) return t;
  }
  return null;
}

/**
 * Convert the same quote boundaries used by the read view into editable
 * `mail-quoted` nodes understood by Tiptap. `levelOffset` reserves level 1 for
 * the message being replied to; its older replies therefore start at level 2.
 */
export function formatEmailQuotesForEditor(
  html: string,
  bodyText?: string,
  levelOffset = 1,
): string {
  const root = document.createElement('div');
  root.innerHTML = html;
  processEmailQuotes(root, {
    label: 'Previous message',
    quoteMarker: bodyText ? findQuoteMarker(bodyText) : null,
  });

  const wrappers = Array.from(root.querySelectorAll<HTMLElement>('.qt'));
  for (const wrapper of wrappers) {
    const depth = Number.parseInt(wrapper.dataset.quoteDepth ?? '1', 10);
    const inner = Array.from(wrapper.children).find(el => el.classList.contains('qt-inner')) as HTMLElement | undefined;
    const button = Array.from(wrapper.children).find(el => el.classList.contains('qt-toggle'));
    button?.remove();
    const level = ((depth + levelOffset - 1) % 4) + 1;
    wrapper.className = `mail-quoted mail-quoted--level-${level}`;
    wrapper.removeAttribute('style');
    wrapper.removeAttribute('data-quote-depth');
    if (inner) {
      inner.removeAttribute('style');
      const body = document.createElement('div');
      body.className = 'mail-quoted__body';
      while (inner.firstChild) body.appendChild(inner.firstChild);
      inner.replaceWith(body);
    }
  }
  return root.innerHTML;
}
