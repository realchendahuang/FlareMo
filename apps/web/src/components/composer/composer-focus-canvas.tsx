import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { Editor } from "@tiptap/react";
import { Suspense, useMemo, useRef, useState } from "react";
import type { MemoVisibility } from "@/api";
import { buildArticleExtensions } from "@/components/article-editor";
import { ComposerCanvasActions } from "@/components/composer/composer-canvas-actions";
import { ComposerCanvasHeader } from "@/components/composer/composer-canvas-header";
import {
  type CanvasActiveFormats,
  ComposerCanvasToolbar,
} from "@/components/composer/composer-canvas-toolbar";
import { ComposerFileChips } from "@/components/composer/composer-file-chips";
import {
  ComposerTagSuggestions,
  ComposerWikiSuggestions,
} from "@/components/composer/composer-suggestion-lists";
import type { ComposerPublishType } from "@/components/composer/composer-type-menu";
import { VoiceCaptureBar } from "@/components/composer/voice-capture-bar";
import { RichComposerEditor } from "@/components/rich-composer-editor";
import { Dialog, DialogPortal } from "@/components/ui/dialog";
import { useComposerSuggestions } from "@/hooks/use-composer-suggestions";
import { useComposerVoice } from "@/hooks/use-composer-voice";
import { useInlineImageUploads } from "@/hooks/use-inline-image-uploads";
import { useI18n } from "@/i18n";
import type { MemoCaptureInput } from "@/lib/local-memo-capture";
import { extractTags } from "@/lib/memo";
import type { TagSuggestion } from "@/lib/tag-autocomplete";

export type ComposerFocusCanvasProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: MemoCaptureInput;
  isPending: boolean;
  showVisibility?: boolean;
  tags?: TagSuggestion[];
  captureAvailable?: boolean;
  onDraftChange: (draft: MemoCaptureInput) => void;
  onSubmitMemo: (input: MemoCaptureInput) => Promise<void>;
  onSubmitArticle: (input: MemoCaptureInput) => Promise<void>;
  onVisibilityChange?: (visibility: MemoVisibility) => void;
};

/**
 * Fullscreen Focus Canvas (专注画布 - 自适应信纸模式):
 * Smooth, 60fps hardware-accelerated full-viewport writing environment.
 * Features a dedicated title header and an extensive professional writing
 * toolbar (headings, code blocks, tables, lists, text formatting).
 * Automatically adapts publish target based on title presence or user choice.
 */
