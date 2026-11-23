import type { Editor } from "@tiptap/react";
import {
  BoldIcon,
  CalendarPlusIcon,
  CheckSquareIcon,
  CodeIcon,
  HashIcon,
  Heading2Icon,
  Heading3Icon,
  ImageIcon,
  ItalicIcon,
  ListIcon,
  ListOrderedIcon,
  MicIcon,
  MinusIcon,
  QuoteIcon,
  StrikethroughIcon,
  TableIcon,
} from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import { todayKey } from "@/lib/calendar-date";

/** Format flags mirrored from the editor's selection on every transaction. */
export type CanvasActiveFormats = {
  h2: boolean;
  h3: boolean;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  quote: boolean;
  bulletList: boolean;
  orderedList: boolean;
  taskList: boolean;
};

/**
 * Professional writing toolbar of the focus canvas' bottom bar: headings,
 * inline marks, blocks, lists, then tag/attachment/date/voice. Every editor
 * action goes through `withEditor`, which no-ops while a submission is
 * pending. The rail scrolls horizontally on narrow screens.
 */
export function ComposerCanvasToolbar({
  activeFormats,
  isPending,
  voiceActive,
  captureAvailable,
  withEditor,
  onAddFiles,
  onStartVoice,
}: {
  activeFormats: CanvasActiveFormats;
  isPending: boolean;
  voiceActive: boolean;
  captureAvailable: boolean;
  withEditor: (action: (editor: Editor) => void) => void;
  /** Appends picked files to the draft. */
  onAddFiles: (files: File[]) => void;
  /** Starts a voice capture session; the caller owns the controller. */
  onStartVoice: () => void;
}) {
  const { t } = useI18n();
  const attachmentInputId = `flaremo-canvas-attachment-${useId()}`;
  return (
    <div className="flex min-w-0 items-center gap-0.5 sm:gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden py-0.5 [mask-image:linear-gradient(to_right,black_calc(100%-16px),transparent)] sm:[mask-image:none]">
      {/* Headings */}
      <Button
        aria-label={t("article.toolH2")}
        title={t("article.toolH2")}
        aria-pressed={activeFormats.h2}
        disabled={isPending}
        size="icon-sm"
        type="button"
        variant={activeFormats.h2 ? "secondary" : "ghost"}
        onClick={() =>
          withEditor((editor) => {
            editor.chain().focus().toggleHeading({ level: 2 }).run();
          })
        }
      >
        <Heading2Icon />
      </Button>
      <Button
        aria-label={t("article.toolH3")}
        title={t("article.toolH3")}
        aria-pressed={activeFormats.h3}
        disabled={isPending}
        size="icon-sm"
        type="button"
        variant={activeFormats.h3 ? "secondary" : "ghost"}
        onClick={() =>
          withEditor((editor) => {
            editor.chain().focus().toggleHeading({ level: 3 }).run();
          })
        }
      >
        <Heading3Icon />
      </Button>

      <div className="h-4 w-px bg-border/60 mx-0.5" />

      {/* Inline formatting */}
      <Button
        aria-label={t("article.toolBold")}
        title={t("article.toolBold")}
        aria-pressed={activeFormats.bold}
        disabled={isPending}
        size="icon-sm"
        type="button"
        variant={activeFormats.bold ? "secondary" : "ghost"}
        onClick={() =>
          withEditor((editor) => {
            editor.chain().focus().toggleBold().run();
          })
        }
      >
        <BoldIcon />
      </Button>
      <Button
        aria-label={t("article.toolItalic")}
        title={t("article.toolItalic")}
        aria-pressed={activeFormats.italic}
        disabled={isPending}
        size="icon-sm"
        type="button"
        variant={activeFormats.italic ? "secondary" : "ghost"}
        onClick={() =>
          withEditor((editor) => {
            editor.chain().focus().toggleItalic().run();
          })
        }
      >
        <ItalicIcon />
      </Button>
      <Button
        aria-label={t("article.toolStrike")}
        title={t("article.toolStrike")}
        aria-pressed={activeFormats.strike}
        disabled={isPending}
        size="icon-sm"
        type="button"
        variant={activeFormats.strike ? "secondary" : "ghost"}
        onClick={() =>
          withEditor((editor) => {
            editor.chain().focus().toggleStrike().run();
          })
        }
      >
        <StrikethroughIcon />
      </Button>
      <Button
        aria-label={t("article.toolCode")}
        title={t("article.toolCode")}
        aria-pressed={activeFormats.code}
        disabled={isPending}
        size="icon-sm"
        type="button"
        variant={activeFormats.code ? "secondary" : "ghost"}
        onClick={() =>
          withEditor((editor) => {
            editor.chain().focus().toggleCode().run();
          })
        }
      >
        <CodeIcon />
      </Button>

      <div className="h-4 w-px bg-border/60 mx-0.5" />

      {/* Blocks: Quote, Rule, Table */}
      <Button
        aria-label={t("article.toolQuote")}
        title={t("article.toolQuote")}
        aria-pressed={activeFormats.quote}
        disabled={isPending}
        size="icon-sm"
        type="button"
        variant={activeFormats.quote ? "secondary" : "ghost"}
        onClick={() =>
          withEditor((editor) => {
            editor.chain().focus().toggleBlockquote().run();
          })
        }
      >
        <QuoteIcon />
      </Button>
      <Button
        aria-label={t("article.toolRule")}
        title={t("article.toolRule")}
        disabled={isPending}
        size="icon-sm"
        type="button"
        variant="ghost"
        onClick={() =>
          withEditor((editor) => {
            editor.chain().focus().setHorizontalRule().run();
          })
        }
      >
        <MinusIcon />
      </Button>
      <Button
        aria-label={t("article.toolTable")}
        title={t("article.toolTable")}
        disabled={isPending}
        size="icon-sm"
        type="button"
        variant="ghost"
        onClick={() =>
          withEditor((editor) => {
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run();
          })
        }
      >
        <TableIcon />
      </Button>

      <div className="h-4 w-px bg-border/60 mx-0.5" />

      {/* Lists */}
      <Button
        aria-label={t("article.toolBulletList")}
        title={t("article.toolBulletList")}
        aria-pressed={activeFormats.bulletList}
        disabled={isPending}
        size="icon-sm"
        type="button"
        variant={activeFormats.bulletList ? "secondary" : "ghost"}
        onClick={() =>
          withEditor((editor) => {
            editor.chain().focus().toggleBulletList().run();
          })
        }
      >
        <ListIcon />
      </Button>
      <Button
        aria-label={t("article.toolOrderedList")}
        title={t("article.toolOrderedList")}
        aria-pressed={activeFormats.orderedList}
        disabled={isPending}
        size="icon-sm"
        type="button"
        variant={activeFormats.orderedList ? "secondary" : "ghost"}
        onClick={() =>
          withEditor((editor) => {
            editor.chain().focus().toggleOrderedList().run();
          })
        }
      >
        <ListOrderedIcon />
      </Button>
      <Button
        aria-label={t("article.toolTaskList")}
        title={t("article.toolTaskList")}
        aria-pressed={activeFormats.taskList}
        disabled={isPending}
        size="icon-sm"
        type="button"
        variant={activeFormats.taskList ? "secondary" : "ghost"}
        onClick={() =>
          withEditor((editor) => {
            editor.chain().focus().toggleTaskList().run();
          })
        }
      >
        <CheckSquareIcon />
      </Button>

      <div className="h-4 w-px bg-border/60 mx-0.5" />

      {/* Tag, Attachments, Date & Voice */}
      <Button
        aria-label={t("composer.addTag")}
        title={t("composer.addTag")}
        disabled={isPending}
        size="icon-sm"
        type="button"
        variant="ghost"
        onClick={() =>
          withEditor((editor) => {
            editor
              .chain()
              .focus()
              .insertContentAt(editor.state.selection.to, "#")
              .run();
          })
        }
      >
        <HashIcon />
      </Button>
      <Button
        render={
          <label
            aria-label={t("composer.addAttachment")}
            title={t("composer.addAttachment")}
            htmlFor={attachmentInputId}
          />
        }
        disabled={isPending}
        size="icon-sm"
        variant="ghost"
      >
        <ImageIcon />
        <Input
          className="hidden"
          id={attachmentInputId}
          multiple
          type="file"
          disabled={isPending}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length === 0) return;
            onAddFiles(files);
          }}
        />
      </Button>
      <Button
        aria-label={t("composer.insertDate")}
        title={t("composer.insertDate")}
        disabled={isPending}
        size="icon-sm"
        type="button"
        variant="ghost"
        onClick={() =>
          withEditor((editor) => {
            const today = todayKey();
            editor.chain().focus().insertContent(`${today} `).run();
          })
        }
      >
        <CalendarPlusIcon />
      </Button>
      {captureAvailable && (
        <Button
          aria-label={t("composer.voice")}
          title={t("composer.voice")}
          className={voiceActive ? "text-brand-600" : undefined}
          disabled={isPending}
          size="icon-sm"
          type="button"
          variant="ghost"
          onClick={() => {
            if (voiceActive) return;
            onStartVoice();
          }}
        >
          <MicIcon />
        </Button>
      )}
    </div>
  );
}
