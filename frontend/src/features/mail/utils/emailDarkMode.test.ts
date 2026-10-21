// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { disableSenderDarkModeCss, protectEmailEmojis } from './emailDarkMode';

describe('protectEmailEmojis', () => {
  it('isolates complete emoji sequences without changing text or links', () => {
    const root = document.createElement('div');
    const emojis = ['😀', '👍🏽', '👩‍💻', '👨‍👩‍👧‍👦', '🇫🇷', '1️⃣', '❤️'];
    root.innerHTML = `<a href="https://example.com">Bonjour ${emojis.join(' ')} 123</a>`;
    const originalText = root.textContent;
    protectEmailEmojis(root);
    expect(Array.from(root.querySelectorAll('.ew-emoji'), el => el.textContent)).toEqual(emojis);
    expect(root.textContent).toBe(originalText);
    expect(root.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
    protectEmailEmojis(root);
    expect(root.querySelectorAll('.ew-emoji')).toHaveLength(emojis.length);
  });

  it('leaves styles, SVG media and ordinary text intact', () => {
    const root = document.createElement('div');
    root.innerHTML = '<style>.x::after { content: "😀" }</style><svg><text>😀</text></svg><p>Bonjour 123</p>';
    const original = root.innerHTML;
    protectEmailEmojis(root);
    expect(root.innerHTML).toBe(original);
  });
});

describe('disableSenderDarkModeCss', () => {
  it('disables dark mode blocks embedded in a style sheet', () => {
    const html = '<style>@media (prefers-color-scheme: dark) { body { background: #000 } }</style>';

    const result = disableSenderDarkModeCss(html);

    expect(result).toContain('@media (min-width: 0px) and (max-width: -1px)');
    expect(result).not.toContain('prefers-color-scheme: dark');
  });

  it('disables dark mode in style media attributes with flexible casing and spacing', () => {
    const html = '<style media="( PREFERS-COLOR-SCHEME : DARK )">body { color: #fff }</style>';

    expect(disableSenderDarkModeCss(html)).toBe(
      '<style media="(min-width: 0px) and (max-width: -1px)">body { color: #fff }</style>',
    );
  });

  it('preserves light mode and responsive media queries', () => {
    const html = '<style>@media (prefers-color-scheme: light) {} @media (min-width: 600px) {}</style>';

    expect(disableSenderDarkModeCss(html)).toBe(html);
  });
});
