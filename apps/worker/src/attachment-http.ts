import type { AttachmentRow } from "@flaremo/db";

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_INLINE_EXPORT_BYTES = 32 * 1024 * 1024;

const INLINE_CONTENT_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "audio/aac",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "application/pdf",
  "text/plain",
]);

export async function attachmentObjectResponse(input: {
  attachment: AttachmentRow;
  bucket: R2Bucket;
  cacheControl: string;
  inlineRequested: boolean;
  request: Request;
}) {
  const range = input.request.headers.get("range");
  const r2Range = range ? parseRangeHeader(range) : undefined;
  const object = await input.bucket.get(
    input.attachment.r2Key,
    r2Range ? { range: r2Range } : undefined,
  );
  if (!object) return undefined;

  const headers = new Headers();
  headers.set(
    "content-type",
    input.attachment.contentType ?? "application/octet-stream",
  );
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", input.cacheControl);
  headers.set(
    "content-disposition",
    contentDisposition(
      input.attachment.filename,
      input.inlineRequested && isInlineSafe(input.attachment.contentType)
        ? "inline"
        : "attachment",
    ),
  );

  if (input.request.headers.get("if-none-match") === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }

  if (range && object.range) {
    const { offset, length } = resolveObjectRange(object.range, object.size);
    headers.set(
      "content-range",
      `bytes ${offset}-${offset + length - 1}/${object.size}`,
    );
    headers.set("content-length", String(length));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set("content-length", String(object.size));
  return new Response(object.body, { headers });
}

function parseRangeHeader(value: string): R2Range | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) return undefined;
  const start = match[1] ? Number(match[1]) : undefined;
  const end = match[2] ? Number(match[2]) : undefined;
  if (start === undefined) {
    return end && end > 0 ? { suffix: end } : undefined;
  }
  if (end === undefined) return { offset: start };
  if (end < start) return undefined;
  return { offset: start, length: end - start + 1 };
}

function resolveObjectRange(range: R2Range, objectSize: number) {
  if ("suffix" in range) {
    const length = Math.min(range.suffix, objectSize);
    return { offset: objectSize - length, length };
  }

  const offset = range.offset ?? 0;
  return {
    offset,
    length: Math.min(range.length ?? objectSize - offset, objectSize - offset),
  };
}

export function createAttachmentObjectKey(
  userId: string,
  filename: string,
  namespace = "attachments",
) {
  const safeFilename =
    filename.replaceAll(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "attachment";
  return `${namespace}/${userId}/${crypto.randomUUID()}/${safeFilename}`;
}

function isInlineSafe(contentType: string | null) {
  if (!contentType) return false;
  return INLINE_CONTENT_TYPES.has(contentType.toLowerCase());
}

function contentDisposition(
  filename: string,
  disposition: "attachment" | "inline",
) {
  const safeFilename = [...filename.replaceAll(/["\\]/g, "_")]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? "_" : character;
    })
    .join("");
  return `${disposition}; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
