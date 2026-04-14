import { forwardRef } from 'react';
import { FormattingToolbar } from './FormattingToolbar';
import { ComposerAttachmentPanel } from './ComposerAttachmentPanel';

export const MailComposer = forwardRef<HTMLDivElement, any>(({  onBodyChange, onImagePaste, placeholder }, ref) => {
  return (
    <div className="mail-composer">
      <FormattingToolbar bodyRef={ref as any} />
      <ComposerAttachmentPanel attachments={[]} onRemove={() => {}} />
      <div
        ref={ref}
        className="mail-composer__body"
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        data-placeholder={placeholder}
        onInput={(e) => onBodyChange?.(e.currentTarget.innerHTML)}
        onPaste={onImagePaste}
      />
    </div>
  );
});
