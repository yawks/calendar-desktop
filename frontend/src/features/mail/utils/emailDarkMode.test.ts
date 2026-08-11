import { describe, expect, it } from 'vitest';
import { disableSenderDarkModeCss } from './emailDarkMode';

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