export function ComposerFocusCanvas({
  open,
  onOpenChange,
  draft,
  isPending,
  showVisibility = false,
  tags,
  captureAvailable = false,
  onDraftChange,
  onSubmitMemo,
  onSubmitArticle,
  onVisibilityChange,
}: ComposerFocusCanvasProps) {
  const { t } = useI18n();
  const canvasEditorRef = useRef<Editor | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const editorBoxRef = useRef<HTMLDivElement | null>(null);
  // The canvas is opened by "write long-form", so it starts as an article.
  // The type menu still sends the text as a note for an author who only
  // wanted the room.
  const [manualType, setManualType] = useState<ComposerPublishType | null>(
    "article",
  );
  const [activeFormats, setActiveFormats] = useState<CanvasActiveFormats>({
    h2: false,
    h3: false,
    bold: false,
    italic: false,
    strike: false,
    code: false,
    quote: false,
    bulletList: false,
    orderedList: false,
    taskList: false,
  });

  // Every transaction (selection moves included) reports the marks under the
  // caret. Bail out when nothing changed: a fresh object per transaction
  // re-renders the canvas, which re-runs the editor's option sync, which
  // fires another transaction, a render loop React aborts after 50 rounds.
  const handleTransaction = (editor: Editor) => {
    const next: CanvasActiveFormats = {
      h2: editor.isActive("heading", { level: 2 }),
      h3: editor.isActive("heading", { level: 3 }),
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      strike: editor.isActive("strike"),
      code: editor.isActive("code"),
      quote: editor.isActive("blockquote"),
      bulletList: editor.isActive("bulletList"),
      orderedList: editor.isActive("orderedList"),
      taskList: editor.isActive("taskList"),
    };
    setActiveFormats((prev) =>
      (Object.keys(next) as (keyof CanvasActiveFormats)[]).every(
        (key) => prev[key] === next[key],
      )
        ? prev
        : next,
    );
  };

  const placeholder = t("composer.placeholder");
  const extensions = useMemo(
    () => buildArticleExtensions(placeholder),
    [placeholder],
  );

  // Option A (自适应信纸法):
  // If title is entered, automatically treated as article unless user manually set type.
  const hasTitle = Boolean(draft.title?.trim());
  const publishType: ComposerPublishType =
    manualType ?? (hasTitle ? "article" : "memo");

  const canSubmit = Boolean(draft.content.trim() || draft.files.length > 0);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const commitDraft = (patch: Partial<MemoCaptureInput>) => {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    onDraftChange(next);
  };

  const { isUploadingImages, enqueueInlineUploads, preuploadMarkdownRef } =
    useInlineImageUploads({
      editorRef: canvasEditorRef,
      draftRef,
      commitDraft,
    });

  const updateContent = (content: string) => {
    const kept = draftRef.current.preuploadedAttachmentNames?.filter((name) => {
      const markdown = preuploadMarkdownRef.current.get(name);
      return !markdown || content.includes(markdown);
    });
    commitDraft({
      content,
      tags: extractTags(content),
      preuploadedAttachmentNames: kept,
    });
  };

  const updateContentRef = useRef(updateContent);
  updateContentRef.current = updateContent;

  const {
    setActiveTagToken,
    setActiveWikiToken,
    handleSuggestionKeyDown,
    activeIndex: suggestionIndex,
    setActiveIndex: setSuggestionIndex,
    anchor: suggestionAnchor,
    tagSuggestions,
    showTagSuggestions,
    acceptTagSuggestion,
    wikiSuggestions,
    showWikiSuggestions,
    acceptWikiSuggestion,
  } = useComposerSuggestions({
    editorRef: canvasEditorRef,
    containerRef: editorBoxRef,
    isPending,
    tags,
  });

  const { capture, captureController, voiceActive, now } = useComposerVoice({
    draftRef,
    updateContentRef,
  });

  const submit = async () => {
    if (isPending || isUploadingImages || voiceActive) return;

    if (publishType === "article") {
      await onSubmitArticle(draftRef.current);
    } else {
      if (!canSubmit) return;
      try {
        await onSubmitMemo(draftRef.current);
        onOpenChange(false);
      } catch {
        // Mutation handles error feedback
      }
    }
  };

  const withEditor = (action: (editor: Editor) => void) => {
    if (isPending) return;
    const editor = canvasEditorRef.current;
    if (!editor) return;
    action(editor);
  };

  const charCount = draft.content.trim().length;
  const readingTimeMinutes = Math.max(1, Math.ceil(charCount / 350));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogPrimitive.Backdrop
          data-slot="composer-canvas-backdrop"
          className="fixed inset-0 isolate z-50 bg-background/80 duration-200 ease-signal supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 data-closed:fill-mode-forwards"
        />
        <DialogPrimitive.Popup
          data-slot="composer-canvas-popup"
          className="fixed inset-0 isolate z-50 flex flex-col bg-background text-foreground outline-none will-change-transform will-change-opacity duration-200 ease-signal data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-closed:fill-mode-forwards"
        >
          <form
            className="flex h-full flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {/* Header: Title accessibility, Save status, Word count, Reading time & minimize */}
            <ComposerCanvasHeader
              charCount={charCount}
              publishType={publishType}
              readingTimeMinutes={readingTimeMinutes}
            />

            {/* Main Canvas Area */}
            {/* biome-ignore lint/a11y/noStaticElementInteractions: Focus editor when clicking blank paper area */}
            <div
              className="relative mx-auto flex w-full max-w-3xl flex-1 cursor-text flex-col min-h-0 overflow-y-auto px-4 sm:px-6 py-5"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  event.preventDefault();
                  canvasEditorRef.current?.commands.focus("end");
                }
              }}
            >
              {/* Adaptive Title Header */}
              <div className="mb-3 shrink-0">
                <input
                  ref={titleInputRef}
                  type="text"
                  value={draft.title ?? ""}
                  onChange={(event) => {
                    commitDraft({ title: event.target.value });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      if (event.metaKey || event.ctrlKey) {
                        void submit();
                      } else {
                        canvasEditorRef.current?.commands.focus("start");
                      }
                    } else if (event.key === "ArrowDown") {
                      const input = event.currentTarget;
                      if (input.selectionStart === input.value.length) {
                        canvasEditorRef.current?.commands.focus("start");
                      }
                    }
                  }}
                  placeholder={t("article.titlePlaceholder")}
                  disabled={isPending}
                  className="w-full border-b border-border/40 bg-transparent px-0 pb-3 text-xl font-bold tracking-tight text-foreground placeholder:text-muted-foreground/30 focus-visible:outline-none sm:text-2xl"
                />
              </div>

              {/* TipTap Fullscreen Editor */}
              {/* biome-ignore lint/a11y/noStaticElementInteractions: Focus editor when clicking blank paper area */}
              <div
                className="relative flex flex-1 cursor-text flex-col min-h-0"
                ref={editorBoxRef}
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) {
                    event.preventDefault();
                    canvasEditorRef.current?.commands.focus("end");
                  }
                }}
              >
                <Suspense
                  fallback={<div className="flex-1 rounded-lg bg-muted/20" />}
                >
                  <RichComposerEditor
                    ariaLabel={
                      publishType === "article"
                        ? t("composer.type.article")
                        : t("composer.ariaLabel")
                    }
                    content={draft.content}
                    disabled={isPending}
                    editorRef={canvasEditorRef}
                    extensions={extensions}
                    inputId="flaremo-fullscreen-composer-input"
                    onContentChange={updateContent}
                    onImageFiles={enqueueInlineUploads}
                    onTagTokenChange={tags ? setActiveTagToken : undefined}
                    onWikiLinkTokenChange={setActiveWikiToken}
                    onSuggestionKeyDown={handleSuggestionKeyDown}
                    onSubmitRequest={() => {
                      if (!isUploadingImages && !voiceActive) void submit();
                    }}
                    onTransaction={handleTransaction}
                    onBackspaceAtStart={() => {
                      if (!draft.content.trim() && titleInputRef.current) {
                        titleInputRef.current.focus();
                        const len = titleInputRef.current.value.length;
                        titleInputRef.current.setSelectionRange(len, len);
                        return true;
                      }
                      return false;
                    }}
                    placeholder={t("composer.placeholder")}
                    autoFocus={true}
                    contentClassName="article-editor-content flex-1 outline-none text-base leading-relaxed py-2"
                  />
                </Suspense>
                {voiceActive && (
                  <VoiceCaptureBar
                    capture={capture}
                    now={now}
                    onCancel={() => captureController.reset()}
                    onStop={() => void captureController.stop()}
                  />
                )}
                <ComposerTagSuggestions
                  visible={showTagSuggestions}
                  suggestions={tagSuggestions}
                  activeIndex={suggestionIndex}
                  anchor={suggestionAnchor}
                  onAccept={acceptTagSuggestion}
                  onHighlight={setSuggestionIndex}
                />
                <ComposerWikiSuggestions
                  visible={showWikiSuggestions}
                  suggestions={wikiSuggestions}
                  activeIndex={suggestionIndex}
                  anchor={suggestionAnchor}
                  onAccept={acceptWikiSuggestion}
                  onHighlight={setSuggestionIndex}
                />
                {/* Pending attachments sit at the foot of the paper, a tray
                    above the toolbar, aligned with the text column. */}
                <ComposerFileChips
                  className="mt-auto px-1 pt-3"
                  files={draft.files}
                  isPending={isPending}
                  onRemoveFile={(file) =>
                    commitDraft({
                      files: draftRef.current.files.filter(
                        (item) => item !== file,
                      ),
                    })
                  }
                />
              </div>
            </div>

            {/* Bottom Action Bar: Professional Tools + Destination Controller */}
            <div className="flex min-h-12 shrink-0 items-center justify-between gap-2 border-t border-border/40 bg-card/60 px-4 sm:px-6 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]">
              <ComposerCanvasToolbar
                activeFormats={activeFormats}
                captureAvailable={captureAvailable}
                isPending={isPending}
                voiceActive={voiceActive}
                withEditor={withEditor}
                onAddFiles={(files) =>
                  commitDraft({ files: [...draftRef.current.files, ...files] })
                }
                onStartVoice={() => void captureController.start()}
              />
              <ComposerCanvasActions
                canSubmit={canSubmit}
                isPending={isPending}
                isUploadingImages={isUploadingImages}
                publishType={publishType}
                showVisibility={Boolean(showVisibility)}
                voiceActive={voiceActive}
                visibility={draft.visibility}
                onTypeChange={(nextType) => setManualType(nextType)}
                onVisibilityChange={(visibility) => {
                  commitDraft({ visibility });
                  onVisibilityChange?.(visibility);
                }}
              />
            </div>
          </form>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
}
