import { Hono } from "hono";
import { getFlareMoDb, type HonoBindings } from "../context";
import { jsonError } from "../http";
import { getPluginSettingsCached } from "../settings-cache";

/**
 * Public plugin configuration. The SPA reads this before rendering plugin
 * contributions (share-card templates today): which plugins the instance
 * enabled or disabled, the card order/hidden/default/options overrides, and
 * the installed store packages (manifest snapshots — their assets are served
 * by the `/assets` routes below). Anonymous and read-only: the server carries
 * shape, the frontend holds the bundled registry, and the two intersect at
 * render time.
 *
 * Asset responses carry `Content-Security-Policy: sandbox` so that even a
 * direct navigation to a plugin file runs it in an opaque origin — the app
 * domain can never execute plugin content outside the iframe sandbox.
 */
export const pluginsApi = new Hono<HonoBindings>();

const ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  woff2: "font/woff2",
  woff: "font/woff",
  txt: "text/plain; charset=utf-8",
};

function contentTypeFor(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}

pluginsApi.get("/", async (c) => {
  try {
    const db = getFlareMoDb(c.env);
    const settings = await getPluginSettingsCached(db);
    return c.json(settings);
  } catch (error) {
    return jsonError(c, error);
  }
});

// `GET /api/app/plugins/assets/<id>/<version>/<file…>` — installed plugin
// files straight from R2. The version segment makes every URL immutable.
pluginsApi.get("/assets/:id/:version/*", async (c) => {
  try {
    const id = c.req.param("id");
    const version = c.req.param("version");
    if (
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) ||
      !/^[A-Za-z0-9._-]{1,64}$/.test(version)
    ) {
      return c.json({ error: { message: "Not found" } }, 404);
    }
    const prefix = `/api/app/plugins/assets/${id}/${version}/`;
    const path = c.req.path.startsWith(prefix)
      ? c.req.path.slice(prefix.length)
      : "";
    if (
      !path ||
      path.includes("..") ||
      path.startsWith("/") ||
      path.includes("\0")
    ) {
      return c.json({ error: { message: "Not found" } }, 404);
    }
    const db = getFlareMoDb(c.env);
    const settings = await getPluginSettingsCached(db);
    const installed = settings.installed.some(
      (record) => record.id === id && record.version === version,
    );
    if (!installed) {
      return c.json({ error: { message: "Not found" } }, 404);
    }
    const object = await c.env.ATTACHMENTS.get(
      `plugins/${id}/${version}/${path}`,
    );
    if (!object) {
      return c.json({ error: { message: "Not found" } }, 404);
    }
    const contentType = contentTypeFor(path);
    const headers = new Headers({
      "content-type": contentType,
      "cache-control": ASSET_CACHE_CONTROL,
      "x-content-type-options": "nosniff",
    });
    // Plugin assets are untrusted code: force an opaque origin whenever a
    // browser navigates to them directly. SVG is a document too — scripts
    // inside it would otherwise run on the app origin — so it gets the same
    // treatment plus a download disposition. `<img src>` still renders it.
    if (contentType.startsWith("text/html")) {
      headers.set("content-security-policy", "sandbox; default-src 'none'");
    }
    if (contentType === "image/svg+xml") {
      headers.set("content-security-policy", "sandbox; default-src 'none'");
      headers.set("content-disposition", "attachment");
    }
    return new Response(object.body, { headers });
  } catch (error) {
    return jsonError(c, error);
  }
});
