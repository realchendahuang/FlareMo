import {
  OutboundFetchError,
  type OutboundFetcher,
  safeOutboundFetch,
} from "@flaremo/domain";

const MAX_HTML_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;

export type LinkMetadata = {
  url: string;
  title: string;
  description: string;
  image: string;
};

/**
 * Fetches the same small Open Graph surface exposed by Memos' link-metadata
 * RPC. The shared outbound fetch validates every redirect hop, enforces the
 * timeout and caps the response body before it is buffered. The Worker runtime
 * cannot resolve DNS for pinning, so literal and reserved hosts are rejected;
 * deployments should also keep outbound egress policy at the Cloudflare
 * boundary.
 */
export async function fetchLinkMetadata(
  inputUrl: string,
  fetcher: OutboundFetcher = globalThis.fetch as OutboundFetcher,
): Promise<LinkMetadata> {
  const originalUrl = inputUrl.trim();
  try {
    const response = await safeOutboundFetch(originalUrl, {
      allowFragment: true,
      fetcher,
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "FlareMo-LinkMetadata/1.0",
      },
      maxResponseBytes: MAX_HTML_BYTES,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    if (!response.ok) {
      throw new LinkMetadataError("failed to fetch link metadata");
    }

    const responseUrl = new URL(response.url);
    const contentType = response.headers.get("content-type")?.toLowerCase();
    if (contentType && !contentType.includes("text/html")) {
      throw new LinkMetadataError("not a HTML page");
    }

    const html = new TextDecoder().decode(response.body);
    const metadata = extractHtmlMetadata(html);
    if (
      responseUrl.hostname === "www.youtube.com" &&
      responseUrl.pathname === "/watch"
    ) {
      const videoId = responseUrl.searchParams.get("v");
      if (videoId) {
        metadata.image = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
      }
    }
    return { url: originalUrl, ...metadata };
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
      error.code === "blocked_host"
    ) {
      return new LinkMetadataError(error.message);
    }
  }
  return new LinkMetadataError("failed to fetch link metadata");
}

function extractHtmlMetadata(html: string) {
  const head = html.split(/<body\b/i, 1)[0] ?? html;
  const title = decodeHtml(
    firstNonEmpty(
      findMeta(head, ["og:title", "twitter:title"]),
      findTitle(head),
    ),
  );
  const description = decodeHtml(
    firstNonEmpty(
      findMeta(head, ["og:description", "twitter:description"]),
      findMeta(head, ["description"]),
    ),
  );
  const image = decodeHtml(findMeta(head, ["og:image", "twitter:image"]));
  return { title, description, image };
}

function findTitle(html: string) {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  return match?.[1] ?? "";
}

function findMeta(html: string, names: string[]) {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const attributes = new Map<string, string>();
    const attributePattern =
      /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    for (const match of tag.matchAll(attributePattern)) {
      attributes.set(
        match[1]?.toLowerCase() ?? "",
        match[2] ?? match[3] ?? match[4] ?? "",
      );
    }
    const name = attributes.get("property") ?? attributes.get("name");
    const content = attributes.get("content");
    if (name && content !== undefined && wanted.has(name.toLowerCase())) {
      return content;
    }
  }
  return "";
}

function firstNonEmpty(...values: string[]) {
  return values.find((value) => value.trim()) ?? "";
}

function decodeHtml(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([\da-f]{1,6});?/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d{1,7});?/g, (_, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replace(/\s+/g, " ")
    .trim();
}
