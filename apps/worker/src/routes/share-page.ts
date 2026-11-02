import {
  extractReferencedAttachmentIds,
  injectShareTokenIntoFileUrls,
} from "@flaremo/contracts";
import { getBranding, getPublicShareByToken } from "@flaremo/domain";
import type { Context, Hono } from "hono";
import { SitemapIndexStream, streamToPromise } from "sitemap";
import { getFlareMoDb, type HonoBindings } from "../context";
import {
  attachmentImageDimensions,
  contentToPlainText,
  createSanitizedMarked,
  escapeHtml,
  truncate,
} from "./markdown-render";
import {
  PAPER_PAGE_STYLES,
  PAPER_THEME_COLOR,
  PAPER_UNAVAILABLE_STYLES,
  paperDateZh,
  paperPostmark,
} from "./paper-page-styles";
import { PUBLIC_PAGE_SECURITY_HEADERS } from "./public-page-security";

/**
 * Public memo share pages (`/share/:token`) as standalone lightweight HTML
 * (docs/seo-share-pages-best-practices.md, P1 strategy B).
 *
 * The web app is a pure SPA that would hand every crawler and social scraper
 * an empty 3KB shell, and it loads the whole React bundle just to show one
 * memo. This route serves a zero-JS, server-rendered document instead:
 *
 * - full SEO meta: unique title/description, canonical, Open Graph + Twitter
 *   card (image dimensions/alt from attachment payloads), JSON-LD, og:locale
 * - real rendered markdown (the shared sanitized marked pipeline, which
 *   mirrors the web app's react-markdown + remark-gfm behavior)
 * - body images resolved anonymously via `?share_token=` (the same contract
 *   the SPA share page uses) with intrinsic width/height to avoid CLS
 * - dead shares (revoked / expired / unknown tokens) return a tiny noindex
 *   page with status 404 instead of a soft-404 200
 * - `/sitemap.xml` serves a sitemapindex pointing at the enumerable public
 *   surface (articles); share tokens stay unenumerable by design
 */

const DESCRIPTION_MAX_CHARS = 160;
const HEADLINE_MAX_CHARS = 80;
const JSONLD_TEXT_MAX_CHARS = 20_000;
const SHARE_HTML_CACHE_CONTROL = "public, max-age=60, must-revalidate";

type SharePageEnv = Context<HonoBindings>["env"];

