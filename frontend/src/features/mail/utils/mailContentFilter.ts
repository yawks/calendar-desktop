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
      const source = normalized(text), match = matchRule(source.value, parts);
      if (!match) break;
      const start = source.starts[match.start], end = source.ends[match.end - 1];
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
