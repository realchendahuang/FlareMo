import {
  OutboundFetchError,
  safeOutboundFetch,
  validateOutboundUrl,
} from "@flaremo/domain";
import { describe, expect, it } from "vitest";

describe("safe outbound fetch", () => {
  it("follows redirects manually and returns a bounded body", async () => {
    const requests: Array<{
      url: string;
      redirect: RequestRedirect | undefined;
    }> = [];
    const result = await safeOutboundFetch("https://example.com/start", {
      maxResponseBytes: 64,
      fetcher: async (url, init) => {
        requests.push({ url, redirect: init.redirect });
        if (url.endsWith("/start")) {
          return new Response(null, {
            status: 302,
            headers: { location: "/final" },
          });
        }
        return new Response("ok", {
          headers: { "content-type": "text/plain" },
        });
      },
    });

    expect(requests).toEqual([
      { url: "https://example.com/start", redirect: "manual" },
      { url: "https://example.com/final", redirect: "manual" },
    ]);
    expect(result).toMatchObject({
      url: "https://example.com/final",
      status: 200,
      ok: true,
    });
    expect(new TextDecoder().decode(result.body)).toBe("ok");
  });

  it("validates every redirect hop before issuing the next request", async () => {
    let calls = 0;
    await expect(
      safeOutboundFetch("https://example.com/start", {
        fetcher: async () => {
          calls += 1;
          return new Response(null, {
            status: 307,
            headers: { location: "http://10.0.0.1/admin" },
          });
        },
      }),
    ).rejects.toMatchObject({ code: "blocked_host" });
    expect(calls).toBe(1);
  });

  it("rejects HTTPS-to-HTTP redirects when HTTPS is required", async () => {
    let calls = 0;
    await expect(
      safeOutboundFetch("https://example.com/start", {
        requireHttps: true,
        fetcher: async () => {
          calls += 1;
          return new Response(null, {
            status: 302,
            headers: { location: "http://example.com/downgrade" },
          });
        },
      }),
    ).rejects.toMatchObject({ code: "insecure_protocol" });
    expect(calls).toBe(1);
    expect(() =>
      validateOutboundUrl("http://example.com/", { requireHttps: true }),
    ).toThrow("only https protocol is allowed");
  });

  it("rejects private, mapped, and credential-bearing URLs", () => {
    for (const url of [
      "http://127.0.0.1/",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/",
      "http://[::ffff:7f00:1]/",
      "http://localhost./",
    ]) {
      expect(() => validateOutboundUrl(url)).toThrow(OutboundFetchError);
    }
    expect(() =>
      validateOutboundUrl("https://user:password@example.com/"),
    ).toThrow("invalid URL format");
    expect(() => validateOutboundUrl("ftp://example.com/")).toThrow(
      "only http/https protocols are allowed",
    );
  });

  it("aborts oversized responses", async () => {
    await expect(
      safeOutboundFetch("https://example.com/large", {
        maxResponseBytes: 8,
        fetcher: async () =>
          new Response("this response is too large", {
            headers: { "content-type": "text/plain" },
          }),
      }),
    ).rejects.toMatchObject({ code: "response_too_large" });
  });

  it("enforces the total request timeout", async () => {
    await expect(
      safeOutboundFetch("https://example.com/slow", {
        timeoutMs: 20,
        fetcher: async (_url, init) =>
          await new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true },
            );
          }),
      }),
    ).rejects.toMatchObject({ code: "timeout" });
  });
});
