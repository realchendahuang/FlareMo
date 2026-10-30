import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

test("the PWA caches the Capture app shell and serves it offline", async () => {
  const handlers = new Map();
  const shell = {
    clone() {
      return this;
    },
    headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
    ok: true,
    redirected: false,
    type: "basic",
    url: "https://flaremo.test/memory",
    async text() {
      // The v2 shell cache only stores documents that carry the app marker,
      // so an access wall or error page can never masquerade as the shell.
      return "<!doctype html><body data-shell>flaremo-app-shell</body>";
    },
  };
  let cached;
  let putCount = 0;
  let matchCount = 0;
  const cache = {
    async match() {
      matchCount += 1;
      return cached;
    },
    async put(_request, response) {
      putCount += 1;
      cached = response;
    },
  };
  let fetchCount = 0;
  const fetch = async () => {
    fetchCount += 1;
    if (fetchCount === 1) return shell;
    throw new Error("offline");
  };
  const source = await readFile(
    new URL("../apps/web/public/sw.js", import.meta.url),
    "utf8",
  );

  runInNewContext(source, {
    Request,
    Response,
    Set,
    URL,
    caches: {
      async keys() {
        return [];
      },
      async open() {
        return cache;
      },
      // Offline private navigations look up the shell through the global
      // caches.match with an explicit cacheName.
      async match() {
        matchCount += 1;
        return cached;
      },
    },
    fetch,
    self: {
      addEventListener(type, handler) {
        handlers.set(type, handler);
      },
      clients: { claim() {} },
      location: { origin: "https://flaremo.test" },
      registration: { scope: "https://flaremo.test/" },
      skipWaiting() {},
    },
  });

  const navigate = () => {
    let response;
    handlers.get("fetch")?.({
      request: {
        method: "GET",
        mode: "navigate",
        url: "https://flaremo.test/memory",
        headers: new Headers(),
      },
      respondWith(value) {
        response = value;
      },
    });
    assert.ok(response);
    return response;
  };

  assert.equal(await navigate(), shell);
  assert.equal(putCount, 1);
  // The offline serve comes from the verified copy stored by cache.put.
  assert.equal(await navigate(), cached);
  assert.equal(matchCount, 1);
});

test("the asset cache drops the oldest entries on activate and skips non-asset types", async () => {
  const handlers = new Map();
  const source = await readFile(
    new URL("../apps/web/public/sw.js", import.meta.url),
    "utf8",
  );

  // Build a cache that behaves like the real one: `keys()` iterates in
  // insertion order and `delete()` removes by request.
  const entries = new Map();
  const keyOf = (request) =>
    typeof request === "string" ? request : request.url;
  const assetCache = {
    async keys() {
      return [...entries.keys()].map((url) => ({ url }));
    },
    async match(request) {
      return entries.get(keyOf(request));
    },
    async put(request, response) {
      entries.set(keyOf(request), response);
    },
    async delete(request) {
      return entries.delete(keyOf(request));
    },
  };

  const ok = (contentType) => ({
    ok: true,
    redirected: false,
    type: "basic",
    headers: new Headers({ "content-type": contentType }),
    clone() {
      return this;
    },
  });

  let fetched = ok("application/javascript");
  const fetch = async () => fetched;

  runInNewContext(source, {
    Request: class {
      constructor(url) {
        this.url = String(url);
        this.method = "GET";
        this.headers = new Headers();
        this.mode = "no-cors";
      }
    },
    Response: {
      error: () => ({ error: true }),
    },
    Headers,
    Set,
    URL,
    Date,
    Number,
    Promise,
    caches: {
      async keys() {
        return ["flaremo-pwa-v2-assets"];
      },
      async open() {
        return assetCache;
      },
      async match() {
        return undefined;
      },
      async delete() {
        return true;
      },
    },
    fetch,
    self: {
      addEventListener(type, handler) {
        handlers.set(type, handler);
      },
      clients: { claim() {} },
      location: { origin: "https://flaremo.test" },
      registration: { scope: "https://flaremo.test/" },
      skipWaiting() {},
    },
  });

  // Fill past the cap without running activate, then trigger it.
  const request = (name) => ({
    method: "GET",
    mode: "cors",
    url: `https://flaremo.test/assets/${name}-abcdefgh.js`,
    headers: new Headers(),
  });
  for (let index = 0; index <= 600; index += 1) {
    entries.set(
      `https://flaremo.test/assets/old${index}-abcdefgh.js`,
      ok("text/javascript"),
    );
  }

  let activated;
  handlers.get("activate")?.({
    waitUntil(promise) {
      activated = promise;
    },
  });
  assert.ok(activated);
  await activated;
  assert.equal(entries.size, 600);
  // The oldest entry is gone and the newest survived.
  assert.equal(
    entries.has("https://flaremo.test/assets/old0-abcdefgh.js"),
    false,
  );
  assert.equal(
    entries.has("https://flaremo.test/assets/old600-abcdefgh.js"),
    true,
  );

  // A 200 HTML body under /assets/ must not be stored.
  fetched = ok("text/html");
  const before = entries.size;
  await new Promise((resolve) => {
    handlers.get("fetch")?.({
      request: request("mislabeled"),
      respondWith(promise) {
        Promise.resolve(promise).then(resolve);
      },
    });
  });
  assert.equal(entries.size, before);
});
