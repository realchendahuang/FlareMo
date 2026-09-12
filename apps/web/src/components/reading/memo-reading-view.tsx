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
    contentType: attachment.content_type,
  }));
}

/**
 * Marks the paragraph covering the current playback position. Driven by a DOM
 * effect on each tick rather than React state: a transcript can hold tens of
 * thousands of characters, and re-rendering it every second would jank.
 */
function useParagraphHighlight(
  containerRef: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  const audio = useReadingAudio();

  useEffect(() => {
    if (!enabled || !audio) return;
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
    };

    apply(audio.currentTime);
    return audio.subscribeTime(apply);
  }, [audio, containerRef, enabled]);
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
      <div className="flex gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-4" ref={bodyRef}>
          <LazyMemoContent
            className={contentClassName}
            content={content}
            onTimestampClick={audio?.seek}
            withHeadingIds
          />
          {nonAudio.length > 0 && <AttachmentGallery attachments={nonAudio} />}
        </div>
        <MemoOutline className="w-44 shrink-0" content={content} />
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
