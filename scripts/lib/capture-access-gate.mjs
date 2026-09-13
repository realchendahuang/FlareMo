import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { request as createHttpRequest, createServer } from "node:http";
import { connect } from "node:net";

const ACCESS_PATH = "/__capture_access";
export const CAPTURE_GATE_HEALTH_PATH = "/__capture_health";
export const CAPTURE_GATE_HEALTH_VALUE = "ready";
const COOKIE_NAME = "__Host-flaremo_capture_gate";
const MAX_BODY_BYTES = 4_096;
const MAX_ATTEMPTS_PER_MINUTE = 8;
const MAX_SESSIONS = 64;
const SESSION_TTL_MS = 4 * 60 * 60 * 1_000;

export async function startCaptureAccessGate({
  accessKey,
  host = "127.0.0.1",
  notice = "",
  port = 0,
  upstreamHost = "127.0.0.1",
  upstreamPort,
} = {}) {
  assertPort(upstreamPort, "upstream");
  if (port !== 0) assertPort(port, "gate");

  let currentKey = accessKey ?? generateAccessKey();
  let revoked = false;
  let verificationEnabled = true;
  const sessions = new Map();
  const attempts = new Map();
  const clientSockets = new Set();
  const upstreamSockets = new Set();

  const server = createServer((request, response) => {
    void handleRequest(request, response).catch(() => {
      if (!response.headersSent)
        sendText(response, 500, "Temporary access gate failed.");
      else response.destroy();
    });
  });

  server.on("connection", (socket) => {
    clientSockets.add(socket);
    socket.once("close", () => clientSockets.delete(socket));
  });

  server.on("upgrade", (request, socket, head) => {
    if (verificationEnabled && (revoked || !hasValidSession(request))) {
      socket.end(
        "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
      return;
    }

    const upstream = connect(upstreamPort, upstreamHost);
    upstreamSockets.add(upstream);
    upstream.once("close", () => upstreamSockets.delete(upstream));
    socket.pause();
    upstream.once("connect", () => {
      const headers = stripGateCookie(request.headers);
      upstream.write(
        serializeRequestHead(
          request.method ?? "GET",
          request.url ?? "/",
          request.httpVersion,
          headers,
        ),
      );
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
      socket.resume();
    });
    upstream.once("error", () => {
      if (!socket.destroyed)
        socket.end(
          "HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
        );
    });
    socket.once("error", () => upstream.destroy());
  });

  async function handleRequest(request, response) {
    const url = new URL(request.url ?? "/", "http://capture-gate.local");
    if (url.pathname === CAPTURE_GATE_HEALTH_PATH) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendText(response, 405, "Method not allowed.", {
          Allow: "GET, HEAD",
        });
        return;
      }
      response.writeHead(
        204,
        secureHeaders({
          "X-FlareMo-Capture-Gate": CAPTURE_GATE_HEALTH_VALUE,
        }),
      );
      response.end();
      return;
    }
    if (url.pathname === ACCESS_PATH) {
      if (!verificationEnabled) {
        response.writeHead(
          303,
          secureHeaders({ Location: safeNext(url.searchParams.get("next")) }),
        );
        response.end();
        return;
      }
      if (request.method === "POST") {
        await handleAccessAttempt(request, response);
        return;
      }
      if (request.method === "GET" || request.method === "HEAD") {
        sendAccessPage(response, {
          method: request.method,
          next: safeNext(url.searchParams.get("next")),
          notice,
          revoked,
          status: revoked ? 503 : 200,
        });
        return;
      }
      sendText(response, 405, "Method not allowed.", {
        Allow: "GET, HEAD, POST",
      });
      return;
    }

    if (verificationEnabled && (revoked || !hasValidSession(request))) {
      if (request.method === "GET" || request.method === "HEAD") {
        response.writeHead(
          303,
          secureHeaders({
            Location: `${ACCESS_PATH}?next=${encodeURIComponent(safeNext(request.url))}`,
          }),
        );
        response.end();
      } else {
        sendText(response, 401, "Temporary access key required.");
      }
      return;
    }

    proxyHttp(request, response, {
      upstreamHost,
      upstreamPort,
    });
  }

  async function handleAccessAttempt(request, response) {
    if (revoked || !currentKey) {
      sendAccessPage(response, { notice, revoked: true, status: 503 });
      return;
    }

    const identifier = requestIdentifier(request);
    if (!allowAttempt(attempts, identifier)) {
      sendAccessPage(response, {
        error: "尝试次数过多，请一分钟后重试。",
        notice,
        status: 429,
      });
      return;
    }

    let body;
    try {
      body = await readBody(request, MAX_BODY_BYTES);
    } catch {
      sendText(response, 413, "Access request is too large.");
      return;
    }
    const form = new URLSearchParams(body);
    const suppliedKey = form.get("access_key")?.trim() ?? "";
    const next = safeNext(form.get("next"));
    if (!constantTimeEqual(suppliedKey, currentKey)) {
      sendAccessPage(response, {
        error: "访问 Key 不正确。",
        next,
        notice,
        status: 401,
      });
      return;
    }

    attempts.delete(identifier);
    pruneSessions(sessions);
    if (sessions.size >= MAX_SESSIONS)
      sessions.delete(sessions.keys().next().value);
    const sessionToken = randomBytes(32).toString("base64url");
    sessions.set(hashToken(sessionToken), Date.now() + SESSION_TTL_MS);
    response.writeHead(
      303,
      secureHeaders({
        Location: next,
        "Set-Cookie": `${COOKIE_NAME}=${sessionToken}; Path=/; Max-Age=${Math.floor(
          SESSION_TTL_MS / 1_000,
        )}; HttpOnly; Secure; SameSite=Strict`,
      }),
    );
    response.end();
  }

  function hasValidSession(request) {
    pruneSessions(sessions);
    const token = readCookie(request.headers.cookie, COOKIE_NAME);
    if (!token) return false;
    const digest = hashToken(token);
    const expiresAt = sessions.get(digest);
    if (!expiresAt || expiresAt <= Date.now()) {
      sessions.delete(digest);
      return false;
    }
    return true;
  }

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, host, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Capture access gate did not bind a TCP port.");

  return {
    host,
    port: address.port,
    url: `http://${host}:${address.port}`,
    accessPath: ACCESS_PATH,
    accessKey: () => currentKey,
    rotate() {
      sessions.clear();
      attempts.clear();
      currentKey = generateAccessKey();
      revoked = false;
      verificationEnabled = true;
      return currentKey;
    },
    disableVerification() {
      sessions.clear();
      attempts.clear();
      currentKey = null;
      revoked = false;
      verificationEnabled = false;
    },
    revoke() {
      sessions.clear();
      attempts.clear();
      currentKey = null;
      revoked = true;
      verificationEnabled = true;
    },
    async close() {
      sessions.clear();
      attempts.clear();
      currentKey = null;
      revoked = true;
      verificationEnabled = true;
      for (const socket of clientSockets) socket.destroy();
      for (const socket of upstreamSockets) socket.destroy();
      await new Promise((resolveClose) => server.close(resolveClose));
    },
  };
}

