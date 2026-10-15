import type { MailContentRule } from '../../../shared/store/MailContentRulesStore';

// Keep original offsets so matching across inline HTML never removes neighbouring content.
function normalized(text: string) {
  let value = '';
  const starts: number[] = [], ends: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i].replace(/[’‘]/g, "'").toLowerCase();
    if (/[\u200B-\u200D\uFEFF\u00AD]/.test(char)) continue;
    if (/\s/.test(char)) {
      if (value.endsWith(' ')) { ends[ends.length - 1] = i + 1; continue; }
      value += ' ';
    } else value += char;
    for (let j = 0; j < char.length; j++) { starts.push(i); ends.push(i + 1); }
  }
  return { value, starts, ends };
}

export function filterMailText(text: string, rules: MailContentRule[], truncated = false): string {
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const needle = normalized(rule.text).value.trim();
    if (!needle) continue;
    let source = normalized(text);
    let index = source.value.indexOf(needle);
    while (index >= 0) {
      text = text.slice(0, source.starts[index]) + text.slice(source.ends[index + needle.length - 1]);
      source = normalized(text); index = source.value.indexOf(needle);
    }
    // Provider previews can end inside a known banner. Do not display that partial banner.
    const tail = source.value.trimStart();
    if (truncated && tail.length >= 30 && needle.startsWith(tail)) text = '';
  }
  return text.trim();
}

export function filterMailHtml(html: string, rules: MailContentRule[]): { html: string; changed: boolean } {
  if (!rules.some(rule => rule.enabled && rule.text.trim())) return { html, changed: false };
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let changed = false;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const needle = normalized(rule.text).value.trim();
    if (!needle) continue;
    for (;;) {
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      const positions: { node: Text; offset: number }[] = [];
      let text = '', node: Node | null;
      let previous: Text | null = null;
      while ((node = walker.nextNode())) {
        if (node.parentElement?.closest('script, style')) continue;
        const current = node as Text;
        if (previous && (previous.parentElement?.closest('p, div, td, li') !== current.parentElement?.closest('p, div, td, li') || previous.nextSibling?.nodeName === 'BR')) {
          text += ' '; positions.push({ node: previous, offset: previous.length });
        }
        for (let i = 0; i < current.length; i++) { text += current.data[i]; positions.push({ node: current, offset: i }); }
        previous = current;
      }
      const source = normalized(text), index = source.value.indexOf(needle);
      if (index < 0) break;
      const start = source.starts[index], end = source.ends[index + needle.length - 1];
      const range = doc.createRange();
      const first = positions[start], last = positions[end - 1];
      range.setStart(first.node, first.offset);
      range.setEnd(last.node, Math.min(last.offset + 1, last.node.length));
      const ancestors = new Set<Element>();
      for (const position of [first, last]) {
        let parent = position.node.parentElement;
        while (parent && parent !== doc.body) { ancestors.add(parent); parent = parent.parentElement; }
      }
      range.deleteContents(); changed = true;
      // Remove only emptied ancestors of the match, preserving other layout and media.
      for (const element of ancestors) {
        if (!element.textContent?.trim() && !element.querySelector('img, video, audio, svg, hr')) element.remove();
      }
    }
  }
  return { html: changed ? doc.body.innerHTML : html, changed };
}
