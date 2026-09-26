// node:fs is type-available under the app tsconfig and runs only in vitest's
// node runtime; this contract test reads sibling config files.
import { existsSync, readFileSync } from "node:fs";
import { parse as parseJsonc } from "jsonc-parser";
import { describe, expect, it } from "vitest";

// `wrangler.jsonc` is gitignored (each deployment writes its own); fresh
// checkouts and CI only have the committed `wrangler.jsonc.example`.
const localWranglerConfig = new URL("../../../wrangler.jsonc", import.meta.url);
const wranglerConfig = parseJsonc(
  readFileSync(
    existsSync(localWranglerConfig)
      ? localWranglerConfig
      : new URL("../../../wrangler.jsonc.example", import.meta.url),
    "utf8",
  ),
) as { assets?: { run_worker_first?: string[] } };

const viteConfigSource = readFileSync(
  new URL("../vite.config.ts", import.meta.url),
  "utf8",
);

/**
 * `pnpm dev:hot` serves the SPA from Vite and proxies the Worker-owned paths to
 * `wrangler dev`. Those paths are the same set as the Worker's
 * `assets.run_worker_first`: in production a path missing from that list is
 * answered by the SPA shell, and in the hot dev loop a path missing from the
 * proxy list would be answered by Vite's index.html the same way. That is how
 * `/share/:token` SSR silently disappeared once before, so both lists get
 * pinned to each other here.
 */

/** Proxy keys, in declaration order: one entry per line, mapped to WORKER_PROXY. */
function proxyPaths(source: string): string[] {
  const block = source.match(/\n {4}proxy: \{([\s\S]*?)\n {4}\},/);
  if (!block) throw new Error("vite.config.ts: server.proxy block not found");
  return [...block[1].matchAll(/\n\s+"(\/[^"]*)":\s*WORKER_PROXY,/g)].map(
    (match) => match[1],
  );
}

describe("dev:hot worker proxy", () => {
  it("proxies every path the Worker owns", () => {
    const workerFirst = wranglerConfig.assets?.run_worker_first ?? [];
    expect(workerFirst.length).toBeGreaterThan(0);
    // Cloudflare's entries are globs ("/share/*"), Vite's keys are prefixes,
    // so dropping the trailing "*" is what makes the two lists comparable.
    // The separator stays: "/share/…" is proxied, the SPA's own "/share" path
    // is not.
    const expected = workerFirst.map((path) => path.replace(/\*$/, ""));
    expect(proxyPaths(viteConfigSource).sort()).toEqual([...expected].sort());
  });

  it("does not shadow frontend routes that share a prefix", () => {
    // "/article/…" is SSR while "/articles" is the SPA; "/memory/…" is the MCP
    // endpoint while "/memory" is the SPA. A proxy key without the separator
    // would serve both from the build the dev server is meant to replace.
    const paths = proxyPaths(viteConfigSource);
    const spaPaths = ["/articles", "/memory", "/memo/x", "/projects"];
    for (const spaPath of spaPaths) {
      expect(paths.some((path) => spaPath.startsWith(path))).toBe(false);
    }
  });

  it("keeps the dev ports overridable in one place", () => {
    // The launcher injects the same two origins as Better Auth's public URL and
    // trusted origins; a hard-coded port here would 403 every write in dev.
    for (const name of ["FLAREMO_DEV_WEB_PORT", "FLAREMO_DEV_WORKER_PORT"]) {
      expect(viteConfigSource).toContain(name);
    }
  });
});
