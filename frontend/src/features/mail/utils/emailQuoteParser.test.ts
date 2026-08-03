import { describe, it, expect } from 'vitest';
import { processEmailQuotes, findQuoteMarker, formatEmailQuotesForEditor } from './emailQuoteParser';

const OPTS = { label: 'Previous message' };

function parse(html: string, quoteMarker?: string | null): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = html;
  processEmailQuotes(div, { ...OPTS, quoteMarker });
  return div;
}

function qtCount(el: HTMLElement): number {
  return el.querySelectorAll('.qt').length;
}

// ─── findQuoteMarker ──────────────────────────────────────────────────────────

describe('findQuoteMarker', () => {
  it('detects Outlook separator', () => {
    const text = 'Hello\n\n----- Original Message -----\nFrom: Alice\n\nQuote';
    expect(findQuoteMarker(text)).toBe('----- Original Message -----');
  });

  it('detects underline separator', () => {
    expect(findQuoteMarker('text\n________\nquote')).toBe('________');
  });

  it('detects "On … wrote:" pattern', () => {
    const text = 'Reply\n\nOn Mon, 1 Jan 2024 at 10:00, Alice <a@b.com> wrote:\n> Quote';
    expect(findQuoteMarker(text)).toBe('On Mon, 1 Jan 2024 at 10:00, Alice <a@b.com> wrote:');
  });

  it('detects first > line', () => {
    expect(findQuoteMarker('Reply\n> quoted line\n> more')).toBe('> quoted line');
  });

  it('returns null when no quote', () => {
    expect(findQuoteMarker('Just a plain message with no quotes.')).toBeNull();
  });
});

// ─── processEmailQuotes — blockquote wrapping ─────────────────────────────────

describe('processEmailQuotes — blockquote', () => {
  it('wraps a substantial blockquote', () => {
    const el = parse(`
      <p>Hello</p>
      <blockquote><p>This is a real quoted reply with enough text to be wrapped as previous message content</p></blockquote>
    `);
    expect(qtCount(el)).toBe(1);
  });

  it('does NOT wrap a tiny blockquote (header field)', () => {
    const el = parse(`
      <p>Hello</p>
      <blockquote>From: Alice &lt;alice@example.com&gt;</blockquote>
    `);
    expect(qtCount(el)).toBe(0);
  });

  it('wraps nested blockquotes recursively', () => {
    const el = parse(`
      <blockquote>
        <p>Level 1 reply with enough content to trigger wrapping here</p>
        <blockquote>
          <p>Level 2 original message that is also long enough to wrap indeed</p>
        </blockquote>
      </blockquote>
    `);
    expect(qtCount(el)).toBe(2);
    expect(el.querySelector('[data-quote-depth="2"]')).not.toBeNull();
  });

  it('keeps short nested replies as distinct coloured levels', () => {
    const el = parse(`
      <blockquote>
        <p>This outer quoted reply is long enough to be recognised as a previous message.</p>
        <blockquote>Short original reply</blockquote>
      </blockquote>
    `);
    expect(qtCount(el)).toBe(2);
    expect(el.querySelector('.qt[data-quote-depth="1"] .qt[data-quote-depth="2"]')).not.toBeNull();
  });

  it('always recognises nested cite blockquotes', () => {
    const el = parse('<blockquote type="cite">Short quote<blockquote type="cite">Older</blockquote></blockquote>');
    expect(qtCount(el)).toBe(2);
  });

  it.each(['gmail_quote', 'yahoo_quoted', 'protonmail_quote'])('wraps %s containers', className => {
    const el = parse(`<p>Reply</p><div class="${className}">A short quoted message</div>`);
    expect(qtCount(el)).toBe(1);
  });

  it('exposes an accessible three-dot toggle', () => {
    const el = parse('<div class="gmail_quote">Quoted message</div>');
    const button = el.querySelector<HTMLButtonElement>('.qt-toggle');
    expect(button?.textContent).toBe('•••');
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    button?.click();
    expect(button?.getAttribute('aria-expanded')).toBe('true');
  });
});

// ─── processEmailQuotes — text-based dividers ─────────────────────────────────

