import { Hono } from "hono";
import { getRequestContext, type HonoBindings } from "../context";
import { jsonError } from "../http";

const connectedFrame = ": connected\n\n";
const heartbeatFrame = ": heartbeat\n\n";
const heartbeatIntervalMs = 30_000;

/**
 * Memos' live endpoint is an authenticated text/event-stream connection. A
 * Worker can provide the HTTP stream, but it does not have a process-global
 * broadcaster across isolates. This endpoint therefore guarantees the wire
 * handshake and heartbeat lifecycle today; resource mutations remain REST/MCP
 * authoritative until a Durable Object or event-log binding is introduced.
 */
export const memosSseApi = new Hono<HonoBindings>();

memosSseApi.get("/api/v1/sse", async (c) => {
  try {
    await getRequestContext(c);
  } catch (error) {
    return jsonError(c, error);
  }

  const encoder = new TextEncoder();
  let closeStream: () => void = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(heartbeatFrame));
        } catch {
          closeStream();
        }
      }, heartbeatIntervalMs);

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        c.req.raw.signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {
          // The client may already have cancelled the stream.
        }
      };
      closeStream = close;
      c.req.raw.signal.addEventListener("abort", close, { once: true });
      controller.enqueue(encoder.encode(connectedFrame));
    },
    cancel() {
      closeStream();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "cache-control": "no-cache, no-store",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    },
  });
});
