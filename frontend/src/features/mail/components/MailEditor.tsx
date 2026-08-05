import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditor, EditorContent, Editor, ReactNodeViewRenderer, NodeViewWrapper, NodeViewProps } from '@tiptap/react';
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

// ── Resizable image node view ──────────────────────────────────────────────────

function ResizableImageView({ node, updateAttributes, selected }: Readonly<NodeViewProps>) {
  const imgRef = useRef<HTMLImageElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startXRef.current = e.clientX;
    startWidthRef.current = imgRef.current?.offsetWidth ?? 200;

    const onMouseMove = (mv: MouseEvent) => {
      const newWidth = Math.max(50, startWidthRef.current + (mv.clientX - startXRef.current));
      updateAttributes({ width: newWidth });
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [updateAttributes]);

  return (
    <NodeViewWrapper as="span" style={{ display: 'inline-block', position: 'relative', lineHeight: 0 }}>
      <img
        ref={imgRef}
        src={node.attrs.src}
        alt={node.attrs.alt ?? ''}
        title={node.attrs.title ?? undefined}
        style={{
          display: 'block',
          width: node.attrs.width ? `${node.attrs.width}px` : undefined,
          maxWidth: '100%',
          height: 'auto',
        }}
      />
      {selected && (
        <button
          type="button"
          aria-label="Resize image"
          className="mail-editor__image-resize-handle"
          onMouseDown={handleMouseDown}
        />
      )}
    </NodeViewWrapper>
  );
}

const ResizableImage = TiptapImage.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: el => {
          const w = el.getAttribute('width') ?? el.style.width;
          return w ? Number.parseInt(w, 10) : null;
        },
        renderHTML: attrs =>
          attrs.width ? { width: String(attrs.width), style: `width:${attrs.width}px` } : {},
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});

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

  addNodeView() {
    return ({ node }) => {
      const { level, separator, headers } = node.attrs as Record<string, string | number>;
      const dom = document.createElement('div');
      dom.className = `mail-quoted mail-quoted--level-${level} mail-quoted--editor`;

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'mail-quoted__toggle';
      toggle.textContent = '•••';
      toggle.title = 'Afficher ou masquer le message précédent';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('contenteditable', 'false');

      const details = document.createElement('div');
      details.className = 'mail-quoted__editable-content';
      details.style.display = 'none';

      const sepEl = document.createElement('div');
      sepEl.className = 'mail-quoted__separator';
      sepEl.innerHTML = separator as string;
      sepEl.contentEditable = 'false';
      details.appendChild(sepEl);

      const hdrEl = document.createElement('div');
      hdrEl.className = 'mail-quoted__headers';
      hdrEl.innerHTML = headers as string;
      hdrEl.contentEditable = 'false';
      details.appendChild(hdrEl);

      const contentDOM = document.createElement('div');
      contentDOM.className = 'mail-quoted__body';
      details.appendChild(contentDOM);
      dom.append(toggle, details);

      toggle.addEventListener('mousedown', event => {
        event.preventDefault();
        event.stopPropagation();
      });
      toggle.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const open = details.style.display !== 'none';
        details.style.display = open ? 'none' : '';
        toggle.setAttribute('aria-expanded', String(!open));
      });

      return {
        dom,
        contentDOM,
        // ProseMirror must not turn a click on this UI control into a document
        // selection, nor undo the display/aria mutations made by the toggle.
        stopEvent: event => event.target instanceof window.Node && toggle.contains(event.target),
        ignoreMutation: mutation => (
          mutation.type === 'attributes' &&
          (mutation.target === details || mutation.target === toggle)
        ),
      };
    };
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
  /** Replace (or remove) the signature block in the editor without clearing content. */
  replaceSignatureBlock: (signatureHtml: string, position: 'bottom' | 'above-quoted') => void;
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
        ResizableImage.configure({ inline: true, allowBase64: true }),
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
      replaceSignatureBlock: (signatureHtml: string, position: 'bottom' | 'above-quoted') => {
        if (!editor) return;
        const current = editor.getHTML();
        // Strip existing signature block
        const withoutSig = current.replace(/<div[^>]*data-courrier-sig[^>]*>[\s\S]*?<\/div>/, '');
        const sigBlock = signatureHtml
          ? `<div data-courrier-sig="1">${signatureHtml}</div>`
          : '';
        let next: string;
        if (position === 'above-quoted') {
          const idx = withoutSig.indexOf('<div class="mail-quoted');
          next = idx !== -1
            ? withoutSig.slice(0, idx) + sigBlock + withoutSig.slice(idx)
            : withoutSig + sigBlock;
        } else {
          next = withoutSig + sigBlock;
        }
        editor.commands.setContent(next);
      },
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
