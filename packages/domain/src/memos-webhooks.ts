import {
  type FlareMoDb,
  type MemoPayload,
  type MemoRow,
  memosWebhookDeliveries,
  memosWebhookEvents,
  memosWebhooks,
  reactions,
  type UserRow,
} from "@flaremo/db";
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
} from "drizzle-orm";
import { chunkForD1, d1IdsPerStatement } from "./d1-limits";

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
const MAX_WEBHOOK_RESPONSE_BYTES = 64 * 1024;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

// ---------------------------------------------------------------------------
// Shared safe outbound fetch
// ---------------------------------------------------------------------------
//
// Webhook destinations, plugin directory/artifact URLs and link metadata all
// originate outside the trusted deployment. Keep one implementation for the
// protocol, credential, literal-address, redirect, timeout and body-size rules
// so a future caller cannot accidentally ship a weaker copy.
//
// The Worker runtime has no synchronous DNS resolver, so hostnames cannot be
// pinned to an IP here. Literal and well-known reserved hosts are rejected on
// every hop; deployments should additionally keep an outbound egress policy at
// the Cloudflare boundary.
const OUTBOUND_MAX_URL_LENGTH = 2_048;

export const OUTBOUND_DEFAULT_TIMEOUT_MS = 10_000;
export const OUTBOUND_DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
export const OUTBOUND_DEFAULT_MAX_REDIRECTS = 5;

export type OutboundFetchErrorCode =
  | "invalid_url"
  | "unsupported_protocol"
  | "insecure_protocol"
  | "blocked_host"
  | "too_many_redirects"
  | "invalid_redirect"
  | "timeout"
  | "network_error"
  | "response_too_large";

export class OutboundFetchError extends Error {
  constructor(
    readonly code: OutboundFetchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OutboundFetchError";
  }
}

export type OutboundUrlValidationOptions = {
  allowFragment?: boolean;
  maxUrlLength?: number;
  /** Reject both the initial URL and every redirect that is not HTTPS. */
  requireHttps?: boolean;
};

export type OutboundFetcher = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export type SafeOutboundFetchOptions = OutboundUrlValidationOptions & {
  fetcher?: OutboundFetcher;
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
};

export type SafeOutboundResponse = {
  /** Final URL after manually followed redirects. */
  url: string;
  status: number;
  ok: boolean;
  headers: Headers;
  body: Uint8Array;
};

/**
 * Validate an outbound URL before any request is sent. Redirect targets must go
 * through this same function too.
 */
export function validateOutboundUrl(
  value: string | URL,
  options: OutboundUrlValidationOptions = {},
): URL {
  let url: URL;
  try {
    url = value instanceof URL ? new URL(value.href) : new URL(value.trim());
  } catch {
    throw new OutboundFetchError("invalid_url", "invalid URL format");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new OutboundFetchError(
      "unsupported_protocol",
      "only http/https protocols are allowed",
    );
  }
  if (options.requireHttps && url.protocol !== "https:") {
    throw new OutboundFetchError(
      "insecure_protocol",
      "only https protocol is allowed",
    );
  }
  if (!url.hostname || url.username || url.password) {
    throw new OutboundFetchError("invalid_url", "invalid URL format");
  }
  if (!options.allowFragment && url.hash) {
    throw new OutboundFetchError(
      "invalid_url",
      "URL fragments are not allowed",
    );
  }
  const maxUrlLength = Math.max(
    1,
    options.maxUrlLength ?? OUTBOUND_MAX_URL_LENGTH,
  );
  if (url.href.length > maxUrlLength) {
    throw new OutboundFetchError("invalid_url", "URL is too long");
  }
  if (isBlockedOutboundHostname(url.hostname)) {
    throw new OutboundFetchError(
      "blocked_host",
      "internal IP addresses are not allowed",
    );
  }
  return url;
}

