import { Component, lazy, type ReactNode, Suspense } from "react";

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

export function LazyMemoContent({
  className,
  content,
}: {
  className?: string;
  content: string;
}) {
  return (
    <MemoContentErrorBoundary
      fallback={<PlainMemoContent className={className} content={content} />}
    >
      <Suspense
        fallback={<PlainMemoContent className={className} content={content} />}
      >
        <MarkdownMemoContent className={className} content={content} />
      </Suspense>
    </MemoContentErrorBoundary>
  );
}
