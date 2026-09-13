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
    url: "https://flaremo.test/capture",
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
        url: "https://flaremo.test/capture",
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
  assert.equal(await navigate(), shell);
  assert.equal(matchCount, 1);
});
