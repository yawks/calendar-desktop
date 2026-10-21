import type { MailContentRule } from '../../../shared/store/MailContentRulesStore';

const APOSTROPHES = /[’‘]/g;
const INVISIBLE = /[\u200B-\u200D\uFEFF\u00AD]/;
const WHITESPACE = /\s/;

// Keep original offsets so matching across inline HTML never removes neighbouring content.
function normalized(text: string) {
  const characters: string[] = [];
  const starts: number[] = [], ends: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i].replace(APOSTROPHES, "'").toLowerCase();
    if (INVISIBLE.test(char)) continue;
    if (WHITESPACE.test(char)) {
      if (characters[characters.length - 1] === ' ') { ends[ends.length - 1] = i + 1; continue; }
      characters.push(' ');
    } else characters.push(char);
    for (let j = 0; j < char.length; j++) { starts.push(i); ends.push(i + 1); }
  }
  return { value: characters.join(''), starts, ends };
}

function ruleParts(text: string): string[] {
  const pattern = normalized(text).value.trim();
  return pattern.replace(/\*/g, '').trim() ? pattern.split(/\*+/).filter(Boolean) : [];
}

// Each wildcard takes the shortest span between literal fragments; no user-supplied regex.
function matchRule(value: string, parts: string[]) {
  if (!parts.length) return null;
  const start = value.indexOf(parts[0]);
  if (start < 0) return null;
  let end = start + parts[0].length;
  for (const part of parts.slice(1)) {
    const index = value.indexOf(part, end);
    if (index < 0) return null;
    end = index + part.length;
  }
  return { start, end };
}

function isTruncatedMatch(value: string, parts: string[]): boolean {
  if (!parts.length || value.length < 30) return false;
  if (parts[0].startsWith(value)) return true;
  if (!value.startsWith(parts[0])) return false;
  let end = parts[0].length;
  for (const part of parts.slice(1)) {
    const index = value.indexOf(part, end);
    if (index < 0) return true;
    end = index + part.length;
  }
  return false;
}

export function filterMailText(text: string, rules: MailContentRule[], truncated = false): string {
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const parts = ruleParts(rule.text);
    if (!parts.length) continue;
    let source = normalized(text);
    let match = matchRule(source.value, parts);
    while (match) {
      text = text.slice(0, source.starts[match.start]) + text.slice(source.ends[match.end - 1]);
      source = normalized(text); match = matchRule(source.value, parts);
    }
    // Provider previews can end inside a known banner. Do not display that partial banner.
    const tail = source.value.trimStart();
    if (truncated && isTruncatedMatch(tail, parts)) text = '';
  }
  return text.trim();
}

export function filterMailHtml(html: string, rules: MailContentRule[]): { html: string; changed: boolean } {
  if (!rules.some(rule => rule.enabled && rule.text.trim())) return { html, changed: false };
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let changed = false;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const parts = ruleParts(rule.text);
    if (!parts.length) continue;
    for (;;) {
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      // Track spans per text node instead of allocating an object per character.
      const positions: { node: Text; start: number; end: number; offset: number }[] = [];
      const chunks: string[] = [];
      let length = 0, node: Node | null;
      let previous: Text | null = null;
      while ((node = walker.nextNode())) {
        if (node.parentElement?.closest('script, style')) continue;
        const current = node as Text;
        if (previous && (previous.parentElement?.closest('p, div, td, li') !== current.parentElement?.closest('p, div, td, li') || previous.nextSibling?.nodeName === 'BR')) {
          chunks.push(' ');
          positions.push({ node: previous, start: length, end: ++length, offset: previous.length });
        }
        chunks.push(current.data);
        positions.push({ node: current, start: length, end: length + current.length, offset: 0 });
        length += current.length;
        previous = current;
      }
      const source = normalized(chunks.join('')), match = matchRule(source.value, parts);
      if (!match) break;
      const start = source.starts[match.start], end = source.ends[match.end - 1];
      const range = doc.createRange();
      const first = positions.find(position => start >= position.start && start < position.end)!;
      const last = positions.find(position => end - 1 >= position.start && end - 1 < position.end)!;
      range.setStart(first.node, first.offset + start - first.start);
      range.setEnd(last.node, Math.min(last.offset + end - last.start, last.node.length));
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
  const headStyles = Array.from(doc.head.querySelectorAll('style'), style => style.outerHTML).join('');
  return { html: changed ? headStyles + doc.body.innerHTML : html, changed };
}