/** Fetch a URL without ever following a redirect the caller cannot inspect. */
export async function safeOutboundFetch(
  input: string | URL,
  options: SafeOutboundFetchOptions = {},
): Promise<SafeOutboundResponse> {
  const timeoutMs = Math.max(
    1,
    options.timeoutMs ?? OUTBOUND_DEFAULT_TIMEOUT_MS,
  );
  const maxResponseBytes = Math.max(
    0,
    Math.floor(options.maxResponseBytes ?? OUTBOUND_DEFAULT_MAX_RESPONSE_BYTES),
  );
  const maxRedirects = Math.max(
    0,
    Math.floor(options.maxRedirects ?? OUTBOUND_DEFAULT_MAX_REDIRECTS),
  );
  const fetcher = options.fetcher ?? (globalThis.fetch as OutboundFetcher);
  if (typeof fetcher !== "function") {
    throw new OutboundFetchError("network_error", "fetch is not available");
  }

  let currentUrl = validateOutboundUrl(input, options);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let redirect = 0; ; redirect += 1) {
      const response = await fetcher(currentUrl.href, {
        method: options.method,
        headers: options.headers,
        body: options.body,
        redirect: "manual",
        signal: controller.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (!location) {
          throw new OutboundFetchError(
            "invalid_redirect",
            "redirect is missing a location",
          );
        }
        if (redirect >= maxRedirects) {
          throw new OutboundFetchError(
            "too_many_redirects",
            "too many redirects",
          );
        }
        let nextUrl: URL;
        try {
          nextUrl = new URL(location, currentUrl);
        } catch {
          throw new OutboundFetchError(
            "invalid_redirect",
            "redirect target is invalid",
          );
        }
        currentUrl = validateOutboundUrl(nextUrl.href, options);
        continue;
      }

      // `redirect: manual` should make response.url equal the requested URL.
      // Validate it anyway so a custom/mock fetch implementation cannot turn
      // an apparently safe request into an internal response hop.
      const finalUrl = response.url
        ? validateOutboundUrl(response.url, options)
        : currentUrl;
      const declaredLength = Number(
        response.headers.get("content-length") ?? "",
      );
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > maxResponseBytes
      ) {
        await response.body?.cancel().catch(() => undefined);
        throw new OutboundFetchError(
          "response_too_large",
          "remote response is too large",
        );
      }
      const body = await readLimitedResponseBody(
        response,
        controller,
        maxResponseBytes,
      );
      return {
        url: finalUrl.href,
        status: response.status,
        ok: response.ok,
        headers: response.headers,
        body,
      };
    }
  } catch (error) {
    if (error instanceof OutboundFetchError) throw error;
    if (controller.signal.aborted) {
      throw new OutboundFetchError("timeout", "outbound request timed out");
    }
    throw new OutboundFetchError("network_error", "failed to fetch remote URL");
  } finally {
    clearTimeout(timeout);
  }
}

async function readLimitedResponseBody(
  response: Response,
  controller: AbortController,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes) {
        controller.abort();
        await reader.cancel().catch(() => undefined);
        throw new OutboundFetchError(
          "response_too_large",
          "remote response is too large",
        );
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function isBlockedOutboundHostname(rawHostname: string): boolean {
  // URL.hostname preserves brackets for IPv6 while many test fakes use the
  // canonical unbracketed form. Normalize both, including the single trailing
  // dot that means the same DNS name (`localhost.`).
  const hostname = rawHostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".localdomain") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".home.arpa")
  ) {
    return true;
  }

  const ipv4 = parseIpv4Literal(hostname);
  if (ipv4) return isBlockedIpv4(ipv4);
  if (!hostname.includes(":")) return false;

  // Loopback, link-local, unique-local and multicast IPv6.
  if (
    hostname === "::" ||
    hostname === "::1" ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd") ||
    hostname.startsWith("fe8") ||
    hostname.startsWith("fe9") ||
    hostname.startsWith("fea") ||
    hostname.startsWith("feb") ||
    hostname.startsWith("ff") ||
    // Well-known translation/transition prefixes can embed a private IPv4
    // address; reject them conservatively.
    hostname.startsWith("64:ff9b:") ||
    hostname.startsWith("2001:db8:")
  ) {
    return true;
  }

  // IPv4-mapped or IPv4-compatible forms are normalized by WHATWG URL into
  // hexadecimal groups, e.g. `::ffff:127.0.0.1` -> `::ffff:7f00:1`.
  const embedded =
    /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(hostname) ??
    /^0{1,4}:0{1,4}:0{1,4}:0{1,4}:0{1,4}:(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(
      hostname,
    );
  if (embedded?.[1] && embedded[2]) {
    const high = Number.parseInt(embedded[1], 16);
    const low = Number.parseInt(embedded[2], 16);
    return isBlockedIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
  }
  return false;
}

