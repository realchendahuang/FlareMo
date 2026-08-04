import {
  type FlareMoDb,
  type MemoPayload,
  type MemoRow,
  memosWebhookDeliveries,
  memosWebhookEvents,
  memosWebhooks,
  type UserRow,
} from "@flaremo/db";
import { and, asc, eq, isNotNull, isNull, lt, lte, or } from "drizzle-orm";

export const MEMOS_WEBHOOK_ACTIVITY_TYPES = [
  "memos.memo.created",
  "memos.memo.updated",
  "memos.memo.deleted",
  "memos.memo.comment.created",
] as const;

export type MemosWebhookActivityType =
  (typeof MEMOS_WEBHOOK_ACTIVITY_TYPES)[number];

type WebhookMemoSnapshot = Pick<
  MemoRow,
  | "id"
  | "content"
  | "visibility"
  | "status"
  | "pinned"
  | "createdAt"
  | "updatedAt"
  | "payload"
>;

type NewMemosWebhookEvent = {
  receiverId: string;
  activityType: MemosWebhookActivityType;
  creator: UserRow;
  memo: WebhookMemoSnapshot;
  createdAt: string;
};

type PendingDelivery = {
  delivery: typeof memosWebhookDeliveries.$inferSelect;
  event: typeof memosWebhookEvents.$inferSelect;
  webhook: typeof memosWebhooks.$inferSelect;
};

const MAX_ATTEMPTS = 5;
const MAX_EVENTS_PER_SWEEP = 16;
const MAX_DELIVERIES_PER_SWEEP = 16;
const DELIVERY_LEASE_MS = 60_000;
const DELIVERY_TIMEOUT_MS = 10_000;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

/**
 * Add a durable webhook outbox row to the caller's D1 batch. The event body is
 * a snapshot because deleted memos cannot be reconstructed during retry.
 */
export function insertMemosWebhookEvent(
  db: FlareMoDb,
  input: NewMemosWebhookEvent,
) {
  return db.insert(memosWebhookEvents).values({
    receiverId: input.receiverId,
    activityType: input.activityType,
    body: {
      activityType: input.activityType,
      creator: input.creator.id,
      memo: memoToWebhookDto(input.memo, input.creator),
    },
    createdAt: input.createdAt,
    expandedAt: null,
  });
}

/**
 * Expand new events into independent deliveries and send a bounded number of
 * claimed rows. Call this from waitUntil after a request and from the cron
 * handler. The function never throws for a remote webhook failure; it records
 * the retry state so a later sweep can continue the delivery.
 */
export async function dispatchMemosWebhookOutbox(
  db: FlareMoDb,
  now = new Date(),
) {
  const nowIso = now.toISOString();
  await recoverExpiredDeliveryLeases(db, nowIso);
  await expandPendingEvents(db, nowIso);

  const pending = await listClaimableDeliveries(db, nowIso);
  const claimedDeliveries: Array<{
    item: PendingDelivery;
    delivery: typeof memosWebhookDeliveries.$inferSelect;
  }> = [];
  for (const item of pending) {
    const claimed = await claimDelivery(db, item.delivery, nowIso);
    if (claimed) claimedDeliveries.push({ item, delivery: claimed });
  }

  // Fetches are independent; run the bounded batch concurrently so one slow
  // endpoint does not hold the other deliveries past the Worker waitUntil
  // window. Each delivery still has its own lease and retry state.
  await Promise.all(
    claimedDeliveries.map(async ({ item, delivery }) => {
      try {
        await postWebhook(item, delivery, now);
        await markDeliveryDelivered(db, delivery.id, nowIso);
      } catch (error) {
        await markDeliveryFailed(
          db,
          delivery,
          now,
          webhookFailureMessage(error),
        );
      }
    }),
  );

  await pruneMemosWebhookOutbox(db, new Date(now.getTime() - RETENTION_MS));
}

