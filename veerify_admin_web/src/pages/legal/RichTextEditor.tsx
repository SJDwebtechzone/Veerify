import { useEffect, useRef, useCallback } from 'react';
import {
  Bold, Italic, Underline, List, ListOrdered, Heading2, Link2,
  Undo2, Redo2, Type,
} from 'lucide-react';

// Dependency-free rich text editor.
//
// Uses contentEditable + document.execCommand. execCommand is deprecated
// but every modern browser still implements it, and for a lightweight
// admin-side editor with basic formatting (headings, bold, italic,
// underline, lists, links) it's still the simplest working option
// without adding a 100 KB dependency.
//
// The editor is UNCONTROLLED — it initialises innerHTML from `value`
// exactly once, then fires `onChange` on every input event with the
// current HTML. Re-rendering the parent with the same value doesn't
// reset the caret, which is what we want during typing.

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}

export function RichTextEditor({
  value, onChange, placeholder = 'Start typing…', minHeight = 160,
}: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastValueRef = useRef<string>('');

  // Seed innerHTML on mount + when the value changes from the OUTSIDE
  // (e.g. loading a saved page). We compare against lastValueRef so a
  // typing-triggered onChange doesn't cause a re-mount / caret reset.
  useEffect(() => {
    if (!editorRef.current) return;
    if (value !== lastValueRef.current) {
      editorRef.current.innerHTML = value || '';
      lastValueRef.current = value || '';
    }
  }, [value]);

  const handleInput = useCallback(() => {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    lastValueRef.current = html;
    onChange(html);
  }, [onChange]);

  const exec = (command: string, arg?: string) => {
    // Keep the caret inside the editor when the toolbar is clicked.
    editorRef.current?.focus();
    document.execCommand(command, false, arg);
    handleInput();
  };

  const insertLink = () => {
    const url = window.prompt('Enter URL (include https://):');
    if (!url) return;
    // Guard against script:javascript: — allow only http/https/mailto.
    if (!/^(https?:\/\/|mailto:)/i.test(url)) {
      window.alert('URL must start with http:// or https:// or mailto:');
      return;
    }
    exec('createLink', url);
  };

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 border-b border-gray-100 bg-gray-50 px-2 py-1.5">
        <ToolbarButton onClick={() => exec('formatBlock', 'h2')} title="Heading">
          <Heading2 size={14} />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec('formatBlock', 'p')} title="Paragraph">
          <Type size={14} />
        </ToolbarButton>
        <Separator />
        <ToolbarButton onClick={() => exec('bold')} title="Bold">
          <Bold size={14} />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec('italic')} title="Italic">
          <Italic size={14} />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec('underline')} title="Underline">
          <Underline size={14} />
        </ToolbarButton>
        <Separator />
        <ToolbarButton onClick={() => exec('insertUnorderedList')} title="Bullet list">
          <List size={14} />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec('insertOrderedList')} title="Numbered list">
          <ListOrdered size={14} />
        </ToolbarButton>
        <Separator />
        <ToolbarButton onClick={insertLink} title="Insert link">
          <Link2 size={14} />
        </ToolbarButton>
        <Separator />
        <ToolbarButton onClick={() => exec('undo')} title="Undo">
          <Undo2 size={14} />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec('redo')} title="Redo">
          <Redo2 size={14} />
        </ToolbarButton>
      </div>

      {/* Editor surface */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onBlur={handleInput}
        onPaste={(e) => {
          // Strip formatting on paste so users don't drag in ugly Word
          // styles. Plain-text paste keeps the editor's own formatting
          // toolbar as the single source of look-and-feel.
          e.preventDefault();
          const text = e.clipboardData.getData('text/plain');
          document.execCommand('insertText', false, text);
        }}
        data-placeholder={placeholder}
        className="prose-legal p-4 text-sm text-gray-900 outline-none"
        style={{
          minHeight,
          lineHeight: 1.6,
        }}
      />

      {/* Placeholder + prose styles inline so we don't have to touch tailwind config */}
      <style>{`
        .prose-legal:empty::before {
          content: attr(data-placeholder);
          color: #9CA3AF;
          pointer-events: none;
          display: block;
        }
        .prose-legal h2 { font-size: 1.05rem; font-weight: 800; margin: 0.6rem 0 0.3rem; }
        .prose-legal p  { margin: 0.35rem 0; }
        .prose-legal ul { list-style: disc; margin-left: 1.25rem; }
        .prose-legal ol { list-style: decimal; margin-left: 1.25rem; }
        .prose-legal a  { color: #2563EB; text-decoration: underline; }
        .prose-legal strong { font-weight: 700; }
      `}</style>
    </div>
  );
}

function ToolbarButton({
  onClick, title, children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        // MouseDown fires before contentEditable's blur, so the caret
        // stays put and execCommand affects the right selection.
        e.preventDefault();
        onClick();
      }}
      title={title}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-600 hover:bg-gray-200 hover:text-gray-900"
    >
      {children}
    </button>
  );
}

function Separator() {
  return <div className="mx-1 h-4 w-px bg-gray-200" />;
}
