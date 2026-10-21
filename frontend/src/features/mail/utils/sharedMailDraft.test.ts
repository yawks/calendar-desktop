import { describe, expect, it } from 'vitest';
import { sharedMailDraft } from './sharedMailDraft';

describe('sharedMailDraft', () => {
  it('preserves files, subject and plain text without interpreting HTML', () => {
    const attachments = [
      { name: 'photo.jpg', contentType: 'image/jpeg', data: 'YQ==', size: 1 },
      { name: 'document.pdf', contentType: 'application/pdf', data: 'Yg==', size: 1 },
    ];
    const draft = sharedMailDraft({ subject: 'Documents', text: '<script> & texte\r\nsuite', attachments });
    expect(draft.subject).toBe('Documents');
    expect(draft.body).toBe('<p>&lt;script&gt; &amp; texte<br>suite</p>');
    expect(draft.attachments).toBe(attachments);
    expect(draft.toRecipients).toEqual([]);
    expect(draft.isNewMessage).toBe(true);
  });
  it('accepts a text-only link or files without text', () => {
    expect(sharedMailDraft({ subject: '', text: 'https://example.test', attachments: [] }).body).toBe('<p>https://example.test</p>');
    expect(sharedMailDraft({ subject: '', text: '', attachments: [] }).body).toBe('');
  });
});
