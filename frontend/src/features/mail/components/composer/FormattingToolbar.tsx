import { Bold, Highlighter, Italic, List, ListOrdered, Type, Underline } from 'lucide-react';
import { RefObject } from 'react';

export function FormattingToolbar({ bodyRef }: { readonly bodyRef: RefObject<HTMLDivElement> }) {
  const exec = (cmd: string, val?: string) => {
    document.execCommand(cmd, false, val);
    bodyRef.current?.focus();
  };

  return (
    <div className="mail-composer__formatting">
      <button type="button" onMouseDown={e => { e.preventDefault(); exec('bold'); }} title="Gras"><Bold size={14} /></button>
      <button type="button" onMouseDown={e => { e.preventDefault(); exec('italic'); }} title="Italique"><Italic size={14} /></button>
      <button type="button" onMouseDown={e => { e.preventDefault(); exec('underline'); }} title="Souligné"><Underline size={14} /></button>
      <div className="divider-v" />
      <button type="button" onMouseDown={e => { e.preventDefault(); exec('insertUnorderedList'); }} title="Liste à puces"><List size={14} /></button>
      <button type="button" onMouseDown={e => { e.preventDefault(); exec('insertOrderedList'); }} title="Liste numérotée"><ListOrdered size={14} /></button>
      <div className="divider-v" />
      <button type="button" onMouseDown={e => { e.preventDefault(); exec('formatBlock', '<h3>'); }} title="Titre"><Type size={14} /></button>
      <button type="button" onMouseDown={e => { e.preventDefault(); exec('backColor', 'yellow'); }} title="Surligner"><Highlighter size={14} /></button>
    </div>
  );
}
