export interface QuoteParserOptions {
  label: string;
  quoteMarker?: string | null;
  attributionTemplate?: string;
}

/**
 * Self-contained DOM transformer: wraps quoted reply sections in collapsible
 * toggles. All sub-functions are defined inside so that
 * `processEmailQuotes.toString()` produces self-sufficient JavaScript that can
 * be injected verbatim into an iframe <script> tag.
 */
export function processEmailQuotes(ew: Element, opts: QuoteParserOptions): void {
  const { label, quoteMarker, attributionTemplate } = opts;

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
    '.yahoo_quoted', '.protonmail_quote', 'blockquote[type="cite"]',
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

  function looksLikeOutlookHeader(el: Element | null): boolean {
    if (!el) return false;
    // A message-level wrapper can contain several historical Outlook headers.
    // Treating that wrapper itself as a header removes the complete current
    // message when wrapSiblingsFrom() replaces it. Real header blocks are
    // compact; large containers must be traversed instead.
    const fullText = normaliseText(el.textContent ?? '');
    if (fullText.length > 2000) return false;
    // A parent message container may contain header labels somewhere deep in
    // its quoted subtree. It is not itself a header and must never be removed.
    if (el.querySelector(
      'hr,[data-marker="__DIVIDER__"],[data-marker="__QUOTED_TEXT__"],table',
    )) return false;
    const labels = Array.from(el.querySelectorAll('b,strong'))
      .map(label => normaliseText(label.textContent ?? '').replace(/\s+/g, '').toLowerCase());
    const headerLabels = labels.filter(label =>
      /^(?:de|from|envoyé|sent|à|to|objet|subject):$/.test(label),
    );
    if (headerLabels.length >= 3) return true;

    // EWS may strip the <b> elements and data-marker attributes from forwarded
    // HTML. Fall back to the visible sequence of header labels.
    const text = normaliseText(el.textContent ?? '').toLowerCase();
    const groups = [
      text.startsWith('de:') || text.startsWith('from:'),
      text.includes('envoyé:') || text.includes('sent:') || text.includes('date:'),
      text.includes('à:') || text.includes('to:'),
      text.includes('objet:') || text.includes('subject:'),
    ];
    return groups.filter(Boolean).length >= 3;
  }

  function nextMeaningfulElement(el: Element): Element | null {
    let next = el.nextElementSibling;
    let skipped = 0;
    while (next && skipped < 3 && normaliseText(next.textContent ?? '') === '' &&
      !next.matches('img,table,[data-marker="__QUOTED_TEXT__"]')) {
      next = next.nextElementSibling;
      skipped++;
    }
    return next;
  }

  function textWithLineBreaks(el: Element): string {
    const clone = el.cloneNode(true) as Element;
    for (const br of Array.from(clone.querySelectorAll('br'))) br.replaceWith('\n');
    return clone.textContent ?? '';
  }

  function quotedAttribution(el: Element): string | null {
    let prefix = '';
    for (const node of Array.from(el.childNodes)) {
      if (node instanceof HTMLBRElement) break;
      // Stop at the first body container: an attribution belongs to this quote
      // only when it is at its beginning, never somewhere in a nested reply.
      if (node instanceof Element && !node.matches('a,span,font')) break;
      prefix += node.textContent ?? '';
    }
    const directLine = normaliseText(prefix);
    if (directLine.length < 500 && isDividerText(directLine)) return directLine;

    // Front places the attribution either as the leading inline content of a
    // blockquote, or in its first <div> before the quoted body.
    for (const candidate of Array.from(el.children).slice(0, 3)) {
      const text = normaliseText(candidate.textContent ?? '');
      if (text.length < 500 && isDividerText(text)) return text;
    }
    return null;
  }

  function removeContainedAttribution(el: Element, attribution: string | null): void {
    if (!attribution) return;
    const candidate = Array.from(el.children).find(node =>
      normaliseText(node.textContent ?? '') === attribution,
    );
    if (candidate) {
      candidate.remove();
      return;
    }

    // Inline Front attribution: text + link + text, terminated by the first
    // <br>. Remove that prefix so it is not repeated below our own heading.
    const prefix: Node[] = [];
    let text = '';
    for (const node of Array.from(el.childNodes)) {
      prefix.push(node);
      if (node instanceof HTMLBRElement) break;
      text += node.textContent ?? '';
    }
    if (normaliseText(text) === attribution) {
      prefix.forEach(node => node.parentNode?.removeChild(node));
    }
  }

  function buildAttribution(el: Element | null): string | null {
    if (!el) return null;
    const gmail = el.matches('.gmail_attr') ? el :
      Array.from(el.children).find(child => child.matches('.gmail_attr')) ?? null;
    if (gmail) return normaliseText(gmail.textContent ?? '') || null;
    const quoted = quotedAttribution(el);
    if (quoted) return quoted;
    if (!attributionTemplate) return null;

    const lines = textWithLineBreaks(el).split('\n').map(normaliseText).filter(Boolean);
    const senderLine = lines.find(line => /^(?:de|from)\s*:/i.test(line));
    const dateLine = lines.find(line => /^(?:envoyé|sent|date)\s*:/i.test(line));
    if (!senderLine || !dateLine) return null;
    const sender = senderLine.replace(/^(?:de|from)\s*:\s*/i, '');
    const date = dateLine.replace(/^(?:envoyé|sent|date)\s*:\s*/i, '');
    if (!sender || !date) return null;
    return attributionTemplate.replace('%DATE%', date).replace('%SENDER%', sender);
  }

  function isQuote(el: Element, depth: number): boolean {
    const cls = typeof (el as HTMLElement).className === 'string' ? (el as HTMLElement).className : '';
    // Outlook sometimes stamps `gmail_quote` on every paragraph imported from
    // Gmail. Only the actual wrapper (containing an attribution or blockquote)
    // represents a message boundary.
    const isGmailContainer = el.matches('.gmail_quote') &&
      !!el.querySelector('.gmail_attr, blockquote');
    const isKnownContainer = isGmailContainer || QUOTE_SELECTORS.some(selector => el.matches(selector));
    if (el.tagName !== 'BLOCKQUOTE' && !cls.includes('mail-quoted') && !isKnownContainer) return false;
    if (isKnownContainer || cls.includes('mail-quoted')) return true;
    // Skip very short blockquotes — they are header fields (From:, To:, Date:…)
    // that should stay visible as indented text, not become individual toggles.
    const text = (el.textContent ?? '').trim();
    const hasBlockChildren = !!el.querySelector('p,div,blockquote,table,ul,ol');
    // Malformed Gmail signatures can contain one blockquote per signature row.
    // They remain part of the current message rather than becoming new levels.
    const hasDirectSignature = Array.from(el.children).some(child => child.matches('.gmail_signature'));
    if (hasDirectSignature && !el.querySelector('.gmail_attr')) return false;
    // Forwarded Gmail chains sometimes accumulate empty blockquote shells.
    // If the first meaningful child is another blockquote, this level carries
    // no message of its own and must remain transparent.
    const firstMeaningfulChild = Array.from(el.children).find(child =>
      child.tagName === 'BLOCKQUOTE' || normaliseText(child.textContent ?? '') !== '' ||
      child.matches('img,table,ul,ol') || !!child.querySelector('img,table,ul,ol'),
    );
    if (firstMeaningfulChild?.tagName === 'BLOCKQUOTE') return false;
    // Once a real quote has been opened, even a short nested blockquote is a
    // genuine older level. Keep ignoring blockquotes used as mail header rows.
    return text.length >= 80 || hasBlockChildren || (depth > 0 && !HEADER_FIELD_RE.test(text));
  }

  function makeToggle(depth: number, attribution?: string | null): { wrapper: HTMLElement; inner: HTMLElement } {
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
    const attributionEl = document.createElement('div');
    attributionEl.className = 'qt-attribution';
    attributionEl.textContent = attribution || label;
    inner.appendChild(attributionEl);
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
    // A genuine Gmail wrapper already represents the message level. Mark its
    // attribution/body pair so processing its children does not add a second.
    if (el.matches('.gmail_quote, blockquote')) {
      const attribution = Array.from(el.children).find(child => child.matches('.gmail_attr'));
      const body = attribution?.nextElementSibling;
      attribution?.setAttribute('data-qt-contained-attribution', '');
      if (body?.tagName === 'BLOCKQUOTE') body.setAttribute('data-qt-gmail-body', '');
    }
    // Outlook's reference container is already the message boundary. Its
    // first De/Date/À/Objet block only describes that same message and must
    // remain visible without creating a duplicate nested quote level.
    if (el.id.endsWith('mail-editor-reference-message-container')) {
      const containedHeader = Array.from(el.children).find(child => looksLikeOutlookHeader(child));
      containedHeader?.setAttribute('data-qt-contained-outlook-header', '');
    }
    const attribution = buildAttribution(el);
    removeContainedAttribution(el, attribution);
    const t = makeToggle(depth, attribution);
    while (el.firstChild) t.inner.appendChild(el.firstChild);
    el.parentNode?.replaceChild(t.wrapper, el);
    processNode(t.inner, depth + 1);
  }

  function wrapAttributionAndBlockquote(attribution: Element, body: Element, depth: number): void {
    const parent = attribution.parentNode;
    if (!parent || body.parentNode !== parent) return;
    const t = makeToggle(depth, buildAttribution(attribution) || buildAttribution(body));
    while (body.firstChild) t.inner.appendChild(body.firstChild);
    parent.replaceChild(t.wrapper, attribution);
    body.remove();
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
    const attributionSource = el.tagName === 'HR' ? nextMeaningfulElement(el) : el;
    const t = makeToggle(depth, buildAttribution(attributionSource));
    for (const node of toMove) t.inner.appendChild(node);
    parent.replaceChild(t.wrapper, el);
    processNode(t.inner, depth + 1);
  }

  function processNode(node: Element, depth: number): void {
    let children = Array.from(node.children);
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      // Generated UI text can itself match "Le … a écrit :". It is metadata
      // for the current folded block, never another quote boundary.
      if (child.classList.contains('qt-attribution')) continue;
      // `.gmail_attr` describes the immediately following blockquote; together
      // they are one historical message, not two nested levels.
      const isMarkedGmailBody = child.hasAttribute('data-qt-gmail-body');
      if (isMarkedGmailBody) child.removeAttribute('data-qt-gmail-body');
      const isGmailBodyBlockquote = isMarkedGmailBody || (child.tagName === 'BLOCKQUOTE' &&
        child.previousElementSibling?.matches('.gmail_attr'));
      if (!isGmailBodyBlockquote && isQuote(child, depth)) {
        wrap(child, depth);
        children = Array.from(node.children);
      } else {
        const childText = child.textContent ?? '';
        const text = normaliseText(childText);
        const marker = quoteMarker == null ? null : normaliseText(quoteMarker);
        const isContainedOutlookHeader = child.hasAttribute('data-qt-contained-outlook-header');
        if (isContainedOutlookHeader) child.removeAttribute('data-qt-contained-outlook-header');
        if (isContainedOutlookHeader) continue;
        const isOutlookHeader = !isContainedOutlookHeader && (
          child.id.endsWith('divRplyFwdMsg') || child.id.endsWith('reply139content') ||
          looksLikeOutlookHeader(child)
        );
        // Some Outlook desktop messages expose only an <hr>; the following
        // sibling is the unclassified De/Envoyé/À/Objet header block.
        const nextAfterDivider = nextMeaningfulElement(child);
        const isOutlookHr = child.tagName === 'HR' && (
          child.id.toLowerCase() === 'zwchr' || looksLikeOutlookHeader(nextAfterDivider)
        );
        // Zimbra and some Outlook Web forwards preserve explicit boundary
        // markers. Prefer these over visual/text heuristics when available.
        const isExplicitMailDivider = child.getAttribute('data-marker') === '__DIVIDER__';
        // Gmail puts the attribution directly before its blockquote. The
        // blockquote is the boundary; wrapping both would create a duplicate
        // empty level and discard the attribution line.
        const isContainedGmailAttribution = child.hasAttribute('data-qt-contained-attribution');
        if (isContainedGmailAttribution) child.removeAttribute('data-qt-contained-attribution');
        const isLeafLike = child.children.length === 0 || text.length < 300 || isOutlookHeader;
        const isDiv = !isContainedGmailAttribution && isLeafLike && (
          isExplicitMailDivider ||
          isOutlookHr ||
          isOutlookHeader ||
          (marker != null && (text === marker || text.startsWith(marker))) ||
          isDividerText(childText)
        );
        if (isDiv) {
          if (isOutlookHr || isExplicitMailDivider) {
            nextAfterDivider?.setAttribute('data-qt-contained-outlook-header', '');
          }
          if (child.matches('.gmail_attr') && child.nextElementSibling?.tagName === 'BLOCKQUOTE') {
            child.nextElementSibling.setAttribute('data-qt-gmail-body', '');
          }
          // Front emits `On … wrote:` as a sibling immediately followed by a
          // cite blockquote. They form one message boundary. Wrapping the line
          // and then the blockquote created a spurious empty coloured level.
          if (isDividerText(childText) && nextAfterDivider?.tagName === 'BLOCKQUOTE') {
            wrapAttributionAndBlockquote(child, nextAfterDivider, depth);
            children = Array.from(node.children);
            continue;
          }
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
      // Attribution is read-view UI. The original mail headers remain in the
      // editable content and must not be duplicated in the outgoing message.
      Array.from(inner.children)
        .filter(child => child.classList.contains('qt-attribution'))
        .forEach(child => child.remove());
      const body = document.createElement('div');
      body.className = 'mail-quoted__body';
      while (inner.firstChild) body.appendChild(inner.firstChild);
      inner.replaceWith(body);
    }
  }
  return root.innerHTML;
}
