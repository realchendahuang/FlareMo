import type { Context, Hono } from "hono";
import type { HonoBindings } from "./context";

/**
 * Lazy route mounts (issue #138: Workers free-plan CPU budget).
 *
 * The public SSR pages (share/article + sitemap/feed), the MCP surfaces, and
 * the capture/voice (ASR) API used to be statically imported by the worker
 * entry: every isolate paid their module parse cost on every request even
 * when these routes were never hit. They are low-traffic relative to the API
 * hot path, so this module registers small proxy handlers that import the
 * real route tree on first hit and cache it for the isolate's lifetime.
 * Hot-path trees (auth, memos CRUD, memory API) stay static — laziness there
 * would only move the cost around.
 *
 * The proxies forward with the full original path (the sub-app re-registers
 * its own absolute paths), so response semantics, precedence, and status
 * codes are identical to the static-mount layout.
 */

type AnyHono = Hono<HonoBindings>;
type LazyContext = Context<HonoBindings>;

const loaded = new Map<string, Promise<AnyHono>>();

function onceSubApp(
  key: string,
  load: () => Promise<AnyHono>,
): Promise<AnyHono> {
  let cached = loaded.get(key);
  if (!cached) {
    cached = load().catch((error) => {
      // A failed import must not poison the cache: the next request retries.
      loaded.delete(key);
      throw error;
    });
    loaded.set(key, cached);
  }
  return cached;
}

/** Forward a request through the lazily built inner Hono app, path re-based. */
async function forward(
  inner: Promise<AnyHono>,
  c: LazyContext,
  path: string,
): Promise<Response> {
  const app = await inner;
  // The sub-app registers routes relative to its mount prefix (the contract
  // `app.route(path, subApp)` provides), so strip the prefix before handing
  // the request over; a request for exactly `path` becomes "/".
  const url = new URL(c.req.url);
  url.pathname = url.pathname.slice(path.length) || "/";
  // Test harnesses call app.fetch without an ExecutionContext; c.executionCtx
  // throws when absent, so pass undefined through in that case — the same
  // contract the direct handler-call tests already rely on.
  let ctx: unknown;
  try {
    ctx = c.executionCtx;
  } catch {
    ctx = undefined;
  }
  return app.fetch(new Request(url, c.req.raw), c.env, ctx as never);
}

/**
 * Mount every method of a lazily imported Hono sub-app under `path`. The
 * outer proxy passes the request through untouched; the sub-app decides 404.
 * All HTTP verbs are proxied (`app.all`) so an unregistered method surfaces
 * the same 404/405 the static mount produced.
 */
export function mountLazyRoute(
  app: Hono<HonoBindings>,
  path: string,
  loadSubApp: () => Promise<AnyHono>,
): void {
  app.all(`${path}/*`, (c) => forward(onceSubApp(path, loadSubApp), c, path));
  app.all(path, (c) => forward(onceSubApp(path, loadSubApp), c, path));
}

/**
 * Register the SSR public pages lazily. The pages modules expose
 * `registerXxx(app)` functions instead of Hono instances, so the loader
 * builds a private Hono, runs the register functions against it, and the
 * outer GET proxies forward the five public page paths with the original
 * absolute path preserved (the pages register absolute routes). `app.all`
 * (not `app.get`) keeps HEAD/OPTIONS behaving exactly like the static mount.
 */
export function mountLazySsrPages(app: Hono<HonoBindings>): void {
  const loadPages = async (): Promise<AnyHono> => {
    const [{ registerArticlePage }, { registerSharePage }, { Hono }] =
      await Promise.all([
        import("./routes/article-page"),
        import("./routes/share-page"),
        import("hono"),
      ]);
    const inner = new Hono<HonoBindings>();
    registerSharePage(inner);
    registerArticlePage(inner);
    return inner;
  };
  const pages = loadPages();
  for (const path of [
    "/sitemap.xml",
    "/sitemap-articles.xml",
    "/feed.xml",
    "/share/:token",
    "/article/:slug",
  ]) {
    // Forward the untouched raw request: the inner app registers the same
    // absolute paths, so no re-basing applies here.
    app.all(path, (c) => {
      return pages.then((p) => {
        let ctx: unknown;
        try {
          ctx = c.executionCtx;
        } catch {
          ctx = undefined;
        }
        return p.fetch(c.req.raw, c.env, ctx as never);
      });
    });
  }
}