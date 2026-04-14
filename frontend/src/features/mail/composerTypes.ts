import { ComposerAttachment } from './providers/MailProvider';
import { MailMessage } from './types';
import { RecipientEntry } from './components/RecipientInput';

export interface ComposerRestoreData {
  readonly isNewMessage: boolean;
  readonly recipients: RecipientEntry[];
  readonly cc: RecipientEntry[];
  readonly bcc: RecipientEntry[];
  readonly subject: string;
  readonly bodyHtml: string;
  readonly replyingToMsg: MailMessage | null;
}

export async function readFilesAsBase64(files: FileList): Promise<ComposerAttachment[]> {
  const promises = Array.from(files).map(async (file) => {
    return new Promise<ComposerAttachment>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve({
          name: file.name,
          contentType: file.type,
          data: base64,
          size: file.size,
        });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  });
  return Promise.all(promises);
}
