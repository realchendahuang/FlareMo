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

  it("parses single-quoted, unquoted, and out-of-order <meta> tags and resolves relative images against the final URL", async () => {
    const metadata = await fetchLinkMetadata(
      "https://example.com/jump",
      async (input) => {
        const url = String(input);
        if (url === "https://example.com/jump") {
          return new Response(null, {
            status: 301,
            headers: { location: "https://blog.example.com/posts/2026/entry" },
          });
        }
        return new Response(
          `<!doctype html><head>
            <!-- <meta property="og:title" content="Commented out"> -->
            <script>const tpl = '<meta property="og:title" content="Script noise">';</script>
            <meta name=twitter:title content='Fallback Twitter Title'>
            <meta content='A &gt; B — Deep Dive' property='og:title' />
            <meta content=Plain_unquoted_summary name=description/>
            <meta name=twitter:image content=../assets/card.png?v=1&amp;w=800/>
          </head><body></body>`,
          { headers: { "content-type": "text/html; charset=utf-8" } },
        );
      },
    );

    expect(metadata).toEqual({
      url: "https://example.com/jump",
      title: "A > B — Deep Dive",
      description: "Plain_unquoted_summary",
      image: "https://blog.example.com/posts/assets/card.png?v=1&w=800",
    });
  });

  it("drops non-http(s) or credential-bearing og:image / twitter:image schemes", async () => {
    for (const rawImage of [
      "javascript:alert(1)",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      "ftp://cdn.example.com/cover.png",
      "https://user:secret@cdn.example.com/cover.png",
    ]) {
      const metadata = await fetchLinkMetadata(
        "https://example.com/post",
        async () =>
          new Response(
            `<!doctype html><head>
              <title>Safe Post</title>
              <meta property="og:image" content="${rawImage}">
            </head>`,
            { headers: { "content-type": "text/html" } },
          ),
      );
      expect(metadata.image).toBe("");
      expect(metadata.title).toBe("Safe Post");
    }
  });

  it("extracts X / Twitter tweet metadata via publish.twitter.com oEmbed across desktop, mobile, and /i/web/status URLs", async () => {
    const calls: string[] = [];
    const metadata = await fetchLinkMetadata(
      "https://mobile.x.com/ada/status/1899999999999999999/photo/1?s=46",
      async (input) => {
        const url = String(input);
        calls.push(url);
        expect(url).toBe(
          "https://publish.twitter.com/oembed?omit_script=true&dnt=true&url=https%3A%2F%2Fx.com%2Fada%2Fstatus%2F1899999999999999999",
        );
        return new Response(
          JSON.stringify({
            author_name: "Ada Lovelace",
            author_url: "https://twitter.com/ada",
            html: '<blockquote class="twitter-tweet" data-dnt="true"><p lang="en" dir="ltr">Analytical Engine notes &amp; diagrams!<br><a href="https://t.co/abc">#FlareMo</a></p>&mdash; Ada Lovelace (@ada) <a href="https://twitter.com/ada/status/1899999999999999999">November 18, 2026</a></blockquote>\n',
          }),
          { headers: { "content-type": "application/json; charset=utf-8" } },
        );
      },
    );

    expect(calls).toHaveLength(1);
    expect(metadata).toEqual({
      url: "https://mobile.x.com/ada/status/1899999999999999999/photo/1?s=46",
      title: "Ada Lovelace (@ada) on X",
      description: "Analytical Engine notes & diagrams! #FlareMo",
      image: "",
    });

    const webStatus = await fetchLinkMetadata(
      "https://twitter.com/i/web/status/20",
      async (input) => {
        expect(String(input)).toBe(
          "https://publish.twitter.com/oembed?omit_script=true&dnt=true&url=https%3A%2F%2Ftwitter.com%2Fi%2Fweb%2Fstatus%2F20",
        );
        return new Response(
          JSON.stringify({
            author_name: "jack",
            author_url: "https://twitter.com/jack",
            html: '<blockquote class="twitter-tweet"><p lang="en">just setting up my twttr</p>&mdash; jack (@jack) <a href="https://twitter.com/jack/status/20">March 21, 2006</a></blockquote>',
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
    );
    expect(webStatus).toEqual({
      url: "https://twitter.com/i/web/status/20",
      title: "jack (@jack) on X",
      description: "just setting up my twttr",
      image: "",
    });
  });

  it("handles malformed HTML and out-of-range numeric entities in oEmbed without throwing", async () => {
    const metadata = await fetchLinkMetadata(
      "https://x.com/dev/status/42",
      async () =>
        new Response(
          JSON.stringify({
            author_name: "Dev &amp; Ops",
            html: '<blockquote class="twitter-tweet"><p lang="zh">未闭合标签 <b>重点 &lt;script&gt; &amp;lt;escaped&amp;gt; &#99999999; &#x110000; <img src="x" onerror="alert(1)"',
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );

    expect(metadata.title).toBe("Dev & Ops (@dev) on X");
    expect(metadata.description).toContain(
      "未闭合标签 重点 <script> &lt;escaped&gt;",
    );
    expect(metadata.description).not.toContain("onerror");
  });

  it("gracefully falls back when X oEmbed answers 404 or times out and X serves an empty JS shell", async () => {
    const shellFallback = await fetchLinkMetadata(
      "https://x.com/alice/status/404000",
      async (input) => {
        const url = String(input);
        if (url.startsWith("https://publish.twitter.com/oembed")) {
          return new Response("Not Found", { status: 404 });
        }
        // Real X response to plain HTTP clients: empty JS shell with bare <title>X</title>.
        return new Response(
          "<!doctype html><html><head><title>X</title></head><body><div id='react-root'></div></body></html>",
          { headers: { "content-type": "text/html; charset=utf-8" } },
        );
      },
    );
    expect(shellFallback).toEqual({
      url: "https://x.com/alice/status/404000",
      title: "@alice on X",
      description: "",
      image: "",
    });

    // When both oEmbed (abort/timeout) and the direct X page (403) fail, it
    // still degrades cleanly instead of throwing a 500.
    const doubleFailureFallback = await fetchLinkMetadata(
      "https://x.com/bob/status/503000",
      async (input) => {
        const url = String(input);
        if (url.startsWith("https://publish.twitter.com/oembed")) {
          throw new DOMException("timed out", "AbortError");
        }
        return new Response("Forbidden", { status: 403 });
      },
    );
    expect(doubleFailureFallback).toEqual({
      url: "https://x.com/bob/status/503000",
      title: "@bob on X",
      description: "",
      image: "",
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

  it("rejects redirects that leave the public internet (including oEmbed redirects)", async () => {
    const requests: string[] = [];
    await expect(
      fetchLinkMetadata("https://example.com/redirect", async (input) => {
        requests.push(String(input));
        return new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data" },
        });
      }),
    ).rejects.toThrow("internal IP addresses are not allowed");
    expect(requests).toEqual(["https://example.com/redirect"]);

    await expect(
      fetchLinkMetadata("https://x.com/alice/status/99", async () => {
        return new Response(null, {
          status: 302,
          headers: { location: "https://127.0.0.1/internal" },
        });
      }),
    ).rejects.toThrow("internal IP addresses are not allowed");
  });

  it("caps the response body before parsing metadata", async () => {
    await expect(
      fetchLinkMetadata(
        "https://example.com/huge",
        async () =>
          new Response("x".repeat(513 * 1024), {
            headers: { "content-type": "text/html" },
          }),
      ),
    ).rejects.toThrow("HTML response is too large");
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
