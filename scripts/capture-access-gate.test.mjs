import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import { startCaptureAccessGate } from "./lib/capture-access-gate.mjs";

test("guards HTTP and WebSocket traffic and revokes live sessions", async (context) => {
  const upstream = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ cookie: request.headers.cookie ?? null }));
  });
  const webSockets = new WebSocketServer({ noServer: true });
  upstream.on("upgrade", (request, socket, head) => {
    webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      webSocket.on("message", (message) => webSocket.send(message));
    });
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const address = upstream.address();
  assert(address && typeof address !== "string");

  const initialKey = "FC-test01-test02-test03-test04";
  const gate = await startCaptureAccessGate({
    accessKey: initialKey,
    notice: "本地验收环境，不写入生产。",
    upstreamPort: address.port,
  });
  context.after(async () => {
    await gate.close();
    for (const webSocket of webSockets.clients) webSocket.terminate();
    webSockets.close();
    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
  });

  const redirect = await fetch(`${gate.url}/capture?draft=1`, {
    redirect: "manual",
  });
  assert.equal(redirect.status, 303);
  assert.match(redirect.headers.get("location") ?? "", /^\/__capture_access\?/);

  const health = await fetch(`${gate.url}/__capture_health`);
  assert.equal(health.status, 204);
  assert.equal(health.headers.get("x-flaremo-capture-gate"), "ready");
  assert.equal(await health.text(), "");

  const accessPage = await fetch(`${gate.url}/__capture_access`);
  assert.match(await accessPage.text(), /本地验收环境，不写入生产。/);

  const denied = await submitKey(gate.url, "incorrect", "/capture");
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get("set-cookie"), null);

  const accepted = await submitKey(gate.url, initialKey, "/capture");
  assert.equal(accepted.status, 303);
  assert.equal(accepted.headers.get("location"), "/capture");
  const cookie = accepted.headers.get("set-cookie")?.split(";", 1)[0];
  assert(cookie);
  assert.match(
    accepted.headers.get("set-cookie") ?? "",
    /HttpOnly; Secure; SameSite=Strict/,
  );

  const proxied = await fetch(`${gate.url}/capture`, {
    headers: { cookie: `${cookie}; flaremo.session=kept` },
  });
  assert.equal(proxied.status, 200);
  assert.deepEqual(await proxied.json(), { cookie: "flaremo.session=kept" });

  const unauthorizedStatus = await rejectedWebSocketStatus(
    gate.url.replace("http:", "ws:"),
  );
  assert.equal(unauthorizedStatus, 401);
  await assertWebSocketEcho(gate.url.replace("http:", "ws:"), cookie);

  const rotatedKey = gate.rotate();
  assert.notEqual(rotatedKey, initialKey);
  assert.equal(
    (
      await fetch(`${gate.url}/capture`, {
        headers: { cookie },
        redirect: "manual",
      })
    ).status,
    303,
  );
  assert.equal((await submitKey(gate.url, initialKey, "/capture")).status, 401);
  const rotated = await submitKey(gate.url, rotatedKey, "/capture");
  assert.equal(rotated.status, 303);
  const rotatedCookie = rotated.headers.get("set-cookie")?.split(";", 1)[0];
  assert(rotatedCookie);

  gate.disableVerification();
  const openAccess = await fetch(`${gate.url}/capture`);
  assert.equal(openAccess.status, 200);
  await assertWebSocketEcho(gate.url.replace("http:", "ws:"));

  const protectedAgainKey = gate.rotate();
  assert.equal(
    (await fetch(`${gate.url}/capture`, { redirect: "manual" })).status,
    303,
  );
  const protectedAgain = await submitKey(
    gate.url,
    protectedAgainKey,
    "/capture",
  );
  const protectedAgainCookie = protectedAgain.headers
    .get("set-cookie")
    ?.split(";", 1)[0];
  assert(protectedAgainCookie);

  gate.revoke();
  assert.equal(
    (
      await fetch(`${gate.url}/capture`, {
        headers: { cookie: protectedAgainCookie },
        redirect: "manual",
      })
    ).status,
    303,
  );
  const revokedPage = await fetch(`${gate.url}/__capture_access`);
  assert.equal(revokedPage.status, 503);
  assert.match(await revokedPage.text(), /临时访问已撤销/);
  const revokedHealth = await fetch(`${gate.url}/__capture_health`);
  assert.equal(revokedHealth.status, 204);
  assert.equal(revokedHealth.headers.get("x-flaremo-capture-gate"), "ready");
});

function submitKey(origin, key, next) {
  return fetch(`${origin}/__capture_access`, {
    body: new URLSearchParams({ access_key: key, next }),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
    redirect: "manual",
  });
}

function rejectedWebSocketStatus(origin) {
  return new Promise((resolve, reject) => {
    const webSocket = new WebSocket(`${origin}/api/app/capture/ws`);
    webSocket.once("unexpected-response", (_request, response) => {
      resolve(response.statusCode);
      response.resume();
    });
    webSocket.once("error", reject);
  });
}

function assertWebSocketEcho(origin, cookie) {
  return new Promise((resolve, reject) => {
    const webSocket = new WebSocket(`${origin}/api/app/capture/ws`, {
      headers: cookie ? { cookie } : undefined,
    });
    webSocket.once("open", () => webSocket.send("capture-gate-echo"));
    webSocket.once("message", (message) => {
      assert.equal(message.toString(), "capture-gate-echo");
      webSocket.close();
      resolve();
    });
    webSocket.once("error", reject);
  });
}
