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
    /^-{3,}[^\n]{0,40}-{3,}$/,
    /^_{5,}$/,
    /^On\s[\s\S]+wrote:\s*$/,
    /^Le\s[\s\S]+a\sécrit\s*:\s*$/,
  ];

  function isDividerText(text: string): boolean {
    const t = text.trim();
    return DIVIDER_RE.some(re => re.test(t));
  }

  function isQuote(el: Element): boolean {
    const cls = typeof (el as HTMLElement).className === 'string' ? (el as HTMLElement).className : '';
    if (el.tagName !== 'BLOCKQUOTE' && !cls.includes('mail-quoted')) return false;
    // Skip very short blockquotes — they are header fields (From:, To:, Date:…)
    // that should stay visible as indented text, not become individual toggles.
    const text = (el.textContent ?? '').trim();
    const hasBlockChildren = !!el.querySelector('p,div,blockquote,table,ul,ol');
    return text.length >= 80 || hasBlockChildren;
  }

  function makeToggle(depth: number): { wrapper: HTMLElement; inner: HTMLElement } {
    const d = depth % 4;
    const color = COLORS[d];
    const rgb = BG_RGBS[d];
    const w = document.createElement('div');
    w.className = 'qt';
    w.style.borderLeft = `3px solid ${color}`;
    w.style.background = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.06)`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'qt-toggle';
    btn.style.color = color;
    const chev = document.createElement('span');
    chev.className = 'qt-chevron';
    chev.textContent = '▶';
    const lbl = document.createElement('span');
    lbl.textContent = label;
    btn.appendChild(chev);
    btn.appendChild(lbl);
    const inner = document.createElement('div');
    inner.className = 'qt-inner';
    inner.style.display = 'none';
    w.appendChild(btn);
    w.appendChild(inner);
    btn.addEventListener('click', (e: Event) => {
      e.stopPropagation();
      const open = inner.style.display !== 'none';
      inner.style.display = open ? 'none' : '';
      chev.textContent = open ? '▶' : '▼';
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
      if (isQuote(child)) {
        wrap(child, depth);
        children = Array.from(node.children);
      } else {
        const childText = child.textContent ?? '';
        const isLeafLike = child.children.length === 0 || childText.trim().length < 200;
        const isDiv = isLeafLike && (
          (quoteMarker != null && childText.trim() === quoteMarker) ||
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
    /^-{3,}[^\n]{0,40}-{3,}$/,
    /^_{5,}$/,
    /^On\s[\s\S]{10,}wrote:\s*$/,
    /^Le\s[\s\S]+a\sécrit\s*:\s*$/,
  ];
  for (const line of bodyText.split('\n')) {
    const t = line.trim();
    if (t && DIVIDERS.some(re => re.test(t))) return t;
    if (t.startsWith('>')) return t;
  }
  return null;
}
