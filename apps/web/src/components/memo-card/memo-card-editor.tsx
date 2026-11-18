import type { Editor } from "@tiptap/react";
import {
  BoldIcon,
  HashIcon,
  ImageIcon,
  ListIcon,
  ListTodoIcon,
  PaperclipIcon,
  XIcon,
} from "lucide-react";
import {
  type RefObject,
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { Attachment } from "@/api";
import {
  extractNonImageFiles,
  hasFileTransfer,
  isImageContentType,
} from "@/components/composer/attachment-upload-helpers";
import {
  type ActiveFormats,
  FORMAT_SHORTCUTS,
  IS_APPLE,
  NO_ACTIVE_FORMATS,
  readActiveFormats,
  sameActiveFormats,
  toggleFormat,
} from "@/components/composer/format-actions";
import { ToolButton, ToolDivider } from "@/components/composer/tool-button";
import {
  type UploadingAttachmentEntry,
  useCardEditorAttachments,
} from "@/components/memo-card/use-card-editor-attachments";
import { RichComposerEditor } from "@/components/rich-composer-editor-lazy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/i18n";
import { formatBytes } from "@/lib/utils";

export type CardEditorSaveSubmission = {
  content: string;
  attachmentNames: string[];
  nextAttachments: Attachment[];
  attachmentsChanged: boolean;
};

type MemoCardEditorProps = {
  content: string;
  initialContent: string;
  attachments: Attachment[];
  isSaving: boolean;
  /** The live editor handle; the card owns it so focus helpers can reach it. */
  editorRef: RefObject<Editor | null>;
  onCancel: () => void;
  onContentChange: (content: string) => void;
  onSave: (submission: CardEditorSaveSubmission) => Promise<void> | void;
};

const SUBMIT_KEY_LABEL = IS_APPLE ? "⌘↵" : "Ctrl ↵";
const DISCARD_CONFIRM_MS = 3500;

function AttachmentChipThumbnail({ attachment }: { attachment: Attachment }) {
  const [failed, setFailed] = useState(false);
  const src = attachment.thumbnail_url ?? attachment.preview_url;
  if (!isImageContentType(attachment.content_type) || !src || failed) {
    return isImageContentType(attachment.content_type) ? (
      <ImageIcon aria-hidden="true" className="size-3.5 shrink-0" />
    ) : (
      <PaperclipIcon aria-hidden="true" className="size-3.5 shrink-0" />
    );
  }
  return (
    <img
      alt=""
      aria-hidden="true"
      className="size-5 shrink-0 rounded-[4px] border border-border/50 bg-muted object-cover"
      onError={() => setFailed(true)}
      src={src}
    />
  );
}

function CardEditorAttachmentTray({
  existingAttachments,
  uploadedAttachments,
  uploadingEntries,
  disabled,
  onRemoveExisting,
  onRemoveUploaded,
  onCancelUploading,
}: {
  existingAttachments: Attachment[];
  uploadedAttachments: Attachment[];
  uploadingEntries: UploadingAttachmentEntry[];
  disabled: boolean;
  onRemoveExisting: (name: string) => void;
  onRemoveUploaded: (name: string) => void;
  onCancelUploading: (key: string) => void;
}) {
  const { t } = useI18n();
  if (
    existingAttachments.length === 0 &&
    uploadedAttachments.length === 0 &&
    uploadingEntries.length === 0
  ) {
    return null;
  }

  return (
    <div
      className="flex flex-wrap gap-1.5 pt-0.5"
      data-testid="card-editor-attachments"
    >
      {existingAttachments.map((attachment) => (
        <div
          className="flex max-w-full items-center gap-1.5 rounded-lg border border-border/60 bg-muted/45 py-1 ps-2 pe-1 text-xs text-muted-foreground"
          key={attachment.name}
        >
          <AttachmentChipThumbnail attachment={attachment} />
          <span className="max-w-44 truncate text-foreground/85">
            {attachment.filename}
          </span>
          {attachment.size > 0 && (
            <span className="shrink-0 tabular-nums text-muted-foreground/80">
              {formatBytes(attachment.size)}
            </span>
          )}
          <Button
            aria-label={t("composer.removeFile", {
              filename: attachment.filename,
            })}
            disabled={disabled}
            size="icon-xs"
            type="button"
            variant="ghost"
            onClick={() => onRemoveExisting(attachment.name)}
          >
            <XIcon />
          </Button>
        </div>
      ))}
      {uploadedAttachments.map((attachment) => (
        <div
          className="flex max-w-full items-center gap-1.5 rounded-lg border border-border/70 bg-muted/65 py-1 ps-2 pe-1 text-xs text-muted-foreground motion-safe:animate-scale-in"
          key={attachment.name}
        >
          <AttachmentChipThumbnail attachment={attachment} />
          <span className="max-w-44 truncate text-foreground/90">
            {attachment.filename}
          </span>
          {attachment.size > 0 && (
            <span className="shrink-0 tabular-nums text-muted-foreground/80">
              {formatBytes(attachment.size)}
            </span>
          )}
          <Button
            aria-label={t("composer.removeFile", {
              filename: attachment.filename,
            })}
            disabled={disabled}
            size="icon-xs"
            type="button"
            variant="ghost"
            onClick={() => onRemoveUploaded(attachment.name)}
          >
            <XIcon />
          </Button>
        </div>
      ))}
      {uploadingEntries.map((entry) => (
        <div
          className="flex max-w-full items-center gap-1.5 rounded-lg border border-dashed border-primary/40 bg-primary/[0.04] py-1 ps-2.5 pe-1 text-xs text-muted-foreground"
          data-uploading="true"
          key={entry.key}
        >
          <Spinner className="size-3.5 shrink-0 text-primary" />
          <span className="sr-only">{t("common.loading")}</span>
          <span className="max-w-44 truncate text-foreground/85">
            {entry.file.name}
          </span>
          {entry.file.size > 0 && (
            <span className="shrink-0 tabular-nums text-muted-foreground/80">
              {formatBytes(entry.file.size)}
            </span>
          )}
          <Button
            aria-label={t("composer.removeFile", { filename: entry.file.name })}
            disabled={disabled}
            size="icon-xs"
            type="button"
            variant="ghost"
            onClick={() => onCancelUploading(entry.key)}
          >
            <XIcon />
          </Button>
        </div>
      ))}
    </div>
  );
}

/**
 * The card's in-place edit face: rich text body, formatting & attachment rail,
 * paste/drop uploads, existing + new attachment preview/removal, and a two-step
 * Escape guard when unsaved edits exist.
 */
export function MemoCardEditor({
  content,
  initialContent,
  attachments,
  isSaving,
  editorRef,
  onCancel,
  onContentChange,
  onSave,
}: MemoCardEditorProps) {
  const { t } = useI18n();
  const attachmentInputId = `flaremo-card-attachment-${useId()}`;
  const dragDepthRef = useRef(0);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [activeFormats, setActiveFormats] =
    useState<ActiveFormats>(NO_ACTIVE_FORMATS);

  // Guard against fresh objects on unchanged selection updates (LESSONS.md:
  // unconditional setState inside TipTap's onTransaction causes a render loop).
  const syncActiveFormats = (editor: Editor) => {
    const next = readActiveFormats(editor);
    setActiveFormats((current) =>
      sameActiveFormats(current, next) ? current : next,
    );
  };

  const {
    visibleExistingAttachments,
    uploadedAttachments,
    uploadingEntries,
    isUploading,
    hasAnyAttachments,
    hasAttachmentEdits,
    enqueueFiles,
    enqueueInlineImages,
    removeExistingAttachment,
    removeUploadedAttachment,
    cancelUploadingEntry,
    resolveAttachmentSubmission,
  } = useCardEditorAttachments({
    initialAttachments: attachments,
    initialContent,
    draftContent: content,
    editorRef,
  });

  const isDirty = content !== initialContent || hasAttachmentEdits;
  const canSave = Boolean(content.trim() || hasAnyAttachments);

  // Auto-reset the Escape discard prompt after a short window.
  useEffect(() => {
    if (!confirmDiscard) return;
    const timer = window.setTimeout(
      () => setConfirmDiscard(false),
      DISCARD_CONFIRM_MS,
    );
    return () => window.clearTimeout(timer);
  }, [confirmDiscard]);

  const handleContentChange = (nextContent: string) => {
    if (confirmDiscard) setConfirmDiscard(false);
    onContentChange(nextContent);
  };

  const requestEscapeCancel = () => {
    if (isSaving) return;
    if (!isDirty || confirmDiscard) {
      onCancel();
      return;
    }
    setConfirmDiscard(true);
  };

  const submitSave = () => {
    if (isSaving || isUploading || !canSave) return;
    const nextContent = content.trim()
      ? content
      : t("toast.untitledAttachment");
    const {
      names: attachmentNames,
      attachments: nextAttachments,
      changed: attachmentsChanged,
    } = resolveAttachmentSubmission(nextContent);
    if (nextContent === initialContent && !attachmentsChanged) {
      onCancel();
      return;
    }
    void onSave({
      content: nextContent,
      attachmentNames,
      nextAttachments,
      attachmentsChanged,
    });
  };

  const withEditor = (action: (editor: Editor) => void) => {
    if (isSaving) return;
    const editor = editorRef.current;
    if (!editor) return;
    if (confirmDiscard) setConfirmDiscard(false);
    action(editor);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Esc/paste/drop delegation around the editor and its toolbar controls
    <div
      className="flex flex-col gap-2.5 rounded-lg motion-safe:animate-fade data-[dragging=true]:bg-primary/[0.03] data-[dragging=true]:ring-2 data-[dragging=true]:ring-primary/25"
      data-dragging={isDraggingFiles ? "true" : undefined}
      onKeyDown={(event) => {
        if (event.defaultPrevented || event.nativeEvent.isComposing) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          requestEscapeCancel();
        }
      }}
      onPaste={(event) => {
        if (isSaving) return;
        const allFiles = Array.from(event.clipboardData?.files ?? []);
        if (allFiles.length === 0) return;
        // RichComposerEditor already claimed pasted images inside the textbox.
        // Non-image files (or files pasted while focus sits on a toolbar button)
        // upload into the attachment tray.
        const filesToAttach = event.defaultPrevented
          ? extractNonImageFiles(allFiles)
          : allFiles;
        if (filesToAttach.length === 0) return;
        event.preventDefault();
        if (confirmDiscard) setConfirmDiscard(false);
        enqueueFiles(filesToAttach);
      }}
      onDragEnter={(event) => {
        if (!hasFileTransfer(event.dataTransfer)) return;
        dragDepthRef.current += 1;
        setIsDraggingFiles(true);
      }}
      onDragOver={(event) => {
        if (!hasFileTransfer(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (!hasFileTransfer(event.dataTransfer)) return;
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setIsDraggingFiles(false);
      }}
      onDrop={(event) => {
        dragDepthRef.current = 0;
        setIsDraggingFiles(false);
        if (isSaving) return;
        const allFiles = Array.from(event.dataTransfer?.files ?? []);
        if (allFiles.length === 0) return;
        const filesToAttach = event.defaultPrevented
          ? extractNonImageFiles(allFiles)
          : allFiles;
        event.preventDefault();
        if (filesToAttach.length === 0) return;
        if (confirmDiscard) setConfirmDiscard(false);
        enqueueFiles(filesToAttach);
      }}
    >
      <Suspense fallback={<div className="min-h-7" aria-hidden="true" />}>
        <RichComposerEditor
          ariaLabel={t("common.edit")}
          autoFocus
          content={content}
          disabled={isSaving}
          editorRef={editorRef}
          formatMenu="note"
          onContentChange={handleContentChange}
          onEscape={requestEscapeCancel}
          onImageFiles={(files, position) => {
            if (confirmDiscard) setConfirmDiscard(false);
            enqueueInlineImages(files, position);
          }}
          onTransaction={syncActiveFormats}
          inputId="flaremo-card-editor-input"
          contentClassName="composer-editor-content memo-card-editor-content max-h-none! overflow-visible!"
          onSubmitRequest={submitSave}
          placeholder={t("composer.placeholder")}
        />
      </Suspense>

      <CardEditorAttachmentTray
        disabled={isSaving}
        existingAttachments={visibleExistingAttachments}
        uploadedAttachments={uploadedAttachments}
        uploadingEntries={uploadingEntries}
        onCancelUploading={(key) => {
          if (confirmDiscard) setConfirmDiscard(false);
          cancelUploadingEntry(key);
        }}
        onRemoveExisting={(name) => {
          if (confirmDiscard) setConfirmDiscard(false);
          removeExistingAttachment(name);
        }}
        onRemoveUploaded={(name) => {
          if (confirmDiscard) setConfirmDiscard(false);
          removeUploadedAttachment(name);
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2">
        <div className="flex min-w-0 items-center gap-0.5">
          <ToolButton
            disabled={isSaving}
            label={t("composer.addTag")}
            onMouseDown={(event) => event.preventDefault()}
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
            disabled={isSaving}
            label={t("composer.addAttachment")}
            render={
              <label
                aria-label={t("composer.addAttachment")}
                htmlFor={attachmentInputId}
              />
            }
          >
            <PaperclipIcon />
            <Input
              className="hidden"
              data-testid="card-editor-file-input"
              disabled={isSaving}
              id={attachmentInputId}
              multiple
              type="file"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                if (files.length === 0) return;
                if (confirmDiscard) setConfirmDiscard(false);
                enqueueFiles(files);
              }}
            />
          </ToolButton>
          <ToolDivider className="hidden sm:block" />
          <ToolButton
            active={activeFormats.bold}
            disabled={isSaving}
            label={t("article.toolBold")}
            shortcut={FORMAT_SHORTCUTS.bold}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => withEditor((editor) => toggleFormat(editor, "bold"))}
          >
            <BoldIcon />
          </ToolButton>
          <ToolButton
            active={activeFormats.bulletList}
            disabled={isSaving}
            label={t("composer.bulletList")}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() =>
              withEditor((editor) => toggleFormat(editor, "bulletList"))
            }
          >
            <ListIcon />
          </ToolButton>
          <ToolButton
            active={activeFormats.taskList}
            disabled={isSaving}
            label={t("composer.taskList")}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() =>
              withEditor((editor) => toggleFormat(editor, "taskList"))
            }
          >
            <ListTodoIcon />
          </ToolButton>
        </div>

        <div className="ms-auto flex items-center gap-2">
          {confirmDiscard ? (
            <span
              className="inline-flex items-center gap-1.5 text-xs text-warning-emphasis motion-safe:animate-fade"
              data-testid="card-editor-unsaved-guard"
              role="status"
            >
              <span>{t("article.unsaved")}</span>
              <Kbd aria-hidden="true">Esc</Kbd>
            </span>
          ) : (
            <span
              aria-hidden="true"
              className="hidden items-center gap-1 text-xs text-muted-foreground lg:inline-flex"
            >
              <Kbd>{SUBMIT_KEY_LABEL}</Kbd>
              <Kbd>Esc</Kbd>
            </span>
          )}
          <Button
            disabled={isSaving}
            size="sm"
            type="button"
            variant={confirmDiscard ? "destructive" : "ghost"}
            onClick={onCancel}
          >
            {t("common.cancel")}
          </Button>
          <Button
            disabled={isSaving || isUploading || !canSave}
            size="sm"
            type="button"
            onClick={submitSave}
          >
            {isSaving && <Spinner data-icon="inline-start" />}
            {t("common.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