describe('processEmailQuotes — Outlook-style separators', () => {
  it('recognises an Outlook reply header container', () => {
    const el = parse('<p>Reply</p><div id="divRplyFwdMsg"><b>From:</b> Alice</div><p>Old message</p>');
    expect(qtCount(el)).toBe(1);
    expect(el.querySelector('.qt-inner')?.textContent).toContain('Old message');
  });

  it('recognises Outlook ids recursively prefixed with x_', () => {
    const el = parse(`
      <p>Current message</p>
      <div id="divRplyFwdMsg">First reply header</div>
      <p>First quoted message</p>
      <div id="x_mail-editor-reference-message-container">
        <p>Second reply header and message</p>
        <div id="x_x_mail-editor-reference-message-container">
          <p>Third reply header and message</p>
          <div id="x_x_divRplyFwdMsg">Fourth reply header</div>
          <p>Oldest message</p>
        </div>
      </div>
    `);
    expect(qtCount(el)).toBe(4);
    expect(el.querySelector('[data-quote-depth="4"]')?.textContent).toContain('Oldest message');
  });
  it('wraps everything after -----Original Message----- in ONE block', () => {
    const el = parse(`
      <p>New reply</p>
      <p>----- Original Message -----</p>
      <p>From: Alice</p>
      <p>To: Bob</p>
      <p>Date: Mon, 1 Jan</p>
      <p>Quoted text</p>
    `);
    expect(qtCount(el)).toBe(1);
    // Header fields stay inside, not as individual toggles
    expect(el.querySelector('.qt-inner')?.textContent).toContain('From: Alice');
  });

  it('handles double nested Outlook reply chain', () => {
    const el = parse(`
      <p>Reply 2</p>
      <p>----- Original Message -----</p>
      <p>Reply 1</p>
      <p>----- Original Message -----</p>
      <p>Original</p>
    `);
    // One outer toggle, one nested toggle inside it
    expect(qtCount(el)).toBe(2);
    const outerInner = el.querySelector('.qt > .qt-inner');
    expect(outerInner?.querySelectorAll('.qt').length).toBe(1);
  });

  it('handles triple nested reply chain', () => {
    const el = parse(`
      <p>Reply 3</p>
      <p>----- Original Message -----</p>
      <p>Reply 2</p>
      <p>----- Original Message -----</p>
      <p>Reply 1</p>
      <p>----- Original Message -----</p>
      <p>Original</p>
    `);
    expect(qtCount(el)).toBe(3);
  });

  it('removes a trailing separator with nothing after it', () => {
    const el = parse(`
      <p>Text</p>
      <p>----- Original Message -----</p>
    `);
    expect(qtCount(el)).toBe(0);
    // The separator itself should be gone
    expect(el.textContent?.trim()).toBe('Text');
  });

  it('does NOT create a toggle for short separator inside a blockquote (header fields)', () => {
    // Blockquotes shorter than 80 chars with no block children are skipped
    const el = parse(`
      <p>Text</p>
      <p>----- Original Message -----</p>
      <blockquote>From: Alice</blockquote>
      <blockquote>To: Bob</blockquote>
      <p>Content</p>
    `);
    // One toggle for the whole quoted section, the two blockquotes stay inside
    expect(qtCount(el)).toBe(1);
    const inner = el.querySelector('.qt-inner');
    expect(inner?.querySelectorAll('.qt').length).toBe(0);
  });
});

// ─── processEmailQuotes — quoteMarker from body_text ─────────────────────────

describe('processEmailQuotes — quoteMarker', () => {
  it('uses quoteMarker to split when no blockquote or divider exists', () => {
    const el = parse(
      `<p>Reply</p><p>On Mon wrote:</p><p>Original text</p>`,
      'On Mon wrote:',
    );
    expect(qtCount(el)).toBe(1);
  });
});

describe('formatEmailQuotesForEditor', () => {
  it('converts nested quotes to editable mail-quoted levels', () => {
    const html = formatEmailQuotesForEditor(`
      <p>Reply</p>
      <div id="divRplyFwdMsg">Previous header</div>
      <p>Previous body</p>
      <div id="x_mail-editor-reference-message-container"><p>Older body</p></div>
    `);
    const root = document.createElement('div');
    root.innerHTML = html;
    expect(root.querySelector('.mail-quoted--level-2 .mail-quoted--level-3')).not.toBeNull();
    expect(root.querySelectorAll('.qt')).toHaveLength(0);
    expect(root.querySelector('.mail-quoted__body')?.textContent).toContain('Previous body');
  });
});