export function generateAccessKey() {
  const value = randomBytes(18).toString("base64url");
  return `FC-${value.slice(0, 6)}-${value.slice(6, 12)}-${value.slice(12, 18)}-${value.slice(18)}`;
}

function proxyHttp(request, response, { upstreamHost, upstreamPort }) {
  const proxied = createHttpRequest(
    {
      headers: stripGateCookie(request.headers),
      host: upstreamHost,
      method: request.method,
      path: request.url,
      port: upstreamPort,
    },
    (upstreamResponse) => {
      const statusCode = upstreamResponse.statusCode ?? 502;
      if (upstreamResponse.statusMessage) {
        response.writeHead(
          statusCode,
          upstreamResponse.statusMessage,
          upstreamResponse.headers,
        );
      } else response.writeHead(statusCode, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );
  proxied.once("error", () => {
    if (!response.headersSent) sendText(response, 502, "FlareMo is starting.");
    else response.destroy();
  });
  request.once("aborted", () => proxied.destroy());
  request.pipe(proxied);
}

function stripGateCookie(headers) {
  const next = { ...headers };
  const cookie = String(headers.cookie ?? "")
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => !value.startsWith(`${COOKIE_NAME}=`))
    .join("; ");
  if (cookie) next.cookie = cookie;
  else delete next.cookie;
  return next;
}

function serializeRequestHead(method, path, version, headers) {
  const lines = [`${method} ${path} HTTP/${version}`];
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) lines.push(`${name}: ${item}`);
    } else if (value !== undefined) lines.push(`${name}: ${value}`);
  }
  return `${lines.join("\r\n")}\r\n\r\n`;
}

