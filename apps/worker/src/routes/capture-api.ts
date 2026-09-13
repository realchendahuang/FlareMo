import { Hono } from "hono";
import { bridgeCapture } from "../asr/bridge";
import { getConfiguredAsr } from "../asr/provider";
import { getTrustedOrigins } from "../auth";
import { getBrowserRequestContext, type HonoBindings } from "../context";
import { jsonError } from "../http";
import { rateLimitGuard } from "../rate-limit";

export const captureApi = new Hono<HonoBindings>();
captureApi.get("/status", async (c) => {
  try {
    await getBrowserRequestContext(c);
    const configured = getConfiguredAsr(c.env);
    const available = Boolean(configured);
    return c.json(
      {
        available,
        provider: configured?.id ?? null,
        streaming: available,
      },
      200,
      { "Cache-Control": "no-store" },
    );
  } catch (error) {
    return jsonError(c, error);
  }
});
captureApi.get("/ws", async (c) => {
  try {
    const { user } = await getBrowserRequestContext(c);
    const origin = c.req.header("origin");
    if (!origin || !getTrustedOrigins(c.env).includes(origin))
      return c.text("Forbidden", 403);
    const configured = getConfiguredAsr(c.env);
    if (!configured) return c.text("ASR unavailable", 503);
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket")
      return c.text("Expected WebSocket upgrade", 426);
    const throttled = await rateLimitGuard(c, "capture", user.id);
    if (throttled) return throttled;
    const pair = new WebSocketPair();
    pair[1].accept();
    bridgeCapture(pair[1], configured.provider, () =>
      getBrowserRequestContext(c),
    );
    return new Response(null, { status: 101, webSocket: pair[0] });
  } catch (error) {
    return jsonError(c, error);
  }
});
