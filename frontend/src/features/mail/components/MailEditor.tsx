import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditor, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import FontFamily from '@tiptap/extension-font-family';
import TiptapImage from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { Extension, Node } from '@tiptap/core';
import {
  Bold as BoldIcon, Highlighter, ImagePlus, Italic as ItalicIcon,
  List, ListOrdered, Quote, Type, Underline as UnderlineIcon,
} from 'lucide-react';

// ── Custom extensions ──────────────────────────────────────────────────────────

// FontSize: adds a fontSize attribute to TextStyle spans
const FontSize = Extension.create({
  name: 'fontSize',
  addOptions() { return { types: ['textStyle'] }; },
  addGlobalAttributes() {
    return [{
      types: this.options.types,
      attributes: {
        fontSize: {
          default: null,
          parseHTML: (el: HTMLElement) => el.style.fontSize || null,
          renderHTML: (attrs: Record<string, string | null>) =>
            attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {},
        },
      },
    }];
  },
  addCommands() {
    return {
      setFontSize: (size: string) => ({ chain }: any) =>
        chain().setMark('textStyle', { fontSize: size }).run(),
      unsetFontSize: () => ({ chain }: any) =>
        chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    } as any;
  },
});

// QuotedBlock: atomic node that preserves the full mail-quoted HTML structure.
// The entire <div class="mail-quoted …"> subtree is stored as an attribute and
// re-emitted verbatim on serialisation — so the colored block CSS is intact.
// QuotedBlock: block node for email reply quotes.
// separator + headers are stored as attrs (rendered non-editable).
// The body content lives in Tiptap's schema as editable block+ nodes.
// ProseMirror's { dom, contentDOM } split handles this cleanly: everything
// inside dom but outside contentDOM is non-editable decoration.
const QuotedBlock = Node.create({
  name: 'quotedBlock',
  group: 'block',
  content: 'block+',  // editable body content

  addAttributes() {
    return {
      level:     { default: 1 },
      separator: { default: '' },
      headers:   { default: '' },
    };
  },

  parseHTML() {
    return [{
      tag: 'div.mail-quoted',
      getAttrs: (dom) => {
        const el = dom as HTMLElement;
        const level = parseInt(
          el.className.match(/mail-quoted--level-(\d+)/)?.[1] ?? '1',
        );
        const separator = el.querySelector('.mail-quoted__separator')?.innerHTML ?? '';
        const headers   = el.querySelector('.mail-quoted__headers')?.innerHTML ?? '';
        return { level, separator, headers };
      },
      // Only the body children are parsed as Tiptap content
      contentElement: (dom) => {
        const el = dom as HTMLElement;
        return (el.querySelector('.mail-quoted__body') as HTMLElement) ?? el;
      },
    }];
  },

  renderHTML({ node }) {
    const { level, separator, headers } = node.attrs as Record<string, string | number>;

    const dom = document.createElement('div');
    dom.className = `mail-quoted mail-quoted--level-${level}`;

    const sepEl = document.createElement('div');
    sepEl.className = 'mail-quoted__separator';
    sepEl.innerHTML = separator as string;
    dom.appendChild(sepEl);

    const hdrEl = document.createElement('div');
    hdrEl.className = 'mail-quoted__headers';
    hdrEl.innerHTML = headers as string;
    dom.appendChild(hdrEl);

    const bodyEl = document.createElement('div');
    bodyEl.className = 'mail-quoted__body';
    dom.appendChild(bodyEl);

    // contentDOM tells ProseMirror where to render/serialize the editable content
    return { dom, contentDOM: bodyEl };
  },
});

// ── Constants ──────────────────────────────────────────────────────────────────

const FONT_SIZES = ['10', '12', '14', '16', '18', '20', '24', '28', '36'];

// ── Toolbar ────────────────────────────────────────────────────────────────────

function Btn({
  active, title, onClick, children,
}: {
  active?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`mail-format-btn${active ? ' mail-format-btn--active' : ''}`}
      onMouseDown={e => { e.preventDefault(); onClick(); }}
      title={title}
    >
      {children}
    </button>
  );
}

