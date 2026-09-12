import { memo, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createSlugger } from "@/lib/markdown-outline";
import {
  isTimestampHref,
  parseTimestampHref,
  toTimestampHrefMarkdown,
} from "@/lib/transcript";
import { cn } from "@/lib/utils";

/**
 * Plain text of rendered children, used to derive heading ids. Headings almost
 * always render as bare text; inline markup is flattened so the id matches the
 * outline, which flattens the raw Markdown the same way.
 */
function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(nodeText).join("");
  }
  if (typeof node === "object" && "props" in node) {
    return nodeText(
      (node as { props?: { children?: ReactNode } }).props?.children,
    );
  }
  return "";
}

type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

export const MemoContent = memo(function MemoContent({
  className,
  content,
  onTimestampClick,
  withHeadingIds = false,
}: {
  className?: string;
  content: string;
  /**
   * Turns timestamp anchors into seek controls. Without it they stay inert,
   * which is what the timeline card wants.
   */
  onTimestampClick?: (seconds: number) => void;
  /**
   * Gives headings stable ids that match the reading view's outline. A fresh
   * slugger is created per render so duplicate headings number identically
   * under StrictMode's double render.
   */
  withHeadingIds?: boolean;
}) {
  // Transcript bodies rewrite clock markers into `#flaremo-t=` links before
  // parsing; prose without markers passes through untouched.
  const body = onTimestampClick ? toTimestampHrefMarkdown(content) : content;
  const slug = withHeadingIds ? createSlugger() : undefined;

  const heading = (Tag: HeadingTag) =>
    function Heading({
      children,
      node: _node,
      ...props
    }: {
      children?: ReactNode;
      node?: unknown;
    }) {
      return (
        <Tag
          {...props}
          className="scroll-mt-24"
          id={slug ? slug(nodeText(children)) : undefined}
        >
          {children}
        </Tag>
      );
    };

  return (
    <div className={cn("memo-markdown text-[15px] leading-7", className)}>
      <Markdown
        components={{
          a({ href, children, node: _node, ...props }) {
            const seconds = isTimestampHref(href)
              ? parseTimestampHref(href ?? "")
              : null;
            if (seconds !== null && !onTimestampClick) {
              return <span className="memo-timestamp-static">{children}</span>;
            }
            if (seconds !== null && onTimestampClick) {
              return (
                <button
                  className="memo-timestamp"
                  data-flaremo-t={seconds}
                  onClick={() => onTimestampClick(seconds)}
                  type="button"
                >
                  {children}
                </button>
              );
            }

            const external =
              href?.startsWith("http://") || href?.startsWith("https://");
            return (
              <a
                {...props}
                href={href}
                rel={external ? "noreferrer noopener" : undefined}
                target={external ? "_blank" : undefined}
              >
                {children}
              </a>
            );
          },
          h1: heading("h1"),
          h2: heading("h2"),
          h3: heading("h3"),
          h4: heading("h4"),
          h5: heading("h5"),
          h6: heading("h6"),
          img({ node: _node, alt, ...props }) {
            return (
              <img {...props} alt={alt ?? ""} decoding="async" loading="lazy" />
            );
          },
        }}
        remarkPlugins={[remarkGfm]}
        skipHtml
      >
        {body}
      </Markdown>
    </div>
  );
});
