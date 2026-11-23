import { Component, lazy, memo, type ReactNode, Suspense } from "react";

const MarkdownMemoContent = lazy(() =>
  import("./memo-content").then((module) => ({ default: module.MemoContent })),
);

function PlainMemoContent({
  className,
  content,
}: {
  className?: string;
  content: string;
}) {
  return (
    <div className={className ?? "text-[15px] leading-7 whitespace-pre-wrap"}>
      {content}
    </div>
  );
}

/**
 * The Markdown renderer is a lazy chunk. When it cannot load (offline with a
 * cold cache, a stale deploy, …) notes must stay readable instead of taking
 * down the whole route, so import failures fall back to plain text.
 */
class MemoContentErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

export const LazyMemoContent = memo(function LazyMemoContent({
  className,
  content,
  onTimestampClick,
  withHeadingIds,
  interactiveTaskLists,
  resolveImageDimensions,
  onToggleTask,
  onConvertTask,
  onTagClick,
  rehypePlugins,
}: {
  className?: string;
  content: string;
  onTimestampClick?: (seconds: number) => void;
  withHeadingIds?: boolean;
  interactiveTaskLists?: boolean;
  resolveImageDimensions?: (
    src: string,
  ) => { width: number; height: number } | undefined;
  /** D2: live GFM checkboxes in the read view; see MemoContent. */
  onToggleTask?: (lineIndex: number, checked: boolean) => void;
  onConvertTask?: (lineIndex: number, text: string) => void;
  /** In-text `#tags` filter the timeline when given. */
  onTagClick?: (tag: string) => void;
  /** Article-surface extras (Shiki); see MemoContent. */
  rehypePlugins?: import("unified").Pluggable[];
}) {
  return (
    <MemoContentErrorBoundary
      fallback={<PlainMemoContent className={className} content={content} />}
    >
      <Suspense
        fallback={<PlainMemoContent className={className} content={content} />}
      >
        <MarkdownMemoContent
          className={className}
          content={content}
          interactiveTaskLists={interactiveTaskLists}
          onTagClick={onTagClick}
          onTimestampClick={onTimestampClick}
          rehypePlugins={rehypePlugins}
          resolveImageDimensions={resolveImageDimensions}
          withHeadingIds={withHeadingIds}
          onToggleTask={onToggleTask}
          onConvertTask={onConvertTask}
        />
      </Suspense>
    </MemoContentErrorBoundary>
  );
});
