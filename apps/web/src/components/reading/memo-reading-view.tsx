import { useEffect, useMemo, useRef } from "react";
import type { Attachment } from "@/api";
import { AttachmentGallery } from "@/components/attachment-gallery";
import { LazyMemoContent } from "@/components/lazy-memo-content";
import { MemoOutline } from "@/components/reading/memo-outline";
import { ReadingAudioBar } from "@/components/reading/reading-audio-bar";
import {
  ReadingAudioProvider,
  useReadingAudio,
} from "@/components/reading/reading-audio-provider";
import { cn } from "@/lib/utils";

export type ReadingViewProps = {
  attachments: Attachment[];
  className?: string;
  /** Applied to the memo body itself, so callers keep their type scale. */
  contentClassName?: string;
  content: string;
  /**
   * `card` keeps the compact timeline treatment; `article` adds the outline and
   * the audio transport.
   */
  layout?: "card" | "article";
};

function isAudio(attachment: Attachment) {
  return Boolean(attachment.content_type?.startsWith("audio/"));
}

function MemoAudioTracks(attachments: Attachment[]) {
  return attachments.filter(isAudio).map((attachment) => ({
    id: attachment.name,
    filename: attachment.filename,
    src: attachment.preview_url,
    downloadUrl: attachment.download_url,
    sizeBytes: attachment.size,
    contentType: attachment.content_type,
  }));
}

/**
 * Marks the paragraph covering the current playback position and, with
 * follow enabled, keeps it in view. Driven by a DOM effect on each tick rather
 * than React state: a transcript can hold tens of thousands of characters, and
 * re-rendering it every second would jank. The effect only re-subscribes when
 * follow or enabled-ness changes — `subscribeTime` is a stable callback, so
 * playback ticks never rebuild it.
 */
function useParagraphHighlight(
  containerRef: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  const audio = useReadingAudio();
  const follow = audio?.follow ?? false;
  const subscribeTime = audio?.subscribeTime;
  // Snapshot for the initial apply; excluded from deps so playback ticks do
  // not re-run the effect (the subscription covers those).
  const initialTimeRef = useRef(0);
  initialTimeRef.current = audio?.currentTime ?? 0;

  useEffect(() => {
    if (!enabled || !subscribeTime) return;
    const container = containerRef.current;
    if (!container) return;

    let highlighted: HTMLElement | null = null;
    const apply = (seconds: number) => {
      const cues = Array.from(
        container.querySelectorAll<HTMLElement>("[data-flaremo-t]"),
      ).sort((a, b) => Number(a.dataset.flaremoT) - Number(b.dataset.flaremoT));

      let active: HTMLElement | null = null;
      for (const cue of cues) {
        if (Number(cue.dataset.flaremoT) <= seconds) active = cue;
        else break;
      }

      const paragraph = active?.closest("p") ?? null;
      if (paragraph === highlighted) return;
      highlighted?.classList.remove("memo-transcript-active");
      paragraph?.classList.add("memo-transcript-active");
      highlighted = paragraph;
      if (follow && paragraph) {
        const reducedMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        paragraph.scrollIntoView({
          behavior: reducedMotion ? "auto" : "smooth",
          block: "center",
        });
      }
    };

    apply(initialTimeRef.current);
    return subscribeTime(apply);
  }, [containerRef, enabled, follow, subscribeTime]);
}

function ArticleReadingView({
  attachments,
  className,
  content,
  contentClassName,
}: Required<Pick<ReadingViewProps, "attachments" | "content">> &
  Pick<ReadingViewProps, "className" | "contentClassName">) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const audio = useReadingAudio();
  useParagraphHighlight(bodyRef, Boolean(audio?.track));

  // Audio rides in the sticky bar, so the gallery keeps only the other files.
  const nonAudio = attachments.filter((item) => !isAudio(item));

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <ReadingAudioBar />
      {/* Stacked on narrow screens (outline collapsed above the body), two
          columns from lg up. The width classes are lg-scoped so the mobile
          outline takes the full row instead of squeezing the transcript. */}
      <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
        <MemoOutline
          className="lg:order-2 lg:w-44 lg:shrink-0"
          content={content}
        />
        <div
          className="flex min-w-0 flex-1 flex-col gap-4 lg:order-1"
          ref={bodyRef}
        >
          <LazyMemoContent
            className={contentClassName}
            content={content}
            onTimestampClick={audio?.seek}
            withHeadingIds
          />
          {nonAudio.length > 0 && <AttachmentGallery attachments={nonAudio} />}
        </div>
      </div>
    </div>
  );
}

function PlainReadingView({
  attachments,
  className,
  content,
  contentClassName,
}: Required<Pick<ReadingViewProps, "attachments" | "content">> &
  Pick<ReadingViewProps, "className" | "contentClassName">) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <LazyMemoContent className={contentClassName} content={content} />
      <AttachmentGallery attachments={attachments} />
    </div>
  );
}

/**
 * One reading surface for every memo entry point. Audio memos get the sticky
 * transport and an outline; everything else renders as it did before.
 */
export function MemoReadingView({
  attachments,
  className,
  content,
  contentClassName,
  layout = "article",
}: ReadingViewProps) {
  // Stable identity across renders: the provider keys restore/save effects on
  // the active track object.
  const tracks = useMemo(() => MemoAudioTracks(attachments), [attachments]);

  if (layout === "article" && tracks.length > 0) {
    return (
      <ReadingAudioProvider tracks={tracks}>
        <ArticleReadingView
          attachments={attachments}
          className={className}
          content={content}
          contentClassName={contentClassName}
        />
      </ReadingAudioProvider>
    );
  }

  return (
    <PlainReadingView
      attachments={attachments}
      className={className}
      content={content}
      contentClassName={contentClassName}
    />
  );
}
