import { describe, expect, it } from "vitest";
import { attachmentObjectResponse } from "./attachment-http";

type ObjectResponseInput = Parameters<typeof attachmentObjectResponse>[0];

const SIZE = 16044;

/**
 * Mimics the shape the Workers runtime actually hands back: `object.range`
 * keeps a `suffix` key even for offset/length ranges, set to undefined. The
 * echo is deliberately poisoned — response headers must be derived from the
 * request header alone and never from this object.
 */
function fakeBucket(rangeEcho: Record<string, unknown>) {
  const object = {
    body: new ArrayBuffer(8),
    httpEtag: '"etag-1"',
    size: SIZE,
    range: rangeEcho,
  };
  return {
    get: async () => object,
  } as ObjectResponseInput["bucket"];
}

const attachment = {
  r2Key: "attachments/user-1/abc/interview.wav",
  filename: "interview.wav",
  contentType: "audio/wav",
} as ObjectResponseInput["attachment"];

async function respond(range?: string) {
  const request = new Request("https://flaremo.test/blob", {
    headers: range ? { range } : {},
  });
  return attachmentObjectResponse({
    attachment,
    bucket: fakeBucket(rangeEchoFor(range)),
    cacheControl: "public, max-age=3600",
    inlineRequested: true,
    request,
  });
}

/** The echo R2 would produce for the request, in the runtime's real shape. */
function rangeEchoFor(range?: string): Record<string, unknown> {
  if (!range)
    return { offset: undefined, length: undefined, suffix: undefined };
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) return {};
  const [, start, end] = match;
  if (start === "") {
    const suffix = Number(end);
    return { offset: undefined, length: undefined, suffix };
  }
  const offset = Number(start);
  const length =
    end === "" ? SIZE - offset : Math.min(Number(end), SIZE - 1) - offset + 1;
  return { offset, length, suffix: undefined };
}

describe("attachmentObjectResponse range handling", () => {
  it("answers an open-ended media range with a valid Content-Range", async () => {
    const response = await respond("bytes=0-");
    expect(response?.status).toBe(206);
    expect(response?.headers.get("content-range")).toBe(
      `bytes 0-${SIZE - 1}/${SIZE}`,
    );
    expect(response?.headers.get("content-length")).toBe(String(SIZE));
  });

  it("answers an offset-only range", async () => {
    const response = await respond("bytes=100-");
    expect(response?.status).toBe(206);
    expect(response?.headers.get("content-range")).toBe(
      `bytes 100-${SIZE - 1}/${SIZE}`,
    );
    expect(response?.headers.get("content-length")).toBe(String(SIZE - 100));
  });

  it("answers a closed range", async () => {
    const response = await respond("bytes=0-99");
    expect(response?.status).toBe(206);
    expect(response?.headers.get("content-range")).toBe(`bytes 0-99/${SIZE}`);
    expect(response?.headers.get("content-length")).toBe("100");
  });

  it("answers a suffix range", async () => {
    const response = await respond("bytes=-100");
    expect(response?.status).toBe(206);
    expect(response?.headers.get("content-range")).toBe(
      `bytes ${SIZE - 100}-${SIZE - 1}/${SIZE}`,
    );
    expect(response?.headers.get("content-length")).toBe("100");
  });

  it("clamps an over-long end to the object size", async () => {
    const response = await respond("bytes=0-99999");
    expect(response?.status).toBe(206);
    expect(response?.headers.get("content-range")).toBe(
      `bytes 0-${SIZE - 1}/${SIZE}`,
    );
    expect(response?.headers.get("content-length")).toBe(String(SIZE));
  });

  it("falls back to the full object for an unsatisfiable start", async () => {
    const response = await respond("bytes=99999-");
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-range")).toBeNull();
    expect(response?.headers.get("content-length")).toBe(String(SIZE));
  });

  it("serves the whole object without a range header", async () => {
    const response = await respond();
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-range")).toBeNull();
    expect(response?.headers.get("content-length")).toBe(String(SIZE));
  });
});

describe("attachmentObjectResponse thumbnail variant", () => {
  const image = {
    r2Key: "attachments/user-1/photo.webp",
    filename: "photo.webp",
    contentType: "image/webp",
  } as ObjectResponseInput["attachment"];

  function bucketWithPreview(preview: unknown) {
    return {
      get: async (key: string) => {
        if (key.endsWith(".thumb.webp")) return preview;
        return {
          body: new ArrayBuffer(64),
          httpEtag: '"original"',
          size: 4096,
        };
      },
    } as unknown as ObjectResponseInput["bucket"];
  }

  function request(url: string) {
    return new Request(url, { headers: {} });
  }

  it("serves the derived preview when one exists", async () => {
    const preview = {
      body: new ArrayBuffer(4),
      httpEtag: '"thumb"',
      size: 128,
      httpMetadata: { contentType: "image/webp" },
    };
    const response = await attachmentObjectResponse({
      attachment: image,
      bucket: bucketWithPreview(preview),
      cacheControl: "private, max-age=3600",
      inlineRequested: true,
      thumbnailRequested: true,
      request: request("https://flaremo.test/blob?thumbnail=true"),
    });
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("image/webp");
    expect(response?.headers.get("content-length")).toBe("128");
  });

  it("falls back to the original when no preview was generated", async () => {
    const response = await attachmentObjectResponse({
      attachment: image,
      bucket: bucketWithPreview(undefined),
      cacheControl: "private, max-age=3600",
      inlineRequested: true,
      thumbnailRequested: true,
      request: request("https://flaremo.test/blob?thumbnail=true"),
    });
    expect(response?.status).toBe(200);
    // The attachment's own type, not the preview's.
    expect(response?.headers.get("content-type")).toBe("image/webp");
    expect(response?.headers.get("content-length")).toBe("4096");
  });

  it("ignores the thumbnail flag when it is not requested", async () => {
    const response = await attachmentObjectResponse({
      attachment: image,
      bucket: bucketWithPreview({
        body: new ArrayBuffer(4),
        httpEtag: '"thumb"',
        size: 128,
        httpMetadata: { contentType: "image/webp" },
      }),
      cacheControl: "private, max-age=3600",
      inlineRequested: false,
      request: request("https://flaremo.test/blob"),
    });
    expect(response?.headers.get("content-length")).toBe("4096");
  });
});