export async function pruneMemosWebhookOutbox(db: FlareMoDb, before: Date) {
  const cutoff = before.toISOString();
  const events = await db
    .select({ id: memosWebhookEvents.id })
    .from(memosWebhookEvents)
    .where(
      and(
        lt(memosWebhookEvents.createdAt, cutoff),
        // Events are only safe to prune after they have been expanded. Pending
        // delivery rows are retained until their retry/dead-letter boundary.
        // `expandedAt` being non-null is the durable expansion marker.
        isNotNull(memosWebhookEvents.expandedAt),
      ),
    )
    .limit(100);
  if (events.length === 0) return;
  for (const event of events) {
    const unfinished = await db
      .select({ id: memosWebhookDeliveries.id })
      .from(memosWebhookDeliveries)
      .where(
        and(
          eq(memosWebhookDeliveries.eventId, event.id),
          or(
            eq(memosWebhookDeliveries.status, "pending"),
            eq(memosWebhookDeliveries.status, "sending"),
          ),
        ),
      )
      .limit(1);
    if (unfinished.length > 0) continue;
    await db
      .delete(memosWebhookEvents)
      .where(eq(memosWebhookEvents.id, event.id));
  }
}

async function expandPendingEvents(db: FlareMoDb, nowIso: string) {
  const events = await db
    .select()
    .from(memosWebhookEvents)
    .where(isNull(memosWebhookEvents.expandedAt))
    .orderBy(asc(memosWebhookEvents.id))
    .limit(MAX_EVENTS_PER_SWEEP);

  for (const event of events) {
    const webhooks = await db
      .select()
      .from(memosWebhooks)
      .where(
        and(
          eq(memosWebhooks.userId, event.receiverId),
          // A webhook created after an event must not receive historical
          // events. A deleted webhook naturally loses its delivery row.
          lte(memosWebhooks.createdAt, event.createdAt),
        ),
      );

    for (const webhook of webhooks) {
      await db
        .insert(memosWebhookDeliveries)
        .values({
          eventId: event.id,
          webhookId: webhook.id,
          status: "pending",
          attempts: 0,
          nextAttemptAt: nowIso,
          leaseUntil: null,
          deliveredAt: null,
          lastError: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .onConflictDoNothing({
          target: [
            memosWebhookDeliveries.eventId,
            memosWebhookDeliveries.webhookId,
          ],
        });
    }

    await db
      .update(memosWebhookEvents)
      .set({ expandedAt: nowIso })
      .where(
        and(
          eq(memosWebhookEvents.id, event.id),
          isNull(memosWebhookEvents.expandedAt),
        ),
      );
  }
}

async function recoverExpiredDeliveryLeases(db: FlareMoDb, nowIso: string) {
  await db
    .update(memosWebhookDeliveries)
    .set({ status: "pending", leaseUntil: null, updatedAt: nowIso })
    .where(
      and(
        eq(memosWebhookDeliveries.status, "sending"),
        or(
          isNull(memosWebhookDeliveries.leaseUntil),
          lt(memosWebhookDeliveries.leaseUntil, nowIso),
        ),
      ),
    );
}

async function listClaimableDeliveries(
  db: FlareMoDb,
  nowIso: string,
): Promise<PendingDelivery[]> {
  return db
    .select({
      delivery: memosWebhookDeliveries,
      event: memosWebhookEvents,
      webhook: memosWebhooks,
    })
    .from(memosWebhookDeliveries)
    .innerJoin(
      memosWebhookEvents,
      eq(memosWebhookEvents.id, memosWebhookDeliveries.eventId),
    )
    .innerJoin(
      memosWebhooks,
      eq(memosWebhooks.id, memosWebhookDeliveries.webhookId),
    )
    .where(
      and(
        eq(memosWebhookDeliveries.status, "pending"),
        lte(memosWebhookDeliveries.nextAttemptAt, nowIso),
      ),
    )
    .orderBy(asc(memosWebhookDeliveries.id))
    .limit(MAX_DELIVERIES_PER_SWEEP);
}

async function claimDelivery(
  db: FlareMoDb,
  delivery: typeof memosWebhookDeliveries.$inferSelect,
  nowIso: string,
) {
  const leaseUntil = new Date(
    new Date(nowIso).getTime() + DELIVERY_LEASE_MS,
  ).toISOString();
  const claimed = await db
    .update(memosWebhookDeliveries)
    .set({
      status: "sending",
      attempts: delivery.attempts + 1,
      leaseUntil,
      updatedAt: nowIso,
    })
    .where(
      and(
        eq(memosWebhookDeliveries.id, delivery.id),
        eq(memosWebhookDeliveries.status, "pending"),
        lte(memosWebhookDeliveries.nextAttemptAt, nowIso),
      ),
    )
    .returning();
  return claimed[0];
}

async function postWebhook(
  item: PendingDelivery,
  delivery: typeof memosWebhookDeliveries.$inferSelect,
  now: Date,
) {
  const body = JSON.stringify({
    ...item.event.body,
    url: item.webhook.url,
  });
  const messageId = `msg_${item.event.id}_${delivery.id}`;
  const timestamp = Math.floor(now.getTime() / 1_000).toString();
  const signature = await signWebhookBody(
    item.webhook.signingSecret,
    `${messageId}.${timestamp}.${body}`,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const response = await fetch(item.webhook.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "webhook-id": messageId,
        "webhook-timestamp": timestamp,
        "webhook-signature": `v1,${signature}`,
      },
      body,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`http_${response.status}`);
    const text = await response.text();
    if (text.trim()) {
      try {
        const value = JSON.parse(text) as { code?: unknown };
        if (value.code !== undefined && value.code !== 0) {
          throw new Error("remote_code_not_zero");
        }
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "remote_code_not_zero"
        ) {
          throw error;
        }
        // Standard webhook receivers commonly return an empty body or any
        // successful JSON. Do not require Memos' legacy {code:0} envelope.
      }
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function signWebhookBody(secret: string, message: string) {
  const keyBytes = decodeSigningSecret(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return bytesToBase64(new Uint8Array(signature));
}

function decodeSigningSecret(secret: string) {
  if (!secret.startsWith("whsec_")) return new TextEncoder().encode(secret);
  const encoded = secret.slice("whsec_".length);
  return Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function markDeliveryDelivered(
  db: FlareMoDb,
  deliveryId: number,
  nowIso: string,
) {
  await db
    .update(memosWebhookDeliveries)
    .set({
      status: "delivered",
      leaseUntil: null,
      deliveredAt: nowIso,
      lastError: null,
      updatedAt: nowIso,
    })
    .where(eq(memosWebhookDeliveries.id, deliveryId));
}

async function markDeliveryFailed(
  db: FlareMoDb,
  delivery: typeof memosWebhookDeliveries.$inferSelect,
  now: Date,
  message: string,
) {
  const dead = delivery.attempts >= MAX_ATTEMPTS;
  const retryAt = new Date(
    now.getTime() + Math.min(60 * 60 * 1_000, 2 ** delivery.attempts * 1_000),
  ).toISOString();
  await db
    .update(memosWebhookDeliveries)
    .set({
      status: dead ? "dead" : "pending",
      nextAttemptAt: retryAt,
      leaseUntil: null,
      lastError: message,
      updatedAt: now.toISOString(),
    })
    .where(eq(memosWebhookDeliveries.id, delivery.id));
}

function webhookFailureMessage(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "timeout";
  }
  if (error instanceof Error && /^http_\d+$/u.test(error.message)) {
    return error.message;
  }
  if (error instanceof Error && error.message === "remote_code_not_zero") {
    return error.message;
  }
  return "network_error";
}

function memoToWebhookDto(memo: WebhookMemoSnapshot, creator: UserRow) {
  const payload = isMemoPayload(memo.payload) ? memo.payload : {};
  const tags = Array.isArray(payload.tags)
    ? payload.tags.filter((tag): tag is string => typeof tag === "string")
    : [];
  return {
    name: memo.id,
    state: memo.status === "normal" ? "NORMAL" : "ARCHIVED",
    creator: creator.id,
    createTime: memo.createdAt,
    updateTime: memo.updatedAt,
    content: memo.content,
    visibility:
      memo.visibility === "private"
        ? "PRIVATE"
        : memo.visibility === "protected"
          ? "PROTECTED"
          : "PUBLIC",
    tags,
    pinned: memo.pinned,
    reactions: [],
    snippet: memo.content.replace(/\s+/gu, " ").trim().slice(0, 64),
  };
}

function isMemoPayload(value: MemoPayload): value is MemoPayload {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
