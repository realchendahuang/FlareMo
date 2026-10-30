import { readFileSync } from "node:fs";
import {
  applyFlaremoMigrations,
  attachments,
  createDb,
  memos,
  shares,
  users,
} from "@flaremo/db";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// Parity check against the web app's attachment-ref helpers (no imports, so
// the module loads directly).
import {
  extractReferencedAttachmentIds as webExtractRefs,
  injectShareTokenIntoFileUrls as webInjectShareToken,
} from "../../web/src/lib/attachment-refs";
import app, { createFlareMoApp } from "./index";
import {
  extractReferencedAttachmentIds as workerExtractRefs,
  injectShareTokenIntoFileUrls as workerInjectShareToken,
} from "./routes/share-page";
import {
  SPA_EXACT_ROUTES,
  SPA_PREFIX_ROUTES,
  WORKER_OWNED_PREFIXES,
} from "./spa-routes";

let mf: Miniflare;
let env: Env;

const TOKEN = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

async function seedShare(
  options: { revoked?: boolean; expired?: boolean } = {},
) {
  const db = createDb(env.DB);
  const now = "2026-09-01T00:00:00.000Z";
  const userId = "users/e2e-share-owner";
  await db.insert(users).values({
    id: userId,
    email: "owner@example.com",
    name: "Owner",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(memos).values({
    id: "memos/e2e-share-memo",
    userId,
    content:
      "# 今日笔记\n\n这是**分享**的正文内容，用于 SEO 验证。\n\n<em>原生HTML被丢弃</em>\n\n[危险链接](javascript:alert(1))\n\n![配图](/file/attachments/e2e-share-image/photo.png)",
    visibility: "private",
    status: "normal",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(attachments).values({
    id: "attachments/e2e-share-image",
    userId,
    memoId: "memos/e2e-share-memo",
    r2Key: "attachments/e2e-share-image",
    filename: "photo.png",
    contentType: "image/png",
    size: 100,
    state: "ready",
    etag: "e2e",
    payload: { width: 640, height: 480 },
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(shares).values({
    id: "shares/e2e-share",
    memoId: "memos/e2e-share-memo",
    userId,
    token: TOKEN,
    expiresAt: options.expired ? "2026-08-01T00:00:00.000Z" : null,
    createdAt: now,
    updatedAt: now,
    revokedAt: options.revoked ? now : null,
  });
}

function shareRequest(url = `https://flaremo.example/share/${TOKEN}`) {
  return app.fetch(new Request(url), env);
}

describe("Share page (standalone SEO HTML)", () => {
  beforeEach(async () => {
    mf = new Miniflare({
      script: "export default { fetch() { return new Response('ok') } }",
      modules: true,
      compatibilityDate: "2026-07-10",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: { DB: "flaremo-share-test" },
      r2Buckets: { ATTACHMENTS: "flaremo-attachments-share-test" },
    });

    const db = await mf.getD1Database("DB");
    const r2 = await mf.getR2Bucket("ATTACHMENTS");
    env = {
      DB: db,
      ATTACHMENTS: r2,
      ASSETS: {
        fetch: async () =>
          new Response("<!doctype html><title>FlareMo</title>", {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
      } as Fetcher,
      FLAREMO_PUBLIC_URL: "https://flaremo.example",
      BETTER_AUTH_SECRET: "test-better-auth-secret-that-is-never-used-in-prod",
      FLAREMO_BOOTSTRAP_SECRET: "test-bootstrap-secret-never-used",
    } as Env;

    await applyFlaremoMigrations(db);
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("serves a zero-JS standalone document with complete SEO meta", async () => {
    await seedShare();
    const response = await shareRequest();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toContain("max-age=60");

    const html = await response.text();
    // P0-1 canonical
    expect(html).toContain(
      '<link rel="canonical" href="https://flaremo.example/share/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" />',
    );
    expect(html).toContain(
      "<title>今日笔记 这是分享的正文内容，用于 SEO 验证。 原生HTML被丢弃 危险链接)</title>",
    );
    expect(html).toContain('content="index, follow"');
    expect(html).toContain('<meta property="og:locale" content="zh_CN" />');
    expect(html).toContain('<meta property="og:type" content="article" />');
    // P1-B: standalone page, no SPA bundle, no injected-then-cleared shell
    expect(html).toContain("data-flaremo-share-article");
    expect(html).not.toContain('<div id="root">');
    expect(html).not.toContain("/assets/");
    expect(
      html.match(/<script(?! type="application\/ld\+json")/g) ?? [],
    ).toHaveLength(0);
  });

  it("renders markdown server-side like the web app, sanitized", async () => {
    await seedShare();
    const html = await shareRequest().then((r) => r.text());
    // GFM rendering with real elements, no literal markdown noise
    expect(html).toContain("<h1>今日笔记</h1>");
    expect(html).toContain("<strong>分享</strong>");
    // Raw HTML is dropped (react-markdown parity), dangerous scheme neutralized
    expect(html).not.toContain("<em>原生HTML被丢弃</em>");
    expect(html).not.toContain("javascript:");
    // Body image resolved anonymously with intrinsic dimensions from payload
    expect(html).toContain(
      `<img src="/file/attachments/e2e-share-image/photo.png?share_token=${TOKEN}"`,
    );
    expect(html).toContain('width="640" height="480"');
  });

  it("declares og:image with dimensions, alt, and JSON-LD", async () => {
    await seedShare();
    const html = await shareRequest().then((r) => r.text());
    expect(html).toContain(
      '<meta property="og:image" content="https://flaremo.example/api/public/shares/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/attachments/e2e-share-image/blob?preview=1" />',
    );
    expect(html).toContain('<meta property="og:image:width" content="640" />');
    expect(html).toContain('<meta property="og:image:height" content="480" />');
    expect(html).toContain(
      '<meta property="og:image:alt" content="photo.png" />',
    );
    expect(html).toContain(
      '<meta name="twitter:card" content="summary_large_image" />',
    );
    expect(html).toContain('"@type":"BlogPosting"');
    expect(html).toContain('"author":{"@type":"Person","name":"Owner"}');
    expect(html).toContain('"datePublished":"2026-09-01T00:00:00.000Z"');
  });

  it("returns 404 + noindex for revoked or expired shares", async () => {
    await seedShare({ revoked: true });
    const response = await shareRequest();
    expect(response.status).toBe(404);
    const html = await response.text();
    expect(html).toContain('content="noindex, nofollow"');
    expect(html).not.toContain("data-flaremo-share-article");
  });

  it("sitemap.xml is a sitemapindex pointing at the article sitemap", async () => {
    const response = await app.fetch(
      new Request("https://flaremo.example/sitemap.xml"),
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/xml");
    const xml = await response.text();
    expect(xml).toContain("https://flaremo.example/sitemap-articles.xml</loc>");
    expect(xml).not.toContain("/share/");
  });

  it("registers the route on any createFlareMoApp instance", async () => {
    await seedShare();
    const isolated = createFlareMoApp();
    const response = await isolated.fetch(
      new Request(`https://flaremo.example/share/${TOKEN}`),
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("data-flaremo-share-article");
  });
});

describe("Unknown-path status semantics (P0-5)", () => {
  beforeEach(async () => {
    mf = new Miniflare({
      script: "export default { fetch() { return new Response('ok') } }",
      modules: true,
      compatibilityDate: "2026-07-10",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: { DB: "flaremo-spa-routes-test" },
    });
    const db = await mf.getD1Database("DB");
    env = {
      DB: db,
      ASSETS: {
        fetch: async () =>
          new Response("<!doctype html><title>FlareMo</title>", {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
      } as Fetcher,
    } as Env;
    await applyFlaremoMigrations(db);
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("serves 200 for known frontend routes and 404 for unknown paths", async () => {
    const known = await app.fetch(
      new Request("https://flaremo.example/login"),
      env,
    );
    expect(known.status).toBe(200);

    const unknown = await app.fetch(
      new Request("https://flaremo.example/no-such-page"),
      env,
    );
    expect(unknown.status).toBe(404);
    // The shell still renders so the SPA shows its not-found UI.
    expect(await unknown.text()).toContain("<title>FlareMo</title>");

    const trailingSlash = await app.fetch(
      new Request("https://flaremo.example/login/"),
      env,
    );
    expect(trailingSlash.status).toBe(200);
  });

  it('serves the shell itself under not_found_handling "none"', async () => {
    // The production binding answers 404 for any path that is not a file;
    // only "/" maps to index.html.
    const noneEnv = {
      ...env,
      ASSETS: {
        fetch: async (input: RequestInfo | URL) => {
          const url = new URL(input instanceof Request ? input.url : input);
          if (url.pathname === "/") {
            return new Response("<!doctype html><title>FlareMo</title>", {
              status: 200,
              headers: { "content-type": "text/html; charset=utf-8" },
            });
          }
          return new Response(null, { status: 404 });
        },
      } as Fetcher,
    } as Env;
    const known = await app.fetch(
      new Request("https://flaremo.example/memo/abc", {
        headers: { "if-none-match": '"stale"' },
      }),
      noneEnv,
    );
    expect(known.status).toBe(200);
    expect(await known.text()).toContain("<title>FlareMo</title>");

    const unknown = await app.fetch(
      new Request("https://flaremo.example/no-such-page"),
      noneEnv,
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toContain("<title>FlareMo</title>");

    // A missing file stays a bare 404, never an HTML shell.
    const missingAsset = await app.fetch(
      new Request("https://flaremo.example/assets/missing-abcdef12.js"),
      noneEnv,
    );
    expect(missingAsset.status).toBe(404);
    expect(await missingAsset.text()).toBe("");
  });

  it("stays in sync with the web router table", () => {
    const routerSource = readFileSync(
      new URL("../../web/src/router-tree.tsx", import.meta.url),
      "utf8",
    );
    const paths = [...routerSource.matchAll(/path:\s*"([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(paths.length).toBeGreaterThan(10);
    for (const path of paths) {
      const concrete = path.replace(/\$\w+/g, "x");
      if (concrete.startsWith("/share/")) {
        // Worker-owned: never served as SPA shell.
        expect(WORKER_OWNED_PREFIXES).toContain("/share/");
        continue;
      }
      const known =
        SPA_EXACT_ROUTES.has(concrete) ||
        SPA_PREFIX_ROUTES.some((prefix) => concrete.startsWith(prefix));
      expect({ path, known }).toEqual({ path, known: true });
    }
  });
});

describe("Attachment-ref helper parity (worker ↔ web)", () => {
  it("extracts and rewrites the same references", () => {
    const content = [
      "![a](/file/attachments/abc123/photo.png)",
      "",
      "```",
      "![kept-raw](/file/attachments/fence99/x.png)",
      "```",
      "[l](/file/attachments/def456/report.pdf?download=1)",
    ].join("\n");
    expect(workerInjectShareToken(content, "tok1")).toBe(
      webInjectShareToken(content, "tok1"),
    );
    expect([...workerExtractRefs(content)].sort()).toEqual(
      [...webExtractRefs(content)].sort(),
    );
  });
});
