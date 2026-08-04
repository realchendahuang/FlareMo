import { describe, expect, it } from "vitest";
import { fetchLinkMetadata } from "./memos-link-metadata";

describe("Memos link metadata", () => {
  it("follows safe redirects and extracts Open Graph metadata", async () => {
    const requests: string[] = [];
    const metadata = await fetchLinkMetadata(
      "https://example.com/article",
      async (input) => {
        const url = String(input);
        requests.push(url);
        if (url.endsWith("/article")) {
          return new Response(null, {
            status: 302,
            headers: { location: "/article/" },
          });
        }
        return new Response(
          `<!doctype html><head>
            <title>Fallback &amp; title</title>
            <meta content="Open Graph title" property="og:title">
            <meta name="description" content="Description &amp; details">
            <meta property="og:image" content="https://cdn.example.com/cover.png">
          </head><body>ignored</body>`,
          { headers: { "content-type": "text/html; charset=utf-8" } },
        );
      },
    );

    expect(requests).toEqual([
      "https://example.com/article",
      "https://example.com/article/",
    ]);
    expect(metadata).toEqual({
      url: "https://example.com/article",
      title: "Open Graph title",
      description: "Description & details",
      image: "https://cdn.example.com/cover.png",
    });
  });

  it("rejects private hosts before making an outbound request", async () => {
    let called = false;
    await expect(
      fetchLinkMetadata("http://169.254.169.254/latest/meta-data", async () => {
        called = true;
        return new Response("should not be fetched");
      }),
    ).rejects.toThrow("internal IP addresses are not allowed");
    expect(called).toBe(false);
  });

  it("rejects non-HTML responses and malformed protocols", async () => {
    await expect(
      fetchLinkMetadata(
        "ftp://example.com/file",
        async () => new Response("not used"),
      ),
    ).rejects.toThrow("only http/https protocols are allowed");
    await expect(
      fetchLinkMetadata(
        "https://example.com/data.json",
        async () =>
          new Response("{}", {
            headers: { "content-type": "application/json" },
          }),
      ),
    ).rejects.toThrow("not a HTML page");
  });
});
