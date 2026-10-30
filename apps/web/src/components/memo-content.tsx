import { Link } from "@tanstack/react-router";
import { ListPlusIcon } from "lucide-react";
import {
  Children,
  type ImgHTMLAttributes,
  isValidElement,
  memo,
  type ReactElement,
  type ReactNode,
  useState,
} from "react";
import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { useI18n } from "@/i18n";
import { createSlugger } from "@/lib/markdown-outline";
import { memoTaskLines } from "@/lib/memo-tasks";
import { mentionFromHref, remarkTags, tagFromHref } from "@/lib/remark-tags";
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

type MarkdownImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "alt"> & {
  alt?: string;
  node?: unknown;
};

/**
 * Body images degrade in place: a deleted attachment would otherwise render
 * as a broken-image glyph, so a failed load swaps the element for a caption
 * placeholder carrying the alt text.
 */
function MarkdownImage({ alt, node: _node, ...props }: MarkdownImageProps) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span className="memo-image-broken">
        {alt?.trim() ? alt : t("markdown.imageUnavailable")}
      </span>
    );
  }
  return (
    <img
      {...props}
      alt={alt ?? ""}
      decoding="async"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

/** D2: the read view's GFM checkboxes are live when a caller opts in. */
type TaskInteraction = {
  /** `lineIndex` is a 0-based index into the raw Markdown source. */
  onToggleTask?: (lineIndex: number, checked: boolean) => void;
  /** Upgrades a to-do line into a FlareMo task linked back to this memo. */
  onConvertTask?: (lineIndex: number, text: string) => void;
};

/** The disabled checkbox remark-gfm renders as a list item's first child. */
function isCheckbox(
  child: ReactNode,
): child is ReactElement<{ type?: string; checked?: boolean }> {
  return (
    isValidElement(child) &&
    child.type === "input" &&
    (child.props as { type?: string }).type === "checkbox"
  );
}

export const MemoContent = memo(function MemoContent({
  className,
  content,
  onTimestampClick,
  withHeadingIds = false,
  interactiveTaskLists = false,
  resolveImageDimensions,
  onToggleTask,
  onConvertTask,
  onTagClick,
  rehypePlugins,
}: {
  className?: string;
  content: string;
  /** Makes in-text `#tags` filter the timeline; without it they are inert. */
  onTagClick?: (tag: string) => void;
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
  /**
   * Renders task-list checkboxes enabled so a click can be intercepted
   * upstream (the card layer rewrites the Markdown). Without it they stay
   * disabled decorations, as remark-gfm emits them.
   */
  interactiveTaskLists?: boolean;
  /**
   * Maps a body image's src to its attachment's intrinsic dimensions so the
   * rendered box is reserved before the bytes load (no layout shift).
   */
  resolveImageDimensions?: (
    src: string,
  ) => { width: number; height: number } | undefined;
  /**
   * Article-surface extras (Shiki highlighting) passed straight through to
   * the markdown processor. Memo cards never set it.
   */
  rehypePlugins?: import("unified").Pluggable[];
} & TaskInteraction) {
  const { t } = useI18n();
  // Transcript bodies rewrite clock markers into `#flaremo-t=` links before
  // parsing; prose without markers passes through untouched.
  const body = onTimestampClick ? toTimestampHrefMarkdown(content) : content;
  const slug = withHeadingIds ? createSlugger() : undefined;
  const interactiveTasks = Boolean(onToggleTask || onConvertTask);

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
            const mention = mentionFromHref(href);
            if (mention !== null) {
              return <span className="memo-mention">{children}</span>;
            }
            const tag = tagFromHref(href);
            if (tag !== null) {
              return onTagClick ? (
                <button
                  className="memo-tag"
                  type="button"
                  onClick={(event) => {
                    // The card body is not a link; keep the click local.
                    event.stopPropagation();
                    onTagClick(tag);
                  }}
                >
                  {children}
                </button>
              ) : (
                <span className="memo-tag">{children}</span>
              );
            }
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

            if (href?.startsWith("/memo/")) {
              return (
                <Link
                  className="font-medium text-foreground underline decoration-brand-500/50 underline-offset-2 transition-colors hover:text-brand-600 hover:decoration-brand-500"
                  to={href}
                >
                  {children}
                </Link>
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
          input({ node: _node, disabled: _disabled, ...props }) {
            if (!interactiveTaskLists) {
              return <input {...props} disabled type="checkbox" />;
            }
            // The card layer owns toggling (event delegation on the
            // container); readOnly keeps React's controlled-input contract
            // while the click handler prevents the default flip.
            return <input {...props} readOnly type="checkbox" />;
          },
          img({ node: _node, ...props }) {
            const dimensions = resolveImageDimensions?.(
              typeof props.src === "string" ? props.src : "",
            );
            return (
              <MarkdownImage
                {...props}
                {...(dimensions
                  ? {
                      width: dimensions.width,
                      height: dimensions.height,
                      style: {
                        aspectRatio: `${dimensions.width} / ${dimensions.height}`,
                      },
                    }
                  : {})}
              />
            );
          },
          li({ className, node, children, ...props }) {
            if (!interactiveTasks) {
              return (
                <li {...props} className={className}>
                  {children}
                </li>
              );
            }
            const items = Children.toArray(children);
            const checkboxIndex = items.findIndex(isCheckbox);
            if (checkboxIndex < 0) {
              return (
                <li {...props} className={className}>
                  {children}
                </li>
              );
            }
            const checkbox = items[checkboxIndex] as ReactElement<{
              checked?: boolean;
            }>;
            const body = items.filter((_, index) => index !== checkboxIndex);
            const checked = Boolean(checkbox.props.checked);
            // The hast node carries its source position; the 1-based line is
            // exactly the `- [ ]` line for a GFM task item.
            const lineIndex = (node?.position?.start.line ?? 1) - 1;
            return (
              <li {...props} className={cn("group/task", className)}>
                {onToggleTask ? (
                  <input
                    aria-label={
                      checked ? t("memo.taskMarkTodo") : t("memo.taskMarkDone")
                    }
                    checked={checked}
                    type="checkbox"
                    onChange={(event) =>
                      onToggleTask(lineIndex, event.target.checked)
                    }
                  />
                ) : (
                  checkbox
                )}
                {body}
                {onConvertTask && (
                  <button
                    aria-label={t("memo.convertToTask")}
                    className="mx-1 inline-flex size-5 items-center justify-center rounded-md align-middle text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-safe:transition-opacity group-hover/task:opacity-100"
                    title={t("memo.convertToTask")}
                    type="button"
                    onClick={() => {
                      const text = memoTaskLines(content).find(
                        (line) => line.lineIndex === lineIndex,
                      )?.text;
                      if (text) onConvertTask(lineIndex, text);
                    }}
                  >
                    <ListPlusIcon className="size-3.5" />
                  </button>
                )}
              </li>
            );
          },
        }}
        rehypePlugins={rehypePlugins}
        remarkPlugins={[remarkGfm, remarkBreaks, remarkTags]}
        skipHtml
      >
        {body}
      </Markdown>
    </div>
  );
});