function publicOrigin(env: SharePageEnv, request: Request): string {
  const configured = env.FLAREMO_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return new URL(request.url).origin;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

type SharePageData = Awaited<ReturnType<typeof getPublicShareByToken>>;
type ShareAttachment = SharePageData["attachments"][number];

// ---------------------------------------------------------------------------
// Attachment references (shared with the web app and article renderer).
// ---------------------------------------------------------------------------

export { extractReferencedAttachmentIds, injectShareTokenIntoFileUrls };

// ---------------------------------------------------------------------------
// Markdown rendering (shared sanitized pipeline in markdown-render.ts).
// ---------------------------------------------------------------------------

function createShareMarked(
  dimensionsByAttachmentId: Map<string, { width: number; height: number }>,
) {
  return createSanitizedMarked({ dimensionsByAttachmentId });
}

function renderMarkdown(input: {
  content: string;
  dimensionsByAttachmentId: Map<string, { width: number; height: number }>;
}): string {
  return createShareMarked(input.dimensionsByAttachmentId).parse(
    input.content,
    { async: false },
  );
}

// ---------------------------------------------------------------------------

function publicBlobUrl(token: string, attachment: ShareAttachment): string {
  const id = attachment.id.replace(/^attachments\//, "");
  // Attachment ids come from user data (imports included). Encode both
  // segments so a quote or slash can never break out of the HTML attribute
  // this URL is written into.
  return `/api/public/shares/${encodeURIComponent(token)}/attachments/${encodeURIComponent(id)}/blob`;
}

function renderUnreferencedAttachments(
  token: string,
  attachments: ShareAttachment[],
  content: string,
): string {
  const referenced = extractReferencedAttachmentIds(content);
  const rest = attachments.filter(
    (attachment) =>
      !referenced.has(attachment.id.replace(/^attachments\//, "")),
  );
  if (rest.length === 0) return "";
  const items = rest.map((attachment) => {
    const url = publicBlobUrl(token, attachment);
    const escapedName = escapeHtml(attachment.filename);
    if (attachment.contentType?.startsWith("image/")) {
      const dimensions = attachmentImageDimensions(attachment.payload);
      const sizeAttributes = dimensions
        ? ` width="${dimensions.width}" height="${dimensions.height}"`
        : ' loading="lazy" decoding="async"';
      return `<figure class="gallery-item"><img src="${escapeHtml(url)}?preview=1" alt="${escapedName}"${sizeAttributes} /><figcaption>${escapedName}</figcaption></figure>`;
    }
    if (attachment.contentType?.startsWith("audio/")) {
      return `<audio controls preload="none" src="${escapeHtml(url)}"></audio>`;
    }
    return `<p><a href="${escapeHtml(url)}" download>${escapedName}</a><span class="muted"> ${formatBytes(attachment.size)}</span></p>`;
  });
  return `<hr />${items.join("\n")}`;
}

function metaTag(attr: string, attrValue: string, content: string): string {
  return `<meta ${attr}="${escapeHtml(attrValue)}" content="${escapeHtml(content)}" />`;
}

type ShareMetaInput = {
  origin: string;
  token: string;
  product: string;
  faviconUrl: string | null;
  faviconType: string | null;
  data: SharePageData;
};

function firstImageAttachment(
  attachments: ShareAttachment[],
): ShareAttachment | null {
  return (
    attachments.find((attachment) =>
      attachment.contentType?.startsWith("image/"),
    ) ?? null
  );
}

function buildHeadTags(input: ShareMetaInput): string {
  const { origin, token, product, data } = input;
  const plainText = contentToPlainText(data.memo.content);
  const canonical = `${origin}/share/${token}`;
  const headline =
    truncate(plainText, HEADLINE_MAX_CHARS) || `${product} 记录分享`;
  const description = truncate(plainText, DESCRIPTION_MAX_CHARS) || product;
  const image = firstImageAttachment(data.attachments);
  const imageUrl = image
    ? `${origin}${publicBlobUrl(token, image)}?preview=1`
    : null;
  const imageDimensions = image
    ? attachmentImageDimensions(image.payload)
    : undefined;

  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    // BlogPosting: the page presents the memo as a publishable document; the
    // SocialMediaPosting type undersold long-form content to search engines.
    "@type": "BlogPosting",
    headline,
    datePublished: data.memo.createdAt,
    dateModified: data.memo.updatedAt,
    author: { "@type": "Person", name: data.user.name },
    mainEntityOfPage: canonical,
    ...(imageUrl ? { image: [imageUrl] } : {}),
  };
  if (plainText) {
    jsonLd.text = truncate(plainText, JSONLD_TEXT_MAX_CHARS);
  }
  const jsonLdScript = JSON.stringify(jsonLd)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

  const tags = [
    `<title>${escapeHtml(headline)}</title>`,
    metaTag("name", "description", description),
    metaTag("name", "robots", "index, follow"),
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    metaTag("property", "og:title", headline),
    metaTag("property", "og:description", description),
    metaTag("property", "og:type", "article"),
    metaTag("property", "og:url", canonical),
    metaTag("property", "og:site_name", product),
    metaTag(
      "property",
      "og:locale",
      ogLocaleFor(detectShareLang(data.memo.content)),
    ),
    metaTag("property", "article:published_time", data.memo.createdAt),
    metaTag(
      "name",
      "twitter:card",
      imageUrl ? "summary_large_image" : "summary",
    ),
    metaTag("name", "twitter:title", headline),
    metaTag("name", "twitter:description", description),
    `<script type="application/ld+json">${jsonLdScript}</script>`,
  ];
  if (imageUrl) {
    tags.push(metaTag("property", "og:image", imageUrl));
    tags.push(metaTag("name", "twitter:image", imageUrl));
    if (imageDimensions) {
      tags.push(
        metaTag("property", "og:image:width", String(imageDimensions.width)),
      );
      tags.push(
        metaTag("property", "og:image:height", String(imageDimensions.height)),
      );
    }
    tags.push(metaTag("property", "og:image:alt", image?.filename ?? ""));
  }
  return tags.join("\n    ");
}

/**
 * Best-effort content language for a shared note.
 *
 * A memo carries no declared language (the `memos` table has no such column),
 * so the alternative is guessing from the text. Only scripts that are
 * *uniquely identifying* are used: kana appear in Japanese and nowhere else in
 * our locale set, hangul only in Korean, and the Arabic block only in Arabic.
 * Shared Han is deliberately not tested — it would misclassify Simplified as
 * Japanese/Korean — so everything else keeps the zh-CN default, which matches
 * this page's Chinese chrome.
 *
 * The value drives <html lang>, which is what selects the Han *font face*:
 * without it a Japanese note renders through PingFang SC and its kana/kanji
 * take Chinese glyph forms.
 */
/** `og:locale` uses underscores ("zh_CN"); the document uses hyphens. */
function ogLocaleFor(lang: string): string {
  return lang.replace(/-/g, "_");
}

export function detectShareLang(content: string): string {
  if (/[\u3040-\u30ff\u31f0-\u31ff]/.test(content)) return "ja";
  if (/[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/.test(content)) return "ko";
  if (/[\u0600-\u06ff\u0750-\u077f\ufb50-\ufdff]/.test(content)) return "ar";
  return "zh-CN";
}

export function renderShareDocument(input: ShareMetaInput): string {
  const { origin, token, product, data } = input;
  const dimensionsByAttachmentId = new Map<
    string,
    { width: number; height: number }
  >();
  for (const attachment of data.attachments) {
    const dimensions = attachmentImageDimensions(attachment.payload);
    if (dimensions) {
      dimensionsByAttachmentId.set(
        attachment.id.replace(/^attachments\//, ""),
        dimensions,
      );
    }
  }
  const content = injectShareTokenIntoFileUrls(data.memo.content, token);
  const bodyHtml = renderMarkdown({
    content,
    dimensionsByAttachmentId,
  });
  const galleryHtml = renderUnreferencedAttachments(
    token,
    data.attachments,
    data.memo.content,
  );

  // Derived from the note's own script so its Han text selects the right face
  // (see detectShareLang). The surrounding chrome is Chinese-only, so an RTL
  // note still renders its chrome LTR — fixing that needs translated copy.
  const lang = detectShareLang(data.memo.content);

  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <meta name="theme-color" content="${PAPER_THEME_COLOR.light}" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="${PAPER_THEME_COLOR.dark}" media="(prefers-color-scheme: dark)" />
    ${buildHeadTags(input)}
    <link
      rel="icon"
      href="${escapeHtml(input.faviconUrl ?? "/brand/flaremo-mark-light-300.png")}"
      type="${escapeHtml(input.faviconType ?? "image/png")}"
    />
    <style>${PAPER_PAGE_STYLES}</style>
  </head>
  <body>
    <div class="desk">
      <main class="sheet">
        <header class="masthead ui" lang="zh-CN">
          <a href="${escapeHtml(origin)}/"><span class="seal" aria-hidden="true"></span>${escapeHtml(product)}</a>
          <time class="postmark" datetime="${escapeHtml(data.memo.createdAt)}">${escapeHtml(paperPostmark(data.memo.createdAt))}</time>
        </header>
        <article data-flaremo-share-article>${bodyHtml}</article>
        ${galleryHtml ? `<section class="gallery">${galleryHtml}</section>` : ""}
        <!-- The page declares the note's language; this chrome is Chinese-only
             copy, so it carries its own lang to keep Chinese glyph forms. -->
        <footer lang="zh-CN">
          <span class="author">${escapeHtml(data.user.name)}</span>
          <time datetime="${escapeHtml(data.memo.createdAt)}">写于 ${escapeHtml(paperDateZh(data.memo.createdAt))}</time>
        </footer>
      </main>
      <p class="colophon ui" lang="zh-CN"><a href="${escapeHtml(origin)}">在 ${escapeHtml(product)} 里，安静地记下想法</a></p>
    </div>
  </body>
</html>`;
}

function renderShareUnavailableDocument(product: string): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <title>${escapeHtml(product)}</title>
    <meta name="robots" content="noindex, nofollow" />
    <style>${PAPER_UNAVAILABLE_STYLES}</style>
  </head>
  <body>
    <div class="note">
      <span class="seal" aria-hidden="true"></span>
      <p>这张纸条已经被收回，或从未寄出。</p>
      <p class="ui">${escapeHtml(product)}</p>
    </div>
  </body>
</html>`;
}

const SHARE_RESPONSE_INIT = {
  headers: {
    "content-type": "text/html; charset=utf-8",
    "cache-control": SHARE_HTML_CACHE_CONTROL,
    ...PUBLIC_PAGE_SECURITY_HEADERS,
  },
} as const;

export function registerSharePage(app: Hono<HonoBindings>): void {
  // The only enumerable public surface is published articles, so the
  // sitemap index points there. Share tokens stay unenumerable by design —
  // generating a share sitemap would leak the very links the token model
  // keeps out of search.
  app.get("/sitemap.xml", async (c) => {
    const origin = publicOrigin(c.env, c.req.raw);
    const stream = new SitemapIndexStream();
    stream.write({ url: `${origin}/sitemap-articles.xml` });
    stream.end();
    const xml = await streamToPromise(stream);
    return new Response(xml.toString(), {
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "cache-control": "public, max-age=3600, must-revalidate",
      },
    });
  });

  app.get("/share/:token", async (c) => {
    const db = getFlareMoDb(c.env);
    try {
      const data = await getPublicShareByToken(db, c.req.param("token"));
      const branding = await getBranding(db);
      const input: ShareMetaInput = {
        origin: publicOrigin(c.env, c.req.raw),
        token: c.req.param("token"),
        product: branding.product,
        faviconUrl: branding.favicon
          ? `/api/app/branding/favicon?v=${encodeURIComponent(branding.favicon.updated_at)}`
          : null,
        faviconType: branding.favicon?.content_type ?? null,
        data,
      };
      return new Response(renderShareDocument(input), {
        ...SHARE_RESPONSE_INIT,
      });
    } catch {
      const branding = await getBranding(db).catch(() => null);
      const product = branding?.product ?? "FlareMo";
      return new Response(renderShareUnavailableDocument(product), {
        ...SHARE_RESPONSE_INIT,
        status: 404,
      });
    }
  });
}
