import type { Editor } from "@tiptap/react";
import {
  BoldIcon,
  HashIcon,
  ImagePlusIcon,
  ListIcon,
  ListOrderedIcon,
  ListTodoIcon,
  Maximize2Icon,
  MicIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { loadComposerFocusCanvas } from "@/components/composer/composer-focus-canvas-lazy";
import { ComposerScheduleMenu } from "@/components/composer/composer-schedule-menu";
import {
  type ActiveFormats,
  FORMAT_SHORTCUTS,
  toggleFormat,
} from "@/components/composer/format-actions";
import { ToolButton, ToolDivider } from "@/components/composer/tool-button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import type { MemoSchedule } from "@/lib/memo-schedule";

/** True while tools are cut off past the rail's trailing edge. RTL reports
 * scrollLeft from 0 down to negative, so measure the distance. */
function hasMoreToEnd(rail: HTMLElement) {
  return Math.abs(rail.scrollLeft) + rail.clientWidth < rail.scrollWidth - 1;
}

/**
 * The short-note rail. A note is plain prose with a little structure, so the
 * rail stops at bold and lists: headings, quotes and code blocks are article
 * tools, one click away behind "write long-form". Groups: insert (tag,
 * image), shape (bold, bullets, numbers, to-dos), and plan (schedule, voice),
 * then the way into the article canvas. It is the left half of the bottom
 * bar, next to the visibility menu and send. Every editor action goes
 * through `withEditor`, which no-ops while a submission is pending.
 */
export function ComposerToolbar({
  activeFormats,
  isPending,
  voiceActive,
  captureAvailable,
  withEditor,
  onAddFiles,
  onStartVoice,
  onExpand,
  schedule,
  onScheduleChange,
}: {
  /** Formats active at the selection, mirrored on every transaction. */
  activeFormats: ActiveFormats;
  isPending: boolean;
  voiceActive: boolean;
  captureAvailable: boolean;
  withEditor: (action: (editor: Editor) => void) => void;
  /**
   * Files picked through the attachment button. The caller appends them to
   * its latest draft (not a render-time copy), so an inline upload landing in
   * between is never overwritten.
   */
  onAddFiles: (files: File[]) => void;
  /** Starts a session; the caller owns the controller. */
  onStartVoice: () => void;
  /** Opens the full-screen focus canvas for the same note. */
  onExpand?: () => void;
  /** The draft's reminder day / project; see `MemoSchedule`. */
  schedule?: MemoSchedule;
  onScheduleChange: (schedule: MemoSchedule | undefined) => void;
}) {
  const { t } = useI18n();
  // Fade the trailing edge only while tools are actually cut off, so a wide
  // composer never dims its last button.
  const railRef = useRef<HTMLDivElement | null>(null);
  const [hasMoreToRight, setHasMoreToRight] = useState(false);
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() =>
      setHasMoreToRight(hasMoreToEnd(rail)),
    );
    observer.observe(rail);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      className="flex min-w-0 items-center gap-0.5 overflow-x-auto py-0.5 [scrollbar-width:none] data-[overflow=true]:[mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)] rtl:data-[overflow=true]:[mask-image:linear-gradient(to_left,black_calc(100%-20px),transparent)] [&::-webkit-scrollbar]:hidden"
      data-overflow={hasMoreToRight ? "true" : undefined}
      onScroll={(event) => setHasMoreToRight(hasMoreToEnd(event.currentTarget))}
      ref={railRef}
    >
      <ToolButton
        disabled={isPending}
        label={t("composer.addTag")}
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
      </ToolButton>
      <ToolButton
        disabled={isPending}
        label={t("composer.addAttachment")}
        render={
          <label
            aria-label={t("composer.addAttachment")}
            htmlFor="flaremo-attachment-input"
          />
        }
      >
        <ImagePlusIcon />
        <Input
          className="hidden"
          disabled={isPending}
          id="flaremo-attachment-input"
          multiple
          type="file"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length === 0) return;
            onAddFiles(files);
          }}
        />
      </ToolButton>
      <ToolDivider className="hidden sm:block" />
      <ToolButton
        active={activeFormats.bold}
        disabled={isPending}
        label={t("article.toolBold")}
        shortcut={FORMAT_SHORTCUTS.bold}
        // Keep the editor's selection (and its bubble menu) while clicking.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => withEditor((editor) => toggleFormat(editor, "bold"))}
      >
        <BoldIcon />
      </ToolButton>
      <ToolButton
        disabled={isPending}
        label={t("composer.bulletList")}
        onClick={() =>
          withEditor((editor) => {
            editor.chain().focus().toggleBulletList().run();
          })
        }
      >
        <ListIcon />
      </ToolButton>
      <ToolButton
        disabled={isPending}
        label={t("composer.orderedList")}
        onClick={() =>
          withEditor((editor) => {
            editor.chain().focus().toggleOrderedList().run();
          })
        }
      >
        <ListOrderedIcon />
      </ToolButton>
      <ToolButton
        disabled={isPending}
        label={t("composer.taskList")}
        onClick={() =>
          withEditor((editor) => {
            editor.chain().focus().toggleTaskList().run();
          })
        }
      >
        <ListTodoIcon />
      </ToolButton>
      <ToolDivider className="hidden sm:block" />
      <ComposerScheduleMenu
        disabled={isPending}
        schedule={schedule}
        onScheduleChange={onScheduleChange}
      />
      {captureAvailable && (
        <ToolButton
          active={voiceActive}
          disabled={isPending}
          label={t("composer.voice")}
          onClick={() => {
            if (voiceActive) return;
            onStartVoice();
          }}
        >
          <MicIcon />
        </ToolButton>
      )}
      {onExpand && (
        <>
          <ToolDivider className="hidden sm:block" />
          <ToolButton
            disabled={isPending}
            label={t("composer.longform")}
            onClick={onExpand}
            onMouseEnter={() => {
              void loadComposerFocusCanvas();
            }}
          >
            <Maximize2Icon />
          </ToolButton>
        </>
      )}
    </div>
  );
}
