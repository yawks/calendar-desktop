const DISABLED_DARK_MEDIA_QUERY = '(min-width: 0px) and (max-width: -1px)';

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
