import { Link } from "@tanstack/react-router";
import { ExternalLinkIcon, ListPlusIcon } from "lucide-react";
import {
  Children,
  type ImgHTMLAttributes,
  isValidElement,
  memo,
  type ReactElement,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { apiRequest } from "@/api/client";
import { ImageLightbox } from "@/components/image-lightbox";
import { useI18n } from "@/i18n";
import { createSlugger } from "@/lib/markdown-outline";
import { memoTaskLines } from "@/lib/memo-tasks";
import {
  protectLiteralLayout,
  remarkLiteralBreaks,
  remarkLiteralHashes,
} from "@/lib/remark-literal";
import { mentionFromHref, remarkTags, tagFromHref } from "@/lib/remark-tags";
import {
  isTimestampHref,
  parseTimestampHref,
  toTimestampHrefMarkdown,
} from "@/lib/transcript";
import { cn } from "@/lib/utils";

export type ResolvedLinkMetadata = {
  url: string;
  title: string;
  description: string;
  image: string;
};

type CachedLinkEntry =
  | { status: "hit"; data: ResolvedLinkMetadata }
  | { status: "miss" };

const MAX_LINK_CACHE_ENTRIES = 200;
const MAX_PREVIEW_URLS_PER_MEMO = 2;

const linkMetadataCache = new Map<string, CachedLinkEntry>();
const linkMetadataInflight = new Map<string, Promise<CachedLinkEntry>>();

/** Test hook to reset the module-level metadata cache between cases. */
export function clearLinkMetadataCache() {
  linkMetadataCache.clear();
  linkMetadataInflight.clear();
}

function cacheSet(url: string, entry: CachedLinkEntry) {
  if (linkMetadataCache.size >= MAX_LINK_CACHE_ENTRIES) {
    const oldest = linkMetadataCache.keys().next().value;
    if (oldest !== undefined) linkMetadataCache.delete(oldest);
  }
  linkMetadataCache.set(url, entry);
}

function fetchCachedLinkMetadata(url: string): Promise<CachedLinkEntry> {
  const existing = linkMetadataCache.get(url);
  if (existing) return Promise.resolve(existing);
  const inflight = linkMetadataInflight.get(url);
  if (inflight) return inflight;

  const task = apiRequest<{
    url?: string;
    title?: string;
    description?: string;
    image?: string;
  }>(
    "/memos.api.v1.MemoService/GetLinkMetadata",
    {
      method: "POST",
      body: JSON.stringify({ url }),
    },
    { authRequired: false },
  )
    .then((raw): CachedLinkEntry => {
      const title = raw?.title?.trim() ?? "";
      const description = raw?.description?.trim() ?? "";
      const image = raw?.image?.trim() ?? "";
      if (!title && !description) {
        const miss: CachedLinkEntry = { status: "miss" };
        cacheSet(url, miss);
        return miss;
      }
      const hit: CachedLinkEntry = {
        status: "hit",
        data: {
          url,
          title,
          description,
          image: /^https?:\/\//i.test(image) ? image : "",
        },
      };
      cacheSet(url, hit);
      return hit;
    })
    .catch((): CachedLinkEntry => {
      const miss: CachedLinkEntry = { status: "miss" };
      cacheSet(url, miss);
      return miss;
    })
    .finally(() => {
      linkMetadataInflight.delete(url);
    });

  linkMetadataInflight.set(url, task);
  return task;
}

function trimUrlTrailingPunctuation(raw: string): string {
  let url = raw;
  // Strip sentence punctuation glued to the end of a pasted link while
  // preserving balanced parentheses (e.g. Wikipedia URLs).
  while (url.length > 0) {
    const last = url[url.length - 1];
    if (last && /[.,!?;:'"，。！？；：、）》】」』>]/.test(last)) {
      url = url.slice(0, -1);
      continue;
    }
    if (last === ")") {
      const opens = (url.match(/\(/g) ?? []).length;
      const closes = (url.match(/\)/g) ?? []).length;
      if (closes > opens) {
        url = url.slice(0, -1);
        continue;
      }
    }
    break;
  }
  return url;
}

/**
 * Extracts up to `maxUrls` external http(s) URLs suitable for a quiet preview
 * card beneath the note body. Skips code blocks, inline code, markdown images,
 * and prose links that already carry custom anchor text (`[Read docs](url)`).
 */
export function extractPreviewableUrls(
  markdown: string,
  maxUrls = MAX_PREVIEW_URLS_PER_MEMO,
): string[] {
  if (!markdown?.includes("http")) return [];

  // 1. Strip fenced code blocks and inline code spans.
  const withoutCode = markdown
    .replace(/^(?:`{3,}|~{3,})[\s\S]*?^(?:`{3,}|~{3,})\s*$/gm, " ")
    .replace(/`[^`\n]+`/g, " ");

  // 2. Strip markdown images `![alt](url)` and custom-titled links `[label](url)`
  //    (keep `[https://...](https://...)` where the label is the URL itself).
  const withoutTitledLinks = withoutCode
    .replace(/!\[[^\]]*]\([^)\n]*\)/g, " ")
    .replace(/\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/gi, (_full, label, href) => {
      return String(label).trim() === String(href).trim() ? String(href) : " ";
    });

  const seen = new Set<string>();
  const results: string[] = [];
  const pattern = /https?:\/\/[^\s<>[\]"'`]+/gi;

  for (const match of withoutTitledLinks.matchAll(pattern)) {
    const cleaned = trimUrlTrailingPunctuation(match[0]);
    try {
      const parsed = new URL(cleaned);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        continue;
      }
      if (
        typeof window !== "undefined" &&
        window.location?.origin &&
        parsed.origin === window.location.origin
      ) {
        continue;
      }
      const normalized = parsed.toString();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      results.push(normalized);
      if (results.length >= maxUrls) break;
    } catch {
      // Malformed URL token; ignore.
    }
  }

  return results;
}

function formatLinkDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

function LinkPreviewCard({ item }: { item: ResolvedLinkMetadata }) {
  const [imageFailed, setImageFailed] = useState(false);
  const headline = item.title || item.description;
  const summary =
    item.title && item.description && item.description !== item.title
      ? item.description
      : "";
  const showImage = Boolean(item.image && !imageFailed);

  return (
    <a
      className="group/linkcard flex items-start justify-between gap-3 rounded-xl border border-border/60 bg-muted/35 p-3 text-start no-underline outline-none transition-colors hover:border-border hover:bg-muted/65 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 motion-safe:animate-fade"
      data-testid="memo-link-preview"
      href={item.url}
      onClick={(event) => event.stopPropagation()}
      rel="noreferrer noopener"
      target="_blank"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className="inline-flex items-center gap-1 text-xs text-muted-foreground"
          dir="ltr"
        >
          <ExternalLinkIcon aria-hidden="true" className="size-3 shrink-0" />
          <span className="truncate">{formatLinkDomain(item.url)}</span>
        </span>
        <span
          className="line-clamp-1 text-sm font-medium text-foreground group-hover/linkcard:text-primary transition-colors"
          dir="auto"
        >
          {headline}
        </span>
        {summary && (
          <span
            className="line-clamp-2 text-xs leading-5 text-muted-foreground"
            dir="auto"
          >
            {summary}
          </span>
        )}
      </span>
      {showImage && (
        <img
          alt=""
          aria-hidden="true"
          className="size-16 shrink-0 rounded-lg border border-border/50 bg-muted object-cover"
          decoding="async"
          loading="lazy"
          onError={() => setImageFailed(true)}
          referrerPolicy="no-referrer"
          src={item.image}
        />
      )}
    </a>
  );
}

function MemoLinkPreviews({ urls }: { urls: readonly string[] }) {
  const [items, setItems] = useState<ResolvedLinkMetadata[]>(() => {
    const initial: ResolvedLinkMetadata[] = [];
    for (const url of urls) {
      const cached = linkMetadataCache.get(url);
      if (cached?.status === "hit") initial.push(cached.data);
    }
    return initial;
  });

  useEffect(() => {
    let cancelled = false;
    void Promise.all(urls.map((url) => fetchCachedLinkMetadata(url))).then(
      (entries) => {
        if (cancelled) return;
        const resolved: ResolvedLinkMetadata[] = [];
        for (const entry of entries) {
          if (entry.status === "hit") resolved.push(entry.data);
        }
        setItems((prev) => {
          if (
            prev.length === resolved.length &&
            prev.every((item, idx) => item.url === resolved[idx]?.url)
          ) {
            return prev;
          }
          return resolved;
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [urls]);

  if (items.length === 0) return null;

  return (
    <div
      className="mt-2.5 flex flex-col gap-2"
      data-testid="memo-link-previews"
    >
      {items.map((item) => (
        <LinkPreviewCard item={item} key={item.url} />
      ))}
    </div>
  );
}

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
 * placeholder carrying the alt text. Clicking a live body image opens the
 * full-screen lightbox without wrapping the `<img>` in a `<button>`.
 */
function MarkdownImage({
  alt,
  className,
  node: _node,
  ...props
}: MarkdownImageProps) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const src = typeof props.src === "string" ? props.src : "";

  if (failed) {
    return (
      <span className="memo-image-broken">
        {alt?.trim() ? alt : t("markdown.imageUnavailable")}
      </span>
    );
  }
  return (
    <>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: keeps bare <img> semantics in prose while offering pointer zoom */}
      <img
        {...props}
        alt={alt ?? ""}
        className={cn(src && "cursor-zoom-in", className)}
        decoding="async"
        loading="lazy"
        onClick={
          src
            ? (event) => {
                event.stopPropagation();
                setLightboxOpen(true);
              }
            : undefined
        }
        onError={() => setFailed(true)}
      />
      {lightboxOpen && src && (
        <ImageLightbox
          images={[{ src, alt: alt || undefined }]}
          index={0}
          open={lightboxOpen}
          onOpenChange={setLightboxOpen}
        />
      )}
    </>
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
  // Articles pass rehype plugins and are typeset as documents. A note is a
  // record, so its blank lines, indentation and lone `#` survive Markdown.
  const source = rehypePlugins ? body : protectLiteralLayout(body);
  const slug = withHeadingIds ? createSlugger() : undefined;
  const interactiveTasks = Boolean(onToggleTask || onConvertTask);
  const previewUrls = useMemo(
    () => (rehypePlugins ? [] : extractPreviewableUrls(content)),
    [content, rehypePlugins],
  );

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
          dir="auto"
          id={slug ? slug(nodeText(children)) : undefined}
        >
          {children}
        </Tag>
      );
    };

  return (
    <>
      <div className={cn("memo-markdown text-[15px] leading-7", className)}>
        <Markdown
          components={{
            p({ node: _node, children, ...props }) {
              return (
                <p {...props} dir="auto">
                  {children}
                </p>
              );
            },
            blockquote({ node: _node, children, ...props }) {
              return (
                <blockquote {...props} dir="auto">
                  {children}
                </blockquote>
              );
            },
            ul({ node: _node, children, ...props }) {
              return (
                <ul {...props} dir="auto">
                  {children}
                </ul>
              );
            },
            ol({ node: _node, children, ...props }) {
              return (
                <ol {...props} dir="auto">
                  {children}
                </ol>
              );
            },
            a({ href, children, node: _node, ...props }) {
              const mention = mentionFromHref(href);
              if (mention !== null) {
                return (
                  <bdi className="memo-mention" dir="auto">
                    {children}
                  </bdi>
                );
              }
              const tag = tagFromHref(href);
              if (tag !== null) {
                return onTagClick ? (
                  <button
                    className="memo-tag"
                    dir="auto"
                    type="button"
                    onClick={(event) => {
                      // The card body is not a link; keep the click local.
                      event.stopPropagation();
                      onTagClick(tag);
                    }}
                  >
                    <bdi dir="auto">{children}</bdi>
                  </button>
                ) : (
                  <bdi className="memo-tag" dir="auto">
                    {children}
                  </bdi>
                );
              }
              const seconds = isTimestampHref(href)
                ? parseTimestampHref(href ?? "")
                : null;
              if (seconds !== null && !onTimestampClick) {
                return (
                  <span className="memo-timestamp-static">{children}</span>
                );
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
                  <li {...props} className={className} dir="auto">
                    {children}
                  </li>
                );
              }
              const items = Children.toArray(children);
              const checkboxIndex = items.findIndex(isCheckbox);
              if (checkboxIndex < 0) {
                return (
                  <li {...props} className={className} dir="auto">
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
                <li
                  {...props}
                  className={cn("group/task", className)}
                  dir="auto"
                >
                  {onToggleTask ? (
                    <input
                      aria-label={
                        checked
                          ? t("memo.taskMarkTodo")
                          : t("memo.taskMarkDone")
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
          remarkPlugins={
            rehypePlugins
              ? [remarkGfm, remarkBreaks, remarkTags]
              : [
                  remarkGfm,
                  remarkLiteralBreaks,
                  remarkBreaks,
                  remarkLiteralHashes,
                  remarkTags,
                ]
          }
          skipHtml
        >
          {source}
        </Markdown>
      </div>
      {previewUrls.length > 0 && <MemoLinkPreviews urls={previewUrls} />}
    </>
  );
});
