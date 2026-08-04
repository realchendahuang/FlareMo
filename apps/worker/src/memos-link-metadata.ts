const MAX_HTML_BYTES = 512 * 1024;
const MAX_REDIRECTS = 10;
const REQUEST_TIMEOUT_MS = 5_000;

type MetadataFetcher = typeof fetch;

export type LinkMetadata = {
  url: string;
  title: string;
  description: string;
  image: string;
};

/**
 * Fetches the same small Open Graph surface exposed by Memos' link-metadata
 * RPC. Redirects are followed manually so every hop receives the same URL
 * validation. The Worker runtime cannot perform DNS pinning, so literal and
 * reserved hosts are rejected here; deployments should also keep outbound
 * egress policy at the Cloudflare boundary.
 */
export async function fetchLinkMetadata(
  inputUrl: string,
  fetcher: MetadataFetcher = globalThis.fetch,
): Promise<LinkMetadata> {
  const originalUrl = inputUrl.trim();
  let currentUrl = validateExternalUrl(originalUrl);

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetchWithTimeout(fetcher, currentUrl.href);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new LinkMetadataError("failed to fetch link metadata");
      }
      if (redirect === MAX_REDIRECTS) {
        throw new LinkMetadataError("too many redirects");
      }
      try {
        currentUrl = validateExternalUrl(new URL(location, currentUrl).href);
      } catch (error) {
        if (error instanceof LinkMetadataError) throw error;
        throw new LinkMetadataError("failed to fetch link metadata");
      }
      continue;
    }

    if (!response.ok) {
      throw new LinkMetadataError("failed to fetch link metadata");
    }

    const responseUrl = response.url
      ? validateExternalUrl(response.url)
      : currentUrl;
    const contentType = response.headers.get("content-type")?.toLowerCase();
    if (contentType && !contentType.includes("text/html")) {
      throw new LinkMetadataError("not a HTML page");
    }

    const html = await readLimitedHtml(response);
    const metadata = extractHtmlMetadata(html);
    if (
      responseUrl.hostname === "www.youtube.com" &&
      responseUrl.pathname === "/watch"
    ) {
      const videoId = responseUrl.searchParams.get("v");
      if (videoId)
        metadata.image = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
    }
    return { url: originalUrl, ...metadata };
  }

  throw new LinkMetadataError("too many redirects");
}

export class LinkMetadataError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "LinkMetadataError";
  }
}

function validateExternalUrl(value: string | URL) {
  let url: URL;
  try {
    url = value instanceof URL ? new URL(value.href) : new URL(value);
  } catch {
    throw new LinkMetadataError("invalid URL format");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new LinkMetadataError("only http/https protocols are allowed");
  }
  if (!url.hostname || url.username || url.password) {
    throw new LinkMetadataError("invalid URL format");
  }
  if (url.href.length > 2_048) {
    throw new LinkMetadataError("URL is too long");
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isBlockedHostname(hostname)) {
    throw new LinkMetadataError("internal IP addresses are not allowed");
  }
  return url;
}

function isBlockedHostname(hostname: string) {
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".home.arpa")
  ) {
    return true;
  }

  const octets = hostname.split(".").map(Number);
  if (
    octets.length === 4 &&
    octets.every(
      (octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255,
    )
  ) {
    const [first = -1, second = -1] = octets;
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && (second === 0 || second === 168)) ||
      (first === 198 && (second === 18 || second === 19)) ||
      (first === 203 && second === 0) ||
      first >= 224
    );
  }

  if (hostname.includes(":")) {
    return (
      hostname === "::" ||
      hostname === "::1" ||
      hostname.startsWith("fc") ||
      hostname.startsWith("fd") ||
      hostname.startsWith("fe8") ||
      hostname.startsWith("fe9") ||
      hostname.startsWith("fea") ||
      hostname.startsWith("feb") ||
      hostname.startsWith("::ffff:127.") ||
      hostname.startsWith("::ffff:10.") ||
      hostname.startsWith("::ffff:192.168.")
    );
  }

  return false;
}

async function fetchWithTimeout(fetcher: MetadataFetcher, url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetcher(url, {
      redirect: "manual",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "FlareMo-LinkMetadata/1.0",
      },
      signal: controller.signal,
    });
  } catch {
    throw new LinkMetadataError("failed to fetch link metadata");
  } finally {
    clearTimeout(timeout);
  }
}

async function readLimitedHtml(response: Response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let html = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const value = chunk.value;
      total += value.byteLength;
      if (total > MAX_HTML_BYTES) {
        throw new LinkMetadataError("HTML response is too large");
      }
      html += decoder.decode(value, { stream: true });
    }
    return html + decoder.decode();
  } finally {
    reader.releaseLock();
  }
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