function parseIpv4Literal(hostname: string): number[] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/u.test(part))) {
    return null;
  }
  const octets = parts.map(Number);
  if (
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return null;
  }
  return octets;
}

function isBlockedIpv4([first = -1, second = -1]: number[]): boolean {
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 0 || second === 168)) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 203 && second === 0) ||
    first >= 224
  );
}

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
        await postWebhook(db, item, delivery, now);
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
  const eventIds = events.map((event) => event.id);
  // One lookup for every event that still owns a live delivery, instead of a
  // LIMIT 1 probe per event. Only events absent from this set are prunable.
  // D1 caps a statement at 100 bound parameters; the status predicate adds two,
  // so a literal 100-id inArray would fail at exactly the prune page boundary.
  const blocked = new Set<number>();
  for (const eventIdChunk of chunkForD1(eventIds, d1IdsPerStatement(2))) {
    const unfinished = await db
      .select({ eventId: memosWebhookDeliveries.eventId })
      .from(memosWebhookDeliveries)
      .where(
        and(
          inArray(memosWebhookDeliveries.eventId, eventIdChunk),
          inArray(memosWebhookDeliveries.status, ["pending", "sending"]),
        ),
      );
    for (const row of unfinished) blocked.add(row.eventId);
  }
  const prunableIds = eventIds.filter((id) => !blocked.has(id));
  if (prunableIds.length === 0) return;
  for (const idChunk of chunkForD1(prunableIds, d1IdsPerStatement())) {
    await db
      .delete(memosWebhookEvents)
      .where(inArray(memosWebhookEvents.id, idChunk));
  }
}

