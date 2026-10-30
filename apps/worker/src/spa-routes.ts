/**
 * SPA route whitelist for HTTP status semantics (docs/
 * seo-share-pages-best-practices.md P0-5).
 *
 * The worker's `notFound` handler is the SPA fallback: it serves the web app
 * shell for every non-API path. Serving 200 for *unknown* paths turns every
 * typo and dead link into a soft-404 for crawlers. This whitelist mirrors the
 * TanStack Router table in apps/web/src/router-tree.tsx: known frontend
 * routes keep the 200 shell, everything else returns 404 (with the same
 * shell, so the SPA still renders its not-found UI).
 *
 * `apps/worker/src/share-page.test.ts` asserts parity with the web route
 * table so the two cannot drift silently.
 */

/** Exact frontend paths (200 shell). */
export const SPA_EXACT_ROUTES: ReadonlySet<string> = new Set([
  "/",
  "/login",
  "/register",
  "/verify-email",
  "/forgot-password",
  "/verify-email-change",
  "/reset",
  "/recover",
  "/setup",
  "/account",
  "/memory",
  "/projects",
  "/articles",
  "/review/daily",
  "/review/walk",
]);

/** Frontend path prefixes with dynamic segments (200 shell). */
export const SPA_PREFIX_ROUTES: readonly string[] = [
  "/memo/",
  // Article editor deep links; the public /article/:slug face is
  // worker-owned SSR and lives outside this table.
  "/articles/",
];

/** Worker-owned paths that never reach the SPA shell. */
export const WORKER_OWNED_PREFIXES: readonly string[] = ["/share/"];

export function isKnownFrontendPath(pathname: string): boolean {
  // Normalize a trailing slash ("/login/" → "/login"); the root stays "/".
  const normalized =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
  if (SPA_EXACT_ROUTES.has(normalized)) return true;
  return SPA_PREFIX_ROUTES.some((prefix) => normalized.startsWith(prefix));
}
