// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { formatMailPreview, mailPreviewNeedsBody } from '../utils';
const rules = [
  { id: '1', enabled: true, text: "You don't often get email from *. Learn why this is important" },
  { id: '2', enabled: true, text: 'ATTENTION: email externe.' },
];
it('refills a provider preview reduced to a greeting by multiple banner rules', () => {
  const preview = "You don't often get email from someone@example.com. Learn why this is important ATTENTION: email externe. Bonjour Belkacem";
  expect(formatMailPreview(preview, rules)).toBe('Bonjour Belkacem');
  expect(mailPreviewNeedsBody(preview, rules)).toBe(true);
});
it('collapses gaps left by filtering without modifying the full message', () => {
  expect(formatMailPreview('Bonjour Belkacem\n\n ATTENTION: email externe.\n\n Voici la suite du message.', rules)).toBe('Bonjour Belkacem Voici la suite du message.');
});
it('avoids body requests for ordinary short messages and already useful filtered previews', () => {
  expect(mailPreviewNeedsBody('Bonjour Belkacem', rules)).toBe(false);
  expect(mailPreviewNeedsBody('', rules)).toBe(false);
  expect(mailPreviewNeedsBody('ATTENTION: email externe. ' + 'Contenu utile. '.repeat(30), rules)).toBe(false);
  expect(mailPreviewNeedsBody('ATTENTION: email externe. Bonjour', rules.map(rule => ({ ...rule, enabled: false })))).toBe(false);
});

it.each([
  'Hello,\r\nC’est OK de mon coté\r\nCdt',
  '<p>Hello,</p><p>C’est OK de mon coté</p><p>Cdt</p>',
  '<div>Hello,</div><div>C’est OK de mon coté</div><div>Cdt</div>',
  'Hello,<br class="line">C’est OK de mon coté<br style="clear:both" />Cdt',
])('preserves word boundaries at plain-text and HTML line breaks: %s', text => {
  expect(formatMailPreview(text)).toBe('Hello, C’est OK de mon coté Cdt');
});
it('keeps adjacent inline spans within the same word', () => {
  expect(formatMailPreview('<span>Bon</span><span>jour</span>')).toBe('Bonjour');
});

it('excludes embedded email styles when building an HTML preview', () => {
  expect(formatMailPreview('<style>p { color: red; }</style><p>Hello,</p><p>Cdt</p>')).toBe('Hello, Cdt');
});

it('extracts Outlook message text without its commented font definitions', () => {
  const html = '<html><head><style type="text/css"><!-- /* Font Definitions */ @font-face {font-family:"Cambria Math"; panose-1:2 4;} p.MsoNormal {margin:0;} --></style><!--[if gte mso 9]><xml>Office settings</xml><![endif]--></head><body><p>Hello,</p><p>C’est OK de mon coté</p><p>Cdt</p></body></html>';
  expect(formatMailPreview(html)).toBe('Hello, C’est OK de mon coté Cdt');
});
it('discards old previews containing truncated Outlook styles so they are rebuilt', () => {
  const cached = '<!-- /* Font Definitions */ @font-face {font-family:"Cambria Math"; panose-1:2 4';
  expect(formatMailPreview(cached)).toBe('');
  expect(mailPreviewNeedsBody(cached, [])).toBe(true);
});