async function expandPendingEvents(db: FlareMoDb, nowIso: string) {
  const events = await db
    .select()
    .from(memosWebhookEvents)
    .where(isNull(memosWebhookEvents.expandedAt))
    .orderBy(asc(memosWebhookEvents.id))
    .limit(MAX_EVENTS_PER_SWEEP);

  // Webhooks used to be looked up once per event; the sweep is bounded so a
  // single inArray fetch over the distinct receivers covers every event, and
  // the per-event createdAt boundary is applied while filtering in memory.
  const receiverIds = [...new Set(events.map((event) => event.receiverId))];
  const receiverWebhooks =
    receiverIds.length > 0
      ? await db
          .select()
          .from(memosWebhooks)
          .where(inArray(memosWebhooks.userId, receiverIds))
      : [];

  for (const event of events) {
    // A webhook created after an event must not receive historical events. A
    // deleted webhook naturally loses its delivery row.
    const webhooks = receiverWebhooks.filter(
      (webhook) =>
        webhook.userId === event.receiverId &&
        webhook.createdAt <= event.createdAt,
    );

    const statements: unknown[] = webhooks.map((webhook) =>
      db
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
        }),
    );
    statements.push(
      db
        .update(memosWebhookEvents)
        .set({ expandedAt: nowIso })
        .where(
          and(
            eq(memosWebhookEvents.id, event.id),
            isNull(memosWebhookEvents.expandedAt),
          ),
        ),
    );
    await db.batch(statements as unknown as Parameters<FlareMoDb["batch"]>[0]);
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
  db: FlareMoDb,
  item: PendingDelivery,
  delivery: typeof memosWebhookDeliveries.$inferSelect,
  now: Date,
) {
  // The event snapshot is stored at write time, before reactions land; fill
  // the reactions field at delivery time so subscribers receive the real
  // reaction list instead of a constant empty array.
  const bodyPayload = await hydrateWebhookReactions(db, item.event.body);
  const body = JSON.stringify({
    ...bodyPayload,
    url: item.webhook.url,
  });
  const messageId = `msg_${item.event.id}_${delivery.id}`;
  const timestamp = Math.floor(now.getTime() / 1_000).toString();
  const signature = await signWebhookBody(
    item.webhook.signingSecret,
    `${messageId}.${timestamp}.${body}`,
  );
  const response = await safeOutboundFetch(item.webhook.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": messageId,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${signature}`,
    },
    body,
    timeoutMs: DELIVERY_TIMEOUT_MS,
    maxResponseBytes: MAX_WEBHOOK_RESPONSE_BYTES,
  });
  if (!response.ok) throw new Error(`http_${response.status}`);
  const text = new TextDecoder().decode(response.body).trim();
  if (text) {
    try {
      const value = JSON.parse(text) as { code?: unknown };
      if (value.code !== undefined && value.code !== 0) {
        throw new Error("remote_code_not_zero");
      }
    } catch (error) {
      if (error instanceof Error && error.message === "remote_code_not_zero") {
        throw error;
      }
      // Standard webhook receivers commonly return an empty body or any
      // successful JSON. Do not require Memos' legacy {code:0} envelope.
    }
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

/**
 * Fill `body.memo.reactions` with the memo's current reaction list. The event
 * snapshot is written before reactions change, so the delivery time is the
 * only point that can show a truthful list.
 */
async function hydrateWebhookReactions(
  db: FlareMoDb,
  body: unknown,
): Promise<Record<string, unknown>> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const source = body as Record<string, unknown>;
  const memo = source.memo as
    | { name?: unknown; reactions?: unknown }
    | undefined;
  if (
    !memo ||
    typeof memo.name !== "string" ||
    !Array.isArray(memo.reactions)
  ) {
    return source;
  }
  const memoId = memo.name;
  const rows = await db
    .select({
      reactionType: reactions.reactionType,
      creatorId: reactions.creatorId,
    })
    .from(reactions)
    .where(eq(reactions.contentId, memoId));
  return {
    ...source,
    memo: {
      ...memo,
      reactions: rows.map((row) => ({
        reaction_type: row.reactionType,
        creator: row.creatorId,
      })),
    },
  };
}

function webhookFailureMessage(error: unknown) {
  if (error instanceof OutboundFetchError) {
    if (error.code === "timeout") return "timeout";
    return `outbound_${error.code}`;
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return "timeout";
  }
  if (error instanceof Error && /^http_\d+$/u.test(error.message)) {
    return error.message;
  }
  if (error instanceof Error && error.message === "remote_code_not_zero") {
    return error.message;
  }
  // Keep a bounded excerpt of the real error so dead-letter rows are
  // diagnosable instead of a bare "network_error" bucket.
  const detail = error instanceof Error ? error.message : String(error);
  if (detail) return `network_error: ${detail.slice(0, 180)}`;
  return "network_error";
}

function memoToWebhookDto(memo: WebhookMemoSnapshot, creator: UserRow) {
  const payload = isMemoPayload(memo.payload) ? memo.payload : {};
  const tags = Array.isArray(payload.tags)
    ? payload.tags.filter((tag): tag is string => typeof tag === "string")
    : [];
  return {
    name: memo.id,
    state:
      memo.status === "normal"
        ? "NORMAL"
        : memo.status === "archived"
          ? "ARCHIVED"
          : memo.status === "trashed"
            ? "TRASHED"
            : "DELETED",
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
