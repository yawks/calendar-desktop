// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { filterMailHtml, filterMailText } from './mailContentFilter';
import { applyPortableConfig, pickPortableConfig } from '../../../shared/security/portableConfig';
const text = "ATTENTION: email externe. Ne cliquez pas sur les liens et n'ouvrez les pièces jointes qu'en cas d'identification certaine de l’expéditeur et du contenu.";
const rules = [{ id: 'banner', text, enabled: true }];
const banner = `<div style="border:solid #9C6500 1.0pt;padding:2.0pt"><p class="MsoNormal" style="background:#FFEB9C"><span>ATTENTION:</span><span> email externe. Ne cliquez pas sur les liens et n'ouvrez les pièces jointes qu'en cas d'identification certaine de l’expéditeur et du contenu. </span><o:p></o:p></p></div>`;
describe('global mail content rules', () => {
  it('removes the Office banner and its border while preserving the message', () => {
    const result = filterMailHtml(`${banner}<p>Bonjour, voici le document.</p>`, rules);
    expect(result.changed).toBe(true);
    expect(result.html).not.toContain('ATTENTION'); expect(result.html).not.toContain('border:');
    expect(result.html).toContain('Bonjour, voici le document.');
  });
  it('preserves surrounding text, links, media and unrelated empty layout', () => {
    const result = filterMailHtml(`<div><p>Avant ${text}<a href="https://example.com">Après</a></p><img src="cid:photo"><table><tr><td></td></tr></table></div>`, rules);
    for (const content of ['Avant', 'Après', 'href=', '<img', '<td>']) expect(result.html).toContain(content);
  });
  it('matches across blocks without consuming the following message', () => {
    expect(filterMailHtml('<p>Attention: email</p><p>externe.</p><p>Bonjour</p>', [{ id: '1', text: 'Attention: email externe.', enabled: true }]).html).toBe('<p>Bonjour</p>');
  });
  it('normalizes case, whitespace and apostrophes, applies multiple rules and ignores disabled rules', () => {
    expect(filterMailText(`${text.toUpperCase().replaceAll("'", '’')}\nBonjour SIGNATURE`, [...rules, { id: '2', text: 'signature', enabled: true }])).toBe('Bonjour');
    expect(filterMailHtml(banner, [{ ...rules[0], enabled: false }])).toEqual({ html: banner, changed: false });
    expect(filterMailText(text, [{ id: 'empty', text: ' ', enabled: true }])).toBe(text);
  });
  it('recognizes a truncated banner only in provider previews', () => {
    const partial = text.slice(0, 80);
    expect(filterMailText(partial, rules, true)).toBe(''); expect(filterMailText(partial, rules)).toBe(partial);
    expect(filterMailText('ATTENTION: Bonjour', rules, true)).toBe('ATTENTION: Bonjour');
  });
  it('preserves offsets when Unicode lowercase expands a character', () => {
    const rule = [{ id: '1', text: 'BANNER', enabled: true }];
    expect(filterMailText('İstanbul BANNER Bonjour', rule)).toBe('İstanbul  Bonjour');
    expect(filterMailHtml('<p>İstanbul BANNER Bonjour</p>', rule).html).toBe('<p>İstanbul  Bonjour</p>');
  });
  it('includes rules in portable config and replaces them on download', () => {
    const payload = { 'courrier:mail-content-rules': rules, private: 'local' };
    expect(pickPortableConfig(payload)).toEqual({ 'courrier:mail-content-rules': rules });
    expect(applyPortableConfig(payload, { 'courrier:mail-content-rules': [] })).toEqual({ 'courrier:mail-content-rules': [], private: 'local' });
  });
});

describe('wildcard mail content rules', () => {
  const rule = [{ id: 'sender-warning', text: "You don't often get email from *. Learn why this is important", enabled: true }];
  it('hides different sender addresses and preserves the actual message', () => {
    for (const address of ['d.deschutter@novadial.fr', 'other+sender@example.org']) {
      expect(filterMailText(`You don’t often get email from ${address}. Learn why this is important Bonjour`, rule)).toBe('Bonjour');
    }
  });
  it('removes the emptied table and link, preserving the next paragraph and image', () => {
    const html = `<table style="border:1px solid orange"><tr><td><span>You don't often get email from </span><b>d.deschutter@novadial.fr.</b>&nbsp;<a href="https://example.com">Learn why this is important</a></td></tr></table><p>Bonjour</p><img src="cid:document">`;
    const result = filterMailHtml(html, rule);
    expect(result.changed).toBe(true);
    expect(result.html).toBe('<p>Bonjour</p><img src="cid:document">');
  });
  it('uses the shortest match, supports multiple wildcards and repeated banners', () => {
    const rules = [{ id: '1', text: 'Start * middle * end', enabled: true }];
    expect(filterMailText('Start a middle b end KEEP Start c middle d end LAST', rules)).toBe('KEEP  LAST');
    expect(filterMailText('Start middle end KEEP', [{ id: '1', text: 'Start*middle*end', enabled: true }])).toBe('KEEP');
  });
  it('keeps punctuation literal and ignores empty wildcard rules', () => {
    const literal = [{ id: '1', text: 'Notice [external] (sender: *)?', enabled: true }];
    expect(filterMailText('Notice [external] (sender: test@example.com)? Bonjour', literal)).toBe('Bonjour');
    const empty = [{ id: 'empty', text: ' ** * ** ', enabled: true }];
    expect(filterMailText('Bonjour', empty)).toBe('Bonjour');
    expect(filterMailHtml('<p>Bonjour</p>', empty)).toEqual({ html: '<p>Bonjour</p>', changed: false });
  });
  it('requires all fixed fragments in full messages and honors disabled rules', () => {
    const text = "You don't often get email from sender@example.com. Bonjour";
    expect(filterMailText(text, rule)).toBe(text);
    expect(filterMailHtml(`<p>${text}</p>`, rule).changed).toBe(false);
    expect(filterMailText('Start x end', [{ id: '1', text: 'Start * end', enabled: false }])).toBe('Start x end');
  });
  it('recognizes previews truncated inside the address or final fixed fragment', () => {
    const text = "You don't often get email from sender@example.com. Learn why this is important";
    for (const length of [35, 45, 65]) {
      expect(filterMailText(text.slice(0, length), rule, true)).toBe('');
      expect(filterMailText(text.slice(0, length), rule)).toBe(text.slice(0, length));
    }
    expect(filterMailText('A normal message with more than thirty characters', rule, true)).toBe('A normal message with more than thirty characters');
  });
});