function FormattingToolbar({ editor }: { editor: Editor | null }) {
  const { t } = useTranslation();
  if (!editor) return null;

  const fontFamilies = [
    { label: t('mail.font.default', 'Défaut'), value: '' },
    { label: 'Arial',   value: 'Arial, sans-serif' },
    { label: 'Georgia', value: 'Georgia, serif' },
    { label: 'Times',   value: 'Times New Roman, serif' },
    { label: 'Mono',    value: 'Courier New, monospace' },
  ];

  const handleImageFromClipboard = async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find(type => type.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const reader = new FileReader();
          reader.onload = () => {
            editor.chain().focus().setImage({ src: reader.result as string }).run();
          };
          reader.readAsDataURL(blob);
          return;
        }
      }
    } catch { /* clipboard permission denied */ }
  };

  return (
    <div className="mail-format-toolbar">
      {/* Inline styles */}
      <Btn active={editor.isActive('bold')}      title={t('mail.format.bold', 'Gras (⌘B)')}      onClick={() => editor.chain().focus().toggleBold().run()}>
        <BoldIcon size={13} />
      </Btn>
      <Btn active={editor.isActive('italic')}    title={t('mail.format.italic', 'Italique (⌘I)')} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <ItalicIcon size={13} />
      </Btn>
      <Btn active={editor.isActive('underline')} title={t('mail.format.underline', 'Souligné (⌘U)')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <UnderlineIcon size={13} />
      </Btn>

      <div className="mail-format-sep" />

      {/* Lists + blockquote */}
      <Btn active={editor.isActive('bulletList')}  title={t('mail.format.bulletList', 'Liste à puces')}   onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List size={13} />
      </Btn>
      <Btn active={editor.isActive('orderedList')} title={t('mail.format.orderedList', 'Liste numérotée')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered size={13} />
      </Btn>
      <Btn active={editor.isActive('blockquote')}  title={t('mail.format.blockquote', 'Citation')}        onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote size={13} />
      </Btn>

      <div className="mail-format-sep" />

      {/* Font family */}
      <select
        className="mail-format-select"
        defaultValue=""
        title={t('mail.format.fontFamily', 'Police')}
        onChange={e => {
          if (e.target.value) editor.chain().focus().setFontFamily(e.target.value).run();
          else editor.chain().focus().unsetFontFamily().run();
        }}
      >
        {fontFamilies.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
      </select>

      {/* Font size */}
      <select
        className="mail-format-select mail-format-select--size"
        defaultValue=""
        title={t('mail.format.fontSize', 'Taille')}
        onChange={e => {
          if (e.target.value) (editor.chain().focus() as any).setFontSize(`${e.target.value}px`).run();
          else (editor.chain().focus() as any).unsetFontSize().run();
        }}
      >
        <option value="">{t('mail.format.fontSize', 'Taille')}</option>
        {FONT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>

      <div className="mail-format-sep" />

      {/* Text colour */}
      <label className="mail-format-btn mail-format-color-label" title={t('mail.format.textColor', 'Couleur du texte')}>
        <Type size={12} />
        <span className="mail-format-color-swatch" style={{ background: '#000000' }} />
        <input
          type="color"
          className="mail-format-color-input"
          defaultValue="#000000"
          onChange={e => editor.chain().focus().setColor(e.target.value).run()}
        />
      </label>

      {/* Background highlight */}
      <label className="mail-format-btn mail-format-color-label" title={t('mail.format.bgColor', 'Couleur du fond')}>
        <Highlighter size={12} />
        <span className="mail-format-color-swatch" style={{ background: '#ffff00' }} />
        <input
          type="color"
          className="mail-format-color-input"
          defaultValue="#ffff00"
          onChange={e => editor.chain().focus().setHighlight({ color: e.target.value }).run()}
        />
      </label>

      <div className="mail-format-sep" />

      {/* Image from clipboard */}
      <Btn title={t('mail.format.pasteImage', 'Coller une image depuis le presse-papier')} onClick={handleImageFromClipboard}>
        <ImagePlus size={13} />
      </Btn>
    </div>
  );
}

// ── Public API ─────────────────────────────────────────────────────────────────

export interface MailEditorHandle {
  getHTML: () => string;
  focus: () => void;
  isModified: () => boolean;
}

export interface MailEditorProps {
  readonly initialHTML?: string;
  readonly placeholder?: string;
  readonly disableAutoFocus?: boolean;
  /** Called when the user presses Cmd/Ctrl+Enter */
  readonly onSend?: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────────

export const MailEditor = forwardRef<MailEditorHandle, MailEditorProps>(
  ({ initialHTML, placeholder, disableAutoFocus, onSend }, ref) => {
    const isDirtyRef = useRef(false);

    const editor = useEditor({
      extensions: [
        StarterKit,
        Underline,
        TextStyle,
        FontSize,
        Color,
        Highlight.configure({ multicolor: true }),
        FontFamily,
        TiptapImage.configure({ inline: true, allowBase64: true }),
        Placeholder.configure({ placeholder: placeholder ?? '' }),
        QuotedBlock,
      ],
      content: initialHTML ?? '',
      onUpdate: () => { isDirtyRef.current = true; },
      editorProps: {
        handleKeyDown: (_view, event) => {
          const mod = event.metaKey || event.ctrlKey;
          // Cmd/Ctrl+Enter → send
          if (mod && event.key === 'Enter') {
            event.preventDefault();
            onSend?.();
            return true;
          }
          // Shift+Cmd/Ctrl+V → paste as plain text
          if (mod && event.shiftKey && event.key === 'V') {
            event.preventDefault();
            navigator.clipboard.readText()
              .then(text => editor?.commands.insertContent(text))
              .catch(() => {});
            return true;
          }
          return false;
        },
        // Image paste via clipboard
        handlePaste: (_view, event) => {
          const items = Array.from(event.clipboardData?.items ?? []);
          const img = items.find(i => i.type.startsWith('image/'));
          if (!img) return false;
          event.preventDefault();
          const file = img.getAsFile();
          if (!file) return false;
          const reader = new FileReader();
          reader.onload = () => {
            editor?.chain().focus().setImage({ src: reader.result as string }).run();
          };
          reader.readAsDataURL(file);
          return true;
        },
      },
    });

    useImperativeHandle(ref, () => ({
      getHTML:    () => editor?.getHTML() ?? '',
      focus:      () => { editor?.commands.focus('start'); },
      isModified: () => isDirtyRef.current,
    }), [editor]);

    // Auto-focus the editor body on mount (skip when the caller wants focus elsewhere)
    useEffect(() => {
      if (editor && !disableAutoFocus) editor.commands.focus('start');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [!!editor]);

    return (
      <div className="mail-editor">
        <FormattingToolbar editor={editor} />
        <EditorContent editor={editor} className="mail-editor__content" />
      </div>
    );
  },
);

MailEditor.displayName = 'MailEditor';
