import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import type { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { common, createLowlight } from "lowlight";
import { useMemo } from "react";
import { RichComposerEditor } from "@/components/rich-composer-editor";
import { UploadPlaceholder } from "@/components/upload-placeholder-extension";
import { extractImageFiles } from "@/lib/image-insert";

/**
 * Article body extensions: the composer's GFM base plus the long-form
 * surfaces an article needs — deeper heading levels, highlighted code blocks
 * (official CodeBlockLowlight; starter-kit's plain CodeBlock is disabled to
 * avoid the duplicate-extension warning), and tables.
 */
export function buildArticleExtensions(placeholder: string) {
  const lowlight = createLowlight(common);
  return [
    StarterKit.configure({
      underline: false,
      heading: { levels: [1, 2, 3, 4] },
      link: { openOnClick: false },
      // The official highlighted code block replaces the starter-kit one.
      codeBlock: false,
    }),
    CodeBlockLowlight.configure({ lowlight }),
    TableKit.configure({ table: { resizable: false } }),
    TaskList,
    TaskItem.configure({ nested: false }),
    Image.configure({ inline: true }),
    Placeholder.configure({ placeholder }),
    Markdown,
    UploadPlaceholder,
  ];
}

export { extractImageFiles };

export type ArticleEditorProps = {
  content: string;
  placeholder: string;
  disabled: boolean;
  onContentChange: (markdown: string) => void;
  onImageFiles: (files: File[], position: number) => void;
  editorRef: React.RefObject<Editor | null>;
  /** Fires on every editor transaction (selection moves included). */
  onTransaction?: (editor: Editor) => void;
};

/**
 * Long-form TipTap body of the article editor. Storage stays plain markdown
 * via the official Markdown extension, exactly like the memo composer; the
 * differences are the extension set above, the taller unclipped body, and a
 * no-op Cmd/Ctrl+Enter (articles are saved by the page, not sent).
 */
export function ArticleEditor({
  content,
  placeholder,
  disabled,
  onContentChange,
  onImageFiles,
  editorRef,
  onTransaction,
}: ArticleEditorProps) {
  // Stable across renders: a fresh extension array makes TipTap re-sync its
  // options, which fires a transaction, which (with an onTransaction that
  // sets state) renders again.
  const extensions = useMemo(
    () => buildArticleExtensions(placeholder),
    [placeholder],
  );
  return (
    <RichComposerEditor
      ariaLabel={placeholder}
      content={content}
      contentClassName="article-editor-content"
      disabled={disabled}
      editorRef={editorRef}
      inputId="flaremo-article-editor"
      extensions={extensions}
      onContentChange={onContentChange}
      onImageFiles={onImageFiles}
      onTransaction={onTransaction}
      onSubmitRequest={() => undefined}
      placeholder={placeholder}
    />
  );
}
