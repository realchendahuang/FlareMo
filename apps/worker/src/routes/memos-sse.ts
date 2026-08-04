import {
  canReceiveMemosSseEvent,
  getLatestMemosSseEventId,
  listMemosSseEvents,
} from "@flaremo/domain";
import { Hono } from "hono";
import { getRequestContext, type HonoBindings } from "../context";
import { jsonError } from "../http";

const connectedFrame = ": connected\n\n";
const heartbeatFrame = ": heartbeat\n\n";
const heartbeatIntervalMs = 30_000;
const eventPollIntervalMs = 5_000;
const eventBatchSize = 64;

/**
 * Memos' live endpoint is backed by a D1 event cursor. D1 polling is a small,
 * portable cross-isolate primitive for the current single-user Worker model;
 * the monotonic row id also makes Last-Event-ID replay deterministic after a
 * client reconnects or a Worker isolate is replaced.
 */
export const memosSseApi = new Hono<HonoBindings>();

memosSseApi.get("/api/v1/sse", async (c) => {
  let context: Awaited<ReturnType<typeof getRequestContext>>;
  try {
    context = await getRequestContext(c);
  } catch (error) {
    return jsonError(c, error);
  }

  const lastEventIdHeader = c.req.header("last-event-id")?.trim();
  let cursor: number;
  if (lastEventIdHeader) {
    if (!/^\d+$/.test(lastEventIdHeader)) {
      return c.text("Invalid Last-Event-ID", 400);
    }
    cursor = Number(lastEventIdHeader);
    if (!Number.isSafeInteger(cursor)) {
      return c.text("Invalid Last-Event-ID", 400);
    }
  } else {
    // A fresh subscription follows new writes. Replay is opt-in through
    // Last-Event-ID, matching the normal Memos client lifecycle.
    cursor = await getLatestMemosSseEventId(context.db);
  }

  const encoder = new TextEncoder();
  let closeStream: () => void = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let polling = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let pollTimer: ReturnType<typeof setInterval> | undefined;

      const enqueue = (frame: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          closeStream();
        }
      };

      const poll = async () => {
        if (closed || polling) return;
        polling = true;
        try {
          // Drain a full page in one turn so a reconnect does not get stuck
          // replaying the same first 64 rows forever.
          while (!closed) {
            const events = await listMemosSseEvents(
              context.db,
              cursor,
              eventBatchSize,
            );
            if (events.length === 0) break;
            for (const event of events) {
              cursor = Math.max(cursor, event.id);
              if (!canReceiveMemosSseEvent(event, context.user)) continue;
              const payload = {
                type: event.type,
                name: event.name,
                ...(event.parent ? { parent: event.parent } : {}),
              };
              enqueue(`id: ${event.id}\ndata: ${JSON.stringify(payload)}\n\n`);
            }
            if (events.length < eventBatchSize) break;
          }
        } catch {
          // A stream cannot return a structured error after headers are sent.
          // Closing forces EventSource clients to reconnect with their cursor.
          closeStream();
        } finally {
          polling = false;
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (pollTimer) clearInterval(pollTimer);
        c.req.raw.signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {
          // The client may already have cancelled the stream.
        }
      };
      closeStream = close;
      c.req.raw.signal.addEventListener("abort", close, { once: true });
      enqueue(connectedFrame);
      void poll();
      heartbeat = setInterval(
        () => enqueue(heartbeatFrame),
        heartbeatIntervalMs,
      );
      pollTimer = setInterval(() => void poll(), eventPollIntervalMs);
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
