import {
  OutboundFetchError,
  type OutboundFetcher,
  safeOutboundFetch,
  validateOutboundUrl,
} from "@flaremo/domain";

const MAX_HTML_BYTES = 512 * 1024;
const MAX_OEMBED_BYTES = 128 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;
const OEMBED_SUMMARY_MAX_CHARS = 500;
const USER_AGENT = "FlareMo-LinkMetadata/1.0";

const X_HOSTS = new Set(["x.com", "www.x.com", "mobile.x.com"]);
const TWITTER_HOSTS = new Set([
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
]);
const SHELL_TWEET_TITLES = new Set([
  "",
  "x",
  "twitter",
  "x (formerly twitter)",
]);

export type LinkMetadata = {
  url: string;
  title: string;
  description: string;
  image: string;
};

type ParsedMetadataFields = Omit<LinkMetadata, "url">;

type ParsedTweetUrl = {
  canonicalUrl: string;
  handle: string | null;
  statusId: string;
};

/**
 * Fetches the same small Open Graph surface exposed by Memos' link-metadata
 * RPC. The shared outbound fetch validates every redirect hop, enforces the
 * timeout and caps the response body before it is buffered. The Worker runtime
 * cannot resolve DNS for pinning, so literal and reserved hosts are rejected;
 * deployments should also keep outbound egress policy at the Cloudflare
 * boundary.
 *
 * X / Twitter status URLs no longer serve Open Graph tags to plain HTTP clients
 * (returning an empty JS shell instead), so tweet URLs resolve through the
 * public unauthenticated `publish.twitter.com/oembed` endpoint first and fall
 * back gracefully when oEmbed times out or answers 404.
 */
export async function fetchLinkMetadata(
  inputUrl: string,
  fetcher: OutboundFetcher = globalThis.fetch as OutboundFetcher,
): Promise<LinkMetadata> {
  const originalUrl = inputUrl.trim();
  try {
    const initialUrl = validateOutboundUrl(originalUrl, {
      allowFragment: true,
    });
    const directTweet = parseTweetUrl(initialUrl);
    if (directTweet) {
      const oembed = await fetchTweetOembedMetadata(directTweet, fetcher);
      if (oembed) {
        return { url: originalUrl, ...oembed };
      }
      try {
        const htmlMetadata = await fetchHtmlPageMetadata(originalUrl, fetcher);
        return {
          url: originalUrl,
          ...withTweetFallbackTitle(htmlMetadata, directTweet),
        };
      } catch (error) {
        if (isSecurityOutboundError(error)) {
          throw error;
        }
        return {
          url: originalUrl,
          title: fallbackTweetTitle(directTweet),
          description: "",
          image: "",
        };
      }
    }

    const htmlMetadata = await fetchHtmlPageMetadata(originalUrl, fetcher);
    return { url: originalUrl, ...htmlMetadata };
  } catch (error) {
    throw normalizeLinkMetadataError(error);
  }
}

export class LinkMetadataError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "LinkMetadataError";
  }
}

