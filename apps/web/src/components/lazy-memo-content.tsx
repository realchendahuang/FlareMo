import { lazy, Suspense } from "react";

const MarkdownMemoContent = lazy(() =>
  import("./memo-content").then((module) => ({ default: module.MemoContent })),
);

export function LazyMemoContent({
  className,
  content,
}: {
  className?: string;
  content: string;
}) {
  return (
    <Suspense
      fallback={
        <div
          className={className ?? "text-[15px] leading-7 whitespace-pre-wrap"}
        >
          {content}
        </div>
      }
    >
      <MarkdownMemoContent className={className} content={content} />
    </Suspense>
  );
}
