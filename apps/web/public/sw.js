/*
 * FlareMo's service worker deliberately caches only the public application
 * shell, the local offline page, and Vite's content-addressed build assets.
 * API, attachment, share, and Cloudflare Access traffic always stays on the
 * network. Every cached HTML document is verified by a body marker so a login
 * or error page can never masquerade as the offline shell.
 */
const CACHE_PREFIX = "flaremo-pwa-v2";
const APP_SHELL_CACHE = `${CACHE_PREFIX}-shell`;
const STATIC_ASSET_CACHE = `${CACHE_PREFIX}-assets`;
const OFFLINE_CACHE = `${CACHE_PREFIX}-offline`;
const CACHE_NAMES = new Set([
  APP_SHELL_CACHE,
  STATIC_ASSET_CACHE,
  OFFLINE_CACHE,
]);

// Markers are emitted by the real documents (index.html, offline.html). Their
// absence proves the response is an access wall or an error page.
const APP_SHELL_MARKER = "flaremo-app-shell";
const OFFLINE_SHELL_MARKER = "flaremo-offline-shell";

const scopeUrl = new URL(self.registration.scope);
const appShellRequest = new Request(scopeUrl.href);
// Workers Assets canonicalize "/offline.html" to "/offline" with a redirect, so
// the worker fetches the extensionless path directly: a redirected response is
// rejected by the marker check and could never be cached.
const offlineUrl = new URL("offline", scopeUrl);

self.addEventListener("install", (event) => {
  // Never prefetch the app shell: a Cloudflare Access login response must not
  // become an offline fallback. Only the local offline page is precached, and
  // only once its body carries the offline marker. A waiting worker is kept
  // (no skipWaiting here) so an open tab can prompt before it reloads; browsers
  // still activate immediately on a first install with no controller.
  event.waitUntil(precacheOfflineShell());
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

// Update handshake: the page decides when to swap in a waiting worker so an
// in-flight edit is never interrupted by an unprompted reload.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
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

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
  }
});

async function precacheOfflineShell() {
  try {
    const response = await fetch(
      new Request(offlineUrl.href, { cache: "no-store" }),
    );
    const verified = await verifyHtmlMarker(response, OFFLINE_SHELL_MARKER);
    if (!verified) return;
    const cache = await caches.open(OFFLINE_CACHE);
    await cache.put(offlineUrl.href, verified);
  } catch {
    // Offline or blocked at install time; the page is cached on a later run.
  }
}

function isImmutableStaticAsset(url, request) {
  return (
    request.headers.get("range") === null &&
    url.pathname.startsWith(`${scopeUrl.pathname}assets/`) &&
    /-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(url.pathname)
  );
}

function isPrivateAppNavigation(url) {
  const scopePath = scopeUrl.pathname;
  const privateRoutes = [
    `${scopePath}account`,
    `${scopePath}calendar`,
    `${scopePath}forgot-password`,
    `${scopePath}login`,
    `${scopePath}memory`,
    `${scopePath}memo`,
    `${scopePath}projects`,
    `${scopePath}recover`,
    `${scopePath}register`,
    `${scopePath}reset`,
    `${scopePath}review`,
    `${scopePath}setup`,
    `${scopePath}verify-email`,
    `${scopePath}verify-email-change`,
  ];

  return (
    url.pathname === scopePath ||
    privateRoutes.some(
      (route) => url.pathname === route || url.pathname.startsWith(`${route}/`),
    )
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

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (isCacheableAppShellResponse(response)) {
      // Verify a clone: reading the body consumes the stream, and the live
      // response must still be returned to the page intact.
      const verified = await verifyHtmlMarker(
        response.clone(),
        APP_SHELL_MARKER,
      );
      if (verified) {
        const cache = await caches.open(APP_SHELL_CACHE);
        await cache.put(appShellRequest, verified).catch(() => undefined);
      }
    }
    return response;
  } catch {
    if (isPrivateAppNavigation(new URL(request.url))) {
      const shell = await caches.match(appShellRequest, {
        cacheName: APP_SHELL_CACHE,
      });
      if (shell) return shell;
    }
    return (
      (await caches.match(offlineUrl.href, { cacheName: OFFLINE_CACHE })) ??
      Response.error()
    );
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

/**
 * Reads an HTML response and returns an equivalent response only when its body
 * carries the expected marker. Returns null for redirected documents (an access
 * wall), non-HTML bodies, or mismatched content, so nothing unverified is ever
 * stored as an offline document. Callers that still need the original must pass
 * a clone, because reading the body consumes the stream.
 */
async function verifyHtmlMarker(response, marker) {
  if (
    !response.ok ||
    response.redirected ||
    response.type !== "basic" ||
    hasNoStoreDirective(response)
  ) {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return null;

  const text = await response.text();
  if (!text.includes(marker)) return null;

  return new Response(text, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function hasNoStoreDirective(response) {
  return /(?:^|,)\s*no-store\s*(?:,|$)/i.test(
    response.headers.get("cache-control") ?? "",
  );
}
