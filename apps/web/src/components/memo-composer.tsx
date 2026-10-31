import type { Editor } from "@tiptap/react";
import { Suspense, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { MemoVisibility } from "@/api";
import { ComposerFileChips } from "@/components/composer/composer-file-chips";
import { ComposerFocusCanvas } from "@/components/composer/composer-focus-canvas-lazy";
import { ComposerScheduleChip } from "@/components/composer/composer-schedule-menu";
import {
  ComposerMentionSuggestions,
  ComposerTagSuggestions,
  ComposerWikiSuggestions,
} from "@/components/composer/composer-suggestion-lists";
import { ComposerToolbar } from "@/components/composer/composer-toolbar";
import { ComposerVisibilityMenu } from "@/components/composer/composer-visibility-menu";
import {
  type ActiveFormats,
  NO_ACTIVE_FORMATS,
  readActiveFormats,
  sameActiveFormats,
} from "@/components/composer/format-actions";
import { VoiceCaptureBar } from "@/components/composer/voice-capture-bar";
import { RichComposerEditor } from "@/components/rich-composer-editor-lazy";
import { useComposerSuggestions } from "@/hooks/use-composer-suggestions";
import { useComposerVoice } from "@/hooks/use-composer-voice";
import { useInlineImageUploads } from "@/hooks/use-inline-image-uploads";
import { useI18n } from "@/i18n";
import type { MemoCaptureInput } from "@/lib/local-memo-capture";
import { extractTags } from "@/lib/memo";
import { scheduledTaskTitles } from "@/lib/memo-schedule";
import { countMemoImages, MAX_MEMO_IMAGES } from "@/lib/memo-submission";
import type { TagSuggestion } from "@/lib/tag-autocomplete";

type MemoComposerProps = {
  draft: MemoCaptureInput;
  isPending: boolean;
  /** Rendered only when the viewer holds a team membership. */
  showVisibility?: boolean;
  /** Known tags with usage counts, powering the "#" autocomplete. */
  tags?: TagSuggestion[];
  /** Streaming/batch ASR is configured on the instance. */
  captureAvailable?: boolean;
  onDraftChange: (draft: MemoCaptureInput) => void;
  onSubmit: (input: MemoCaptureInput) => Promise<void>;
  onVisibilityChange?: (visibility: MemoVisibility) => void;
};

/**
 * Placeholder while the editor chunk streams in on the very first visit; the
 * idle prefetch makes this flash last one frame in practice.
 */
function ComposerEditorSkeleton() {
  return (
    <div className="min-h-32 rounded-t-xl bg-muted/30" aria-hidden="true" />
  );
}

/**
 * The single memo composer: rich text body, inline image uploads, the two
 * autocompletes, quick voice capture, and the submit rail. The behaviour lives
 * in three hooks (voice session, inline uploads, suggestions); this component
 * only wires them together and owns the layout.
 */
export function MemoComposer({
  draft,
  isPending,
  showVisibility = false,
  tags,
  captureAvailable = false,
  onDraftChange,
  onSubmit,
  onVisibilityChange,
}: MemoComposerProps) {
  const { t } = useI18n();
  const editorRef = useRef<Editor | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  // Toolbar highlight for the selection; only re-renders when a flag flips.
  const [activeFormats, setActiveFormats] =
    useState<ActiveFormats>(NO_ACTIVE_FORMATS);
  const syncActiveFormats = (editor: Editor) => {
    const next = readActiveFormats(editor);
    setActiveFormats((current) =>
      sameActiveFormats(current, next) ? current : next,
    );
  };
  const canSubmit = Boolean(draft.content.trim() || draft.files.length > 0);
  // Idle state shrinks to one line (flomo-style): unfocused and empty. Focus
  // or any content expands the editor back to full height.
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const isCompact = !isComposerFocused && !canSubmit && !isPending;
  // Sending locks the editor (contenteditable=false), which blurs it. That
  // blur is not the author leaving: keep the box expanded and hand the caret
  // back once the send settles, so the next note can be typed straight away.
  const isPendingRef = useRef(isPending);
  isPendingRef.current = isPending;
  const refocusAfterSendRef = useRef(false);
  useEffect(() => {
    if (isPending || !refocusAfterSendRef.current) return;
    refocusAfterSendRef.current = false;
    editorRef.current?.commands.focus("end");
  }, [isPending]);
  // Uploads read the latest draft through a ref: the async chain would
  // otherwise insert into a stale closure while the user keeps typing.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // All edits rebuild from draftRef, not the render-time prop: an inline
  // upload chain can land between the render and this event, and building
  // from the old prop would silently drop the chain's inserted markdown.
  const commitDraft = (patch: Partial<MemoCaptureInput>) => {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    onDraftChange(next);
  };

  const { isUploadingImages, enqueueInlineUploads, preuploadMarkdownRef } =
    useInlineImageUploads({ editorRef, draftRef, commitDraft });

  const updateContent = (content: string) => {
    // Drop preuploaded entries whose inline reference was deleted, so sending
    // never re-binds an image the author removed from the text.
    const kept = draftRef.current.preuploadedAttachmentNames?.filter((name) => {
      const markdown = preuploadMarkdownRef.current.get(name);
      // Names without a tracked markdown (restored drafts) stay bound.
      return !markdown || content.includes(markdown);
    });
    commitDraft({
      content,
      tags: extractTags(content),
      preuploadedAttachmentNames: kept,
    });
  };

  // The draft writer goes through a ref so the voice session's review effect
  // never re-runs on every keystroke.
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
    setActiveMentionToken,
    mentionSuggestions,
    showMentionSuggestions,
    acceptMentionSuggestion,
  } = useComposerSuggestions({
    editorRef,
    containerRef: formRef,
    isPending,
    tags,
    // Mentions only reach someone in a shared space.
    mentions: showVisibility,
  });

  const { capture, captureController, voiceActive, now } = useComposerVoice({
    draftRef,
    updateContentRef,
  });

  const submit = async () => {
    // Images still uploading have no reference in the content yet; sending
    // now would lose them to the orphan GC. A live voice session belongs to
    // the draft in progress, not to a memo being sent.
    if (!canSubmit || isUploadingImages || voiceActive) {
      return;
    }
    refocusAfterSendRef.current = Boolean(
      formRef.current?.contains(document.activeElement),
    );
    try {
      await onSubmit(draft);
    } catch {
      // The mutation owns user-facing error feedback; keep the draft intact.
    }
  };
  const withEditor = (action: (editor: Editor) => void) => {
    if (isPending) return;
    const editor = editorRef.current;
    if (!editor) return;
    action(editor);
  };

  return (
    <form
      className="paper group relative flex w-full flex-col rounded-xl border border-border/80 bg-card shadow-xs motion-safe:animate-rise motion-safe:transition-[border-color,box-shadow] motion-safe:duration-200 focus-within:border-[color-mix(in_oklch,var(--input),var(--foreground)_10%)] focus-within:shadow-md"
      data-compact={isCompact ? "true" : undefined}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        // Focus moving somewhere real means the author left on purpose.
        if (event.relatedTarget) refocusAfterSendRef.current = false;
        if (isPendingRef.current && !event.relatedTarget) return;
        setIsComposerFocused(false);
      }}
      onFocus={() => setIsComposerFocused(true)}
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Suspense fallback={<ComposerEditorSkeleton />}>
        <RichComposerEditor
          ariaLabel={t("composer.ariaLabel")}
          content={draft.content}
          disabled={isPending}
          editorRef={editorRef}
          onContentChange={updateContent}
          onImageFiles={enqueueInlineUploads}
          onTagTokenChange={tags ? setActiveTagToken : undefined}
          onWikiLinkTokenChange={setActiveWikiToken}
          onMentionTokenChange={
            showVisibility ? setActiveMentionToken : undefined
          }
          onSuggestionKeyDown={handleSuggestionKeyDown}
          onTransaction={syncActiveFormats}
          formatMenu="note"
          onSubmitRequest={() => {
            if (!isUploadingImages && !voiceActive) void submit();
          }}
          placeholder={t("composer.placeholder")}
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
      <ComposerMentionSuggestions
        visible={showMentionSuggestions}
        suggestions={mentionSuggestions}
        activeIndex={suggestionIndex}
        anchor={suggestionAnchor}
        onAccept={acceptMentionSuggestion}
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
      <ComposerFileChips
        files={draft.files}
        isPending={isPending}
        onRemoveFile={(file) =>
          commitDraft({
            files: draftRef.current.files.filter((item) => item !== file),
          })
        }
      />
      {draft.schedule && (
        <ComposerScheduleChip
          disabled={isPending}
          schedule={draft.schedule}
          taskCount={scheduledTaskTitles(draft.content).length}
          onClear={() => commitDraft({ schedule: undefined })}
        />
      )}
      <div className="flex h-11 items-center justify-between gap-2 rounded-b-xl border-t border-border/50 px-2.5 motion-safe:transition-colors group-data-[compact=true]:border-transparent">
        <ComposerToolbar
          activeFormats={activeFormats}
          isPending={isPending}
          voiceActive={voiceActive}
          captureAvailable={captureAvailable}
          withEditor={withEditor}
          onAddFiles={(files) => {
            // A note holds nine images at most; extra picks are dropped
            // with a pointer to articles rather than failing at send time.
            let room = MAX_MEMO_IMAGES - countMemoImages(draftRef.current);
            const accepted = files.filter((file) => {
              if (!file.type.startsWith("image/")) return true;
              room -= 1;
              return room >= 0;
            });
            if (accepted.length < files.length) {
              toast.error(t("toast.tooManyMemoImages"));
            }
            if (accepted.length === 0) return;
            commitDraft({ files: [...draftRef.current.files, ...accepted] });
          }}
          schedule={draft.schedule}
          onScheduleChange={(schedule) => commitDraft({ schedule })}
          onStartVoice={() => void captureController.start()}
          onExpand={() => setIsFullscreenOpen(true)}
        />
        <ComposerVisibilityMenu
          showVisibility={showVisibility}
          visibility={draft.visibility}
          isPending={isPending}
          isUploadingImages={isUploadingImages}
          canSubmit={canSubmit}
          voiceActive={voiceActive}
          onVisibilityChange={(visibility) => {
            commitDraft({ visibility });
            onVisibilityChange?.(visibility);
          }}
        />
      </div>
      {isFullscreenOpen && (
        <Suspense fallback={null}>
          <ComposerFocusCanvas
            open={isFullscreenOpen}
            onOpenChange={setIsFullscreenOpen}
            draft={draft}
            isPending={isPending}
            showVisibility={showVisibility}
            tags={tags}
            captureAvailable={captureAvailable}
            onDraftChange={onDraftChange}
            onSubmitMemo={onSubmit}
            onVisibilityChange={onVisibilityChange}
          />
        </Suspense>
      )}
    </form>
  );
}
