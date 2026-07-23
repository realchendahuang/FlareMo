/*
 * FlareMo's service worker deliberately caches only the public application
 * shell and Vite's content-addressed build assets. API, attachment, share,
 * and Cloudflare Access traffic always stays on the network.
 */
const CACHE_PREFIX = "flaremo-pwa-v1";
const APP_SHELL_CACHE = `${CACHE_PREFIX}-shell`;
const STATIC_ASSET_CACHE = `${CACHE_PREFIX}-assets`;
const CACHE_NAMES = new Set([APP_SHELL_CACHE, STATIC_ASSET_CACHE]);
const scopeUrl = new URL(self.registration.scope);
const appShellRequest = new Request(scopeUrl.href);

self.addEventListener("install", (event) => {
  // Do not prefetch here: a Cloudflare Access login response must never become
  // an offline fallback. The shell is saved only after a verified app navigation.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((names) =>
          Promise.all(
            names
              .filter(
                (name) => name.startsWith("flaremo-pwa-") && !CACHE_NAMES.has(name),
              )
              .map((name) => caches.delete(name)),
          ),
        )
        .then(() => undefined),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isImmutableStaticAsset(url, request)) {
    event.respondWith(cacheFirstStaticAsset(request));
    return;
  }

  if (request.mode === "navigate" && isPrivateAppNavigation(url)) {
    event.respondWith(networkFirstAppNavigation(request));
  }
});

function isImmutableStaticAsset(url, request) {
  return (
    request.headers.get("range") === null &&
    url.pathname.startsWith(`${scopeUrl.pathname}assets/`) &&
    /-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(url.pathname)
  );
}

function isPrivateAppNavigation(url) {
  const scopePath = scopeUrl.pathname;
  return (
    url.pathname === scopePath ||
    url.pathname.startsWith(`${scopePath}memo/`)
  );
}

async function cacheFirstStaticAsset(request) {
  const cache = await caches.open(STATIC_ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (isCacheableStaticResponse(response)) {
    await cache.put(request, response.clone()).catch(() => undefined);
  }
  return response;
}

async function networkFirstAppNavigation(request) {
  const cache = await caches.open(APP_SHELL_CACHE);

  try {
    const response = await fetch(request);
    if (isCacheableAppShellResponse(response)) {
      await cache.put(appShellRequest, response.clone()).catch(() => undefined);
    }
    return response;
  } catch {
    return (await cache.match(appShellRequest)) ?? Response.error();
  }
}

function isCacheableStaticResponse(response) {
  return (
    response.ok &&
    !response.redirected &&
    response.type === "basic" &&
    !hasNoStoreDirective(response)
  );
}

function isCacheableAppShellResponse(response) {
  if (
    !response.ok ||
    response.redirected ||
    response.type !== "basic" ||
    hasNoStoreDirective(response)
  ) {
    return false;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return false;

  const responseUrl = new URL(response.url || scopeUrl.href);
  return (
    responseUrl.origin === scopeUrl.origin && isPrivateAppNavigation(responseUrl)
  );
}

function hasNoStoreDirective(response) {
  return /(?:^|,)\s*no-store\s*(?:,|$)/i.test(
    response.headers.get("cache-control") ?? "",
  );
}
