const DISABLED_DARK_MEDIA_QUERY = '(min-width: 0px) and (max-width: -1px)';

/** Isolate complete emoji sequences so the media counter-filter preserves their colours. */
export function protectEmailEmojis(root: HTMLElement): void {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  const emoji = /(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})*(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})*)*(?:[\u{E0020}-\u{E007E}]+\u{E007F})?)/gu;
  for (const node of nodes) {
    if (node.parentElement?.closest('style, script, textarea, svg, .ew-emoji')) continue;
    const text = node.data;
    const fragment = doc.createDocumentFragment();
    let offset = 0;
    for (const match of text.matchAll(emoji)) {
      fragment.append(text.slice(offset, match.index));
      const span = doc.createElement('span');
      span.className = 'ew-emoji';
      span.textContent = match[0];
      fragment.append(span);
      offset = match.index! + match[0].length;
    }
    if (offset === 0) continue;
    fragment.append(text.slice(offset));
    node.replaceWith(fragment);
  }
}

/**
 * Email HTML is rendered from its light palette and inverted by EmailHtmlBody.
 * Disable sender-provided dark media queries so both transformations are not
 * applied at the same time when the operating system is in dark mode.
 */
export function disableSenderDarkModeCss(html: string): string {
  return html.replace(
    /\(\s*prefers-color-scheme\s*:\s*dark\s*\)/gi,
    DISABLED_DARK_MEDIA_QUERY,
  );
}
