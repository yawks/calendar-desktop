/** Android descriptions are plain text; source HTML colors must not override the native theme. */
export function androidCalendarDescription(description: string | undefined): string | undefined {
  if (!description) return description;
  const decoder = document.createElement('textarea');
  let text = description;
  for (let pass = 0; pass < 3; pass++) {
    decoder.innerHTML = text;
    const decoded = decoder.value;
    if (decoded === text) break;
    text = decoded;
  }
  const hasHtml = /<!--|<\/?[a-z][\w:-]*(?:\s|\/?>)/i.test(text);
  if (hasHtml) {
    const template = document.createElement('template');
    // Angle-bracket URLs and email addresses in plain invitation text are not HTML tags.
    template.innerHTML = text.replace(/<(https?:\/\/[^<>\s]+|[^<>\s@]+@[^<>\s@]+)>/gi, '$1');
    const content = template.content;
    content.querySelectorAll('head, style, script, title, meta, link, template, noscript, iframe, object, svg').forEach(node => node.remove());
    content.querySelectorAll('a[href]').forEach(node => {
      const href = node.getAttribute('href')?.trim() ?? '';
      const label = node.textContent?.trim() ?? '';
      const address = href.replace(/^(?:mailto:|tel:)/i, '');
      if (/^(?:https?:\/\/|mailto:|tel:)/i.test(href) && !label.includes(address)) {
        node.textContent = label ? `${label} (${address})` : address;
      }
    });
    content.querySelectorAll('br, hr').forEach(node => node.replaceWith('\n'));
    content.querySelectorAll('li').forEach(node => node.prepend('• '));
    content.querySelectorAll('td, th').forEach(node => node.append(' '));
    content.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6, pre, blockquote').forEach(node => {
      node.prepend('\n');
      node.append('\n');
    });
    text = (content.textContent ?? '').replace(/[ \t]+/g, ' ');
  }
  return text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