function sendAccessPage(
  response,
  {
    error = "",
    method = "GET",
    next = "/capture",
    notice = "",
    revoked = false,
    status = 200,
  } = {},
) {
  const title = revoked ? "临时访问已撤销" : "访问 FlareMo";
  const content = revoked
    ? "当前公用 Key 已撤销。请等待控制台生成新的 Key。"
    : `${notice ? `<p class="notice">${escapeHtml(notice)}</p>` : ""}<form method="post" action="${ACCESS_PATH}">
        <input type="hidden" name="next" value="${escapeHtml(next)}">
        <label for="access-key">临时访问 Key</label>
        <input id="access-key" name="access_key" type="password" autocomplete="one-time-code" autofocus required>
        <button type="submit">继续</button>
      </form>`;
  const body = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:#0f0e0d;color:#f7f3ef;font:16px/1.5 system-ui,sans-serif}main{width:min(100%,420px)}h1{font-size:28px;margin:0 0 10px}p{color:#aaa29a;margin:0 0 22px}.error{color:#ff9387}.notice{padding:12px;border-left:3px solid #ff7a45;background:#1b1917;color:#d8d0c9}form{display:grid;gap:12px}label{font-size:14px;font-weight:600}input,button{width:100%;min-height:48px;border-radius:8px;font:inherit}input{border:1px solid #49433f;background:#1b1917;color:#fff;padding:10px 12px}button{border:0;background:#ff5a36;color:#fff;font-weight:700;cursor:pointer}button:focus-visible,input:focus-visible{outline:3px solid #ff9a81;outline-offset:2px}
  </style>
</head>
<body><main><h1>${title}</h1><p${error ? ' class="error"' : ""}>${escapeHtml(
    error || (revoked ? content : "请输入启动控制台显示的临时 Key。"),
  )}</p>${revoked ? "" : content}</main></body>
</html>`;
  response.writeHead(
    status,
    secureHeaders({
      "Content-Length": Buffer.byteLength(body),
      "Content-Type": "text/html; charset=utf-8",
    }),
  );
  response.end(method === "HEAD" ? undefined : body);
}

function sendText(response, status, message, headers = {}) {
  response.writeHead(
    status,
    secureHeaders({
      ...headers,
      "Content-Length": Buffer.byteLength(message),
      "Content-Type": "text/plain; charset=utf-8",
    }),
  );
  response.end(message);
}

function secureHeaders(headers = {}) {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    ...headers,
  };
}

function safeNext(value) {
  if (!value?.startsWith("/") || value.startsWith("//") || value.length > 2_048)
    return "/capture";
  return value;
}

function readBody(request, limit) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on("data", (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        rejectBody(new Error("Body too large"));
        return;
      }
      chunks.push(chunk);
    });
    request.once("end", () => {
      if (!tooLarge) resolveBody(Buffer.concat(chunks).toString("utf8"));
    });
    request.once("error", rejectBody);
  });
}

function requestIdentifier(request) {
  const cloudflareIp = request.headers["cf-connecting-ip"];
  if (typeof cloudflareIp === "string" && cloudflareIp) return cloudflareIp;
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded)
    return forwarded.split(",", 1)[0].trim();
  return request.socket.remoteAddress ?? "unknown";
}

function allowAttempt(attempts, identifier) {
  const now = Date.now();
  for (const [key, value] of attempts) {
    if (value.startedAt + 60_000 <= now) attempts.delete(key);
  }
  const current = attempts.get(identifier);
  if (!current) {
    if (attempts.size >= 1_024) attempts.delete(attempts.keys().next().value);
    attempts.set(identifier, { count: 1, startedAt: now });
    return true;
  }
  if (current.count >= MAX_ATTEMPTS_PER_MINUTE) return false;
  current.count += 1;
  return true;
}

function pruneSessions(sessions) {
  const now = Date.now();
  for (const [digest, expiresAt] of sessions) {
    if (expiresAt <= now) sessions.delete(digest);
  }
}

function constantTimeEqual(left, right) {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function hashToken(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readCookie(header, name) {
  if (!header) return null;
  for (const entry of header.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0 || entry.slice(0, separator).trim() !== name) continue;
    const value = entry.slice(separator + 1).trim();
    return value && value.length <= 128 ? value : null;
  }
  return null;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function assertPort(value, label) {
  if (!Number.isInteger(value) || value < 1 || value > 65_535)
    throw new Error(`Capture ${label} port must be between 1 and 65535.`);
}