async function fetchHtmlPageMetadata(
  targetUrl: string,
  fetcher: OutboundFetcher,
): Promise<ParsedMetadataFields> {
  const response = await safeOutboundFetch(targetUrl, {
    allowFragment: true,
    fetcher,
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": USER_AGENT,
    },
    maxResponseBytes: MAX_HTML_BYTES,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  if (!response.ok) {
    throw new LinkMetadataError("failed to fetch link metadata");
  }

  const responseUrl = new URL(response.url);
  const contentType = response.headers.get("content-type")?.toLowerCase();
  if (
    contentType &&
    !contentType.includes("text/html") &&
    !contentType.includes("application/xhtml+xml")
  ) {
    throw new LinkMetadataError("not a HTML page");
  }

  const html = new TextDecoder().decode(response.body);
  const metadata = extractHtmlMetadata(html, responseUrl);

  const redirectedTweet = parseTweetUrl(responseUrl);
  if (
    redirectedTweet &&
    isShellTweetTitle(metadata.title) &&
    !metadata.description
  ) {
    const oembed = await fetchTweetOembedMetadata(redirectedTweet, fetcher);
    if (oembed) {
      return {
        title: oembed.title,
        description: oembed.description,
        image: oembed.image || metadata.image,
      };
    }
    return withTweetFallbackTitle(metadata, redirectedTweet);
  }

  if (
    responseUrl.hostname === "www.youtube.com" &&
    responseUrl.pathname === "/watch"
  ) {
    const videoId = responseUrl.searchParams.get("v");
    if (videoId && /^[\w-]{6,32}$/.test(videoId)) {
      metadata.image = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
    }
  }
  return metadata;
}

function parseTweetUrl(url: URL): ParsedTweetUrl | null {
  const host = url.hostname.toLowerCase();
  const canonicalHost = X_HOSTS.has(host)
    ? "x.com"
    : TWITTER_HOSTS.has(host)
      ? "twitter.com"
      : null;
  if (!canonicalHost) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  if (
    segments[0]?.toLowerCase() === "i" &&
    segments[1]?.toLowerCase() === "web" &&
    segments[2]?.toLowerCase() === "status" &&
    segments[3] &&
    /^\d{1,30}$/.test(segments[3])
  ) {
    const statusId = segments[3];
    return {
      canonicalUrl: `https://${canonicalHost}/i/web/status/${statusId}`,
      handle: null,
      statusId,
    };
  }
  if (
    segments[0]?.toLowerCase() === "i" &&
    segments[1]?.toLowerCase() === "status" &&
    segments[2] &&
    /^\d{1,30}$/.test(segments[2])
  ) {
    const statusId = segments[2];
    return {
      canonicalUrl: `https://${canonicalHost}/i/web/status/${statusId}`,
      handle: null,
      statusId,
    };
  }
  if (
    segments[0] &&
    /^[A-Za-z0-9_]{1,30}$/.test(segments[0]) &&
    segments[0].toLowerCase() !== "i" &&
    segments[1]?.toLowerCase() === "status" &&
    segments[2] &&
    /^\d{1,30}$/.test(segments[2])
  ) {
    const handle = segments[0];
    const statusId = segments[2];
    return {
      canonicalUrl: `https://${canonicalHost}/${handle}/status/${statusId}`,
      handle,
      statusId,
    };
  }
  return null;
}

function extractHandleFromAuthorUrl(authorUrl: string): string | null {
  try {
    const parsed = new URL(authorUrl.trim());
    const host = parsed.hostname.toLowerCase();
    if (!X_HOSTS.has(host) && !TWITTER_HOSTS.has(host)) return null;
    const first = parsed.pathname.split("/").filter(Boolean)[0];
    if (first && /^[A-Za-z0-9_]{1,30}$/.test(first) && first !== "i") {
      return first;
    }
  } catch {
    // Ignore malformed author_url in oEmbed payloads.
  }
  return null;
}

async function fetchTweetOembedMetadata(
  tweet: ParsedTweetUrl,
  fetcher: OutboundFetcher,
): Promise<ParsedMetadataFields | null> {
  const endpoint = `https://publish.twitter.com/oembed?omit_script=true&dnt=true&url=${encodeURIComponent(tweet.canonicalUrl)}`;
  let response: Awaited<ReturnType<typeof safeOutboundFetch>>;
  try {
    response = await safeOutboundFetch(endpoint, {
      fetcher,
      headers: {
        accept: "application/json",
        "user-agent": USER_AGENT,
      },
      maxResponseBytes: MAX_OEMBED_BYTES,
      requireHttps: true,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
  } catch (error) {
    if (isSecurityOutboundError(error)) {
      throw error;
    }
    return null;
  }

  if (!response.ok) return null;

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(response.body));
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return null;
  }

  const record = json as Record<string, unknown>;
  const authorName =
    typeof record.author_name === "string"
      ? decodeHtml(record.author_name)
      : "";
  const handleFromAuthorUrl =
    typeof record.author_url === "string"
      ? extractHandleFromAuthorUrl(record.author_url)
      : null;
  const handle = handleFromAuthorUrl ?? tweet.handle;
  const tweetText =
    typeof record.html === "string" ? extractTweetPlainText(record.html) : "";
  const image =
    typeof record.thumbnail_url === "string"
      ? resolveHttpImageUrl(record.thumbnail_url)
      : "";

  if (!authorName && !tweetText) {
    return null;
  }

  const title = buildTweetTitle(authorName, handle);
  const description = truncateText(tweetText, OEMBED_SUMMARY_MAX_CHARS);
  return { title, description, image };
}

function buildTweetTitle(authorName: string, handle: string | null): string {
  if (authorName && handle) {
    return `${authorName} (@${handle}) on X`;
  }
  if (authorName) {
    return `${authorName} on X`;
  }
  if (handle) {
    return `@${handle} on X`;
  }
  return "Post on X";
}

function fallbackTweetTitle(tweet: ParsedTweetUrl): string {
  return tweet.handle ? `@${tweet.handle} on X` : "Post on X";
}

function isShellTweetTitle(title: string): boolean {
  return SHELL_TWEET_TITLES.has(title.trim().toLowerCase());
}

function withTweetFallbackTitle(
  metadata: ParsedMetadataFields,
  tweet: ParsedTweetUrl,
): ParsedMetadataFields {
  if (isShellTweetTitle(metadata.title)) {
    return { ...metadata, title: fallbackTweetTitle(tweet) };
  }
  return metadata;
}

function extractTweetPlainText(rawHtml: string): string {
  const withoutCommentsOrScripts = stripNonContentBlocks(rawHtml);
  const paragraphs = [
    ...withoutCommentsOrScripts.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi),
  ]
    .map((match) => match[1] ?? "")
    .filter((chunk) => chunk.trim().length > 0);

  let source: string;
  if (paragraphs.length > 0) {
    source = paragraphs.join(" ");
  } else {
    // Malformed oEmbed HTML: handle an unclosed <p> or bare blockquote content
    // while stripping the trailing "— Author (@handle) Date" attribution line.
    const openParagraph = /<p\b[^>]*>([\s\S]*)$/i.exec(
      withoutCommentsOrScripts,
    );
    source =
      (openParagraph ? openParagraph[1] : withoutCommentsOrScripts) ?? "";
    source = source
      .replace(/<\/?blockquote\b[^>]*>/gi, " ")
      .replace(/(?:&mdash;|&#8212;|&#x2014;|—)\s*[^<]*<a\b[\s\S]*$/i, " ");
  }

  return decodeHtml(source.replace(/<br\s*\/?>/gi, " "));
}

function isSecurityOutboundError(error: unknown): boolean {
  return (
    error instanceof OutboundFetchError &&
    (error.code === "blocked_host" ||
      error.code === "unsupported_protocol" ||
      error.code === "insecure_protocol" ||
      error.code === "too_many_redirects" ||
      error.code === "invalid_url" ||
      error.code === "invalid_redirect")
  );
}

function normalizeLinkMetadataError(error: unknown): LinkMetadataError {
  if (error instanceof LinkMetadataError) return error;
  if (error instanceof OutboundFetchError) {
    if (error.code === "response_too_large") {
      return new LinkMetadataError("HTML response is too large");
    }
    if (error.code === "too_many_redirects") {
      return new LinkMetadataError("too many redirects");
    }
    if (
      error.code === "invalid_url" ||
      error.code === "unsupported_protocol" ||
      error.code === "insecure_protocol" ||
      error.code === "blocked_host"
    ) {
      return new LinkMetadataError(error.message);
    }
  }
  return new LinkMetadataError("failed to fetch link metadata");
}

function extractHtmlMetadata(
  html: string,
  responseUrl: URL,
): ParsedMetadataFields {
  const rawHead = html.split(/<body\b/i, 1)[0] ?? html;
  const head = stripNonContentBlocks(rawHead);
  const metaMap = parseMetaTags(head);
  const title = decodeHtml(
    firstNonEmpty(
      findMetaFromMap(metaMap, ["og:title", "twitter:title"]),
      findTitle(head),
    ),
  );
  const description = decodeHtml(
    firstNonEmpty(
      findMetaFromMap(metaMap, [
        "og:description",
        "twitter:description",
        "description",
      ]),
    ),
  );
  const rawImage = findMetaFromMap(metaMap, [
    "og:image",
    "og:image:url",
    "twitter:image",
    "twitter:image:src",
  ]);
  const image = resolveHttpImageUrl(rawImage, responseUrl);
  return { title, description, image };
}

function stripNonContentBlocks(html: string): string {
  return html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?(?:<\/script\s*>|$)/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?(?:<\/style\s*>|$)/gi, " ");
}

function findTitle(html: string) {
  const match = /<title\b[^>]*>([\s\S]*?)(?:<\/title\s*>|$)/i.exec(html);
  return match?.[1] ?? "";
}

function parseMetaTags(headHtml: string): Map<string, string> {
  const entries = new Map<string, string>();
  const tags = headHtml.match(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) ?? [];
  const attributePattern =
    /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+?)(?=\s*\/>)|([^\s"'<>`]+))/g;

  for (const tag of tags) {
    const attributes = new Map<string, string>();
    for (const match of tag.matchAll(attributePattern)) {
      const attrName = match[1]?.toLowerCase() ?? "";
      const attrValue = match[2] ?? match[3] ?? match[4] ?? match[5] ?? "";
      if (attrName && !attributes.has(attrName)) {
        attributes.set(attrName, attrValue);
      }
    }
    const key = (
      attributes.get("property") ??
      attributes.get("name") ??
      attributes.get("itemprop")
    )
      ?.trim()
      .toLowerCase();
    const content = attributes.get("content");
    if (key && content?.trim() && !entries.has(key)) {
      entries.set(key, content);
    }
  }
  return entries;
}

function findMetaFromMap(metaMap: Map<string, string>, names: string[]) {
  for (const name of names) {
    const value = metaMap.get(name.toLowerCase());
    if (value?.trim()) return value;
  }
  return "";
}

function resolveHttpImageUrl(rawValue: string, baseUrl?: URL): string {
  const decoded = decodeHtmlEntities(rawValue).trim();
  if (!decoded) return "";
  try {
    const resolved = baseUrl ? new URL(decoded, baseUrl) : new URL(decoded);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return "";
    }
    if (resolved.username || resolved.password) {
      return "";
    }
    return resolved.href;
  } catch {
    return "";
  }
}

function firstNonEmpty(...values: string[]) {
  return values.find((value) => value.trim()) ?? "";
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

function safeFromCodePoint(codePoint: number, fallback: string): string {
  if (
    !Number.isInteger(codePoint) ||
    codePoint <= 0 ||
    codePoint > 0x10ffff ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff)
  ) {
    return fallback;
  }
  return String.fromCodePoint(codePoint);
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&hellip;/gi, "…")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&lsquo;|&rsquo;/gi, "'")
    .replace(/&#x([\da-f]{1,8});?/gi, (raw, hex: string) =>
      safeFromCodePoint(Number.parseInt(hex, 16), raw),
    )
    .replace(/&#(\d{1,8});?/g, (raw, decimal: string) =>
      safeFromCodePoint(Number.parseInt(decimal, 10), raw),
    )
    .replace(/&amp;/gi, "&");
}

function decodeHtml(value: string) {
  return decodeHtmlEntities(
    value
      .replace(/<[A-Za-z!/](?:[^>"']|"[^"]*"|'[^']*')*>/g, " ")
      .replace(/<[A-Za-z!/][^>]*$/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}
