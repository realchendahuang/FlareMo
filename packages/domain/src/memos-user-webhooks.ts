import {
  type FlareMoDb,
  type MemosWebhookRow,
  memosWebhooks,
  type UserRow,
} from "@flaremo/db";
import { and, asc, eq } from "drizzle-orm";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { parseUserChildResourceName } from "./memos-user-shared";

const MAX_WEBHOOK_DISPLAY_NAME_LENGTH = 256;
const MAX_WEBHOOK_URL_LENGTH = 2_048;

export type UserWebhookDto = {
  name: string;
  url: string;
  displayName: string;
  createTime: string;
  updateTime: string;
  signingSecretSet: boolean;
};

export type CreateUserWebhookInput = {
  url: string;
  displayName?: string;
  signingSecret?: string;
};

export type UpdateUserWebhookInput = {
  name: string;
  url?: string;
  displayName?: string;
  signingSecret?: string;
  updateMask?: string[];
};

export function userWebhookName(user: UserRow, id: string) {
  return `${user.id}/webhooks/${id}`;
}

export async function listUserWebhooks(
  db: FlareMoDb,
  user: UserRow,
): Promise<UserWebhookDto[]> {
  const rows = await db
    .select()
    .from(memosWebhooks)
    .where(eq(memosWebhooks.userId, user.id))
    .orderBy(asc(memosWebhooks.createdAt), asc(memosWebhooks.id));
  return rows.map((row) => userWebhookToDto(user, row));
}

export async function createUserWebhook(
  db: FlareMoDb,
  user: UserRow,
  input: CreateUserWebhookInput,
): Promise<UserWebhookDto> {
  const url = validateWebhookUrl(input.url);
  const displayName = validateWebhookDisplayName(input.displayName ?? "");
  const signingSecret = normalizeSigningSecret(input.signingSecret, true);
  const now = new Date().toISOString();
  const row = {
    id: createWebhookId(),
    userId: user.id,
    url,
    displayName,
    signingSecret,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await db.insert(memosWebhooks).values(row);
  } catch (error) {
    // Only an id collision maps to ConflictError; unrelated failures keep
    // their real shape instead of being reported as "conflict".
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("UNIQUE constraint failed: memos_webhooks.id")) {
      throw new ConflictError("Failed to create webhook");
    }
    throw error;
  }
  return userWebhookToDto(user, row);
}

export async function updateUserWebhook(
  db: FlareMoDb,
  user: UserRow,
  input: UpdateUserWebhookInput,
): Promise<UserWebhookDto> {
  const id = parseUserChildResourceName(input.name, user, "webhooks");
  const existing = await getWebhookRow(db, user, id);
  if (!existing) throw new NotFoundError("Webhook not found");
  const updateMask = normalizeUpdateMask(input.updateMask);
  const fields = updateMask ?? ["url", "display_name", "signing_secret"];
  const updates: Partial<
    Pick<MemosWebhookRow, "url" | "displayName" | "signingSecret">
  > = {};

  for (const field of fields) {
    switch (field) {
      case "url":
        updates.url = validateWebhookUrl(input.url ?? existing.url);
        break;
      case "display_name":
        updates.displayName = validateWebhookDisplayName(
          input.displayName ?? existing.displayName,
        );
        break;
      case "signing_secret":
        // An updateMask entry with no value is a no-op for this field; an
        // explicit empty string is what clears the secret.
        updates.signingSecret =
          input.signingSecret === undefined
            ? existing.signingSecret
            : normalizeSigningSecret(input.signingSecret, false);
        break;
      default:
        throw new ValidationError(`Unsupported webhook update field: ${field}`);
    }
  }

  const updatedAt = new Date().toISOString();
  await db
    .update(memosWebhooks)
    .set({ ...updates, updatedAt })
    .where(
      and(eq(memosWebhooks.id, existing.id), eq(memosWebhooks.userId, user.id)),
    );
  const updated = await getWebhookRow(db, user, id);
  if (!updated) throw new NotFoundError("Webhook not found after update");
  return userWebhookToDto(user, updated);
}

export async function deleteUserWebhook(
  db: FlareMoDb,
  user: UserRow,
  name: string,
): Promise<void> {
  const id = parseUserChildResourceName(name, user, "webhooks");
  const deleted = await db
    .delete(memosWebhooks)
    .where(and(eq(memosWebhooks.id, id), eq(memosWebhooks.userId, user.id)))
    .returning({ id: memosWebhooks.id });
  if (!deleted[0]) throw new NotFoundError("Webhook not found");
}

export async function getUserWebhookSigningSecret(
  db: FlareMoDb,
  user: UserRow,
  name: string,
): Promise<string> {
  const id = parseUserChildResourceName(name, user, "webhooks");
  const row = await getWebhookRow(db, user, id);
  if (!row) throw new NotFoundError("Webhook not found");
  return row.signingSecret;
}

function userWebhookToDto(user: UserRow, row: MemosWebhookRow): UserWebhookDto {
  return {
    name: userWebhookName(user, row.id),
    url: row.url,
    displayName: row.displayName,
    createTime: row.createdAt,
    updateTime: row.updatedAt,
    signingSecretSet: row.signingSecret.length > 0,
  };
}

async function getWebhookRow(
  db: FlareMoDb,
  user: UserRow,
  id: string,
): Promise<MemosWebhookRow | undefined> {
  return (
    (await db
      .select()
      .from(memosWebhooks)
      .where(and(eq(memosWebhooks.id, id), eq(memosWebhooks.userId, user.id)))
      .get()) ?? undefined
  );
}

function validateWebhookUrl(value: string) {
  const url = value.trim();
  if (!url || url.length > MAX_WEBHOOK_URL_LENGTH) {
    throw new ValidationError(
      "Webhook URL is required and must be <= 2048 characters",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError(
      "Webhook URL must be an absolute http or https URL",
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ValidationError("Webhook URL must use http or https");
  }
  if (!parsed.hostname || parsed.username || parsed.password || parsed.hash) {
    throw new ValidationError(
      "Webhook URL contains unsupported credentials or fragment",
    );
  }
  // A trailing dot is the same DNS name (`localhost.`); the URL parser keeps
  // it, so strip it before the literal checks.
  const hostname = parsed.hostname
    .replace(/^\[|\]$/g, "")
    .toLowerCase()
    .replace(/\.+$/, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    isReservedIpLiteral(hostname)
  ) {
    throw new ValidationError(
      "Webhook URL must not target a local or private host",
    );
  }
  return url;
}

function isReservedIpLiteral(hostname: string) {
  if (hostname.includes(":")) {
    // IPv4 embedded in IPv6: `::ffff:127.0.0.1`, and the compressed form the
    // URL parser normalizes it to (`::ffff:7f00:1`), plus the deprecated
    // IPv4-compatible `::127.0.0.1` (`::7f00:1`).
    const dotted = hostname.match(/^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (dotted?.[1]) return isReservedIpv4(dotted[1]);
    const hex = hostname.match(/^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const high = Number.parseInt(hex[1] ?? "0", 16);
      const low = Number.parseInt(hex[2] ?? "0", 16);
      return isReservedIpv4(
        [high >> 8, high & 0xff, low >> 8, low & 0xff].join("."),
      );
    }
    return (
      hostname === "::" ||
      hostname === "::1" ||
      hostname.startsWith("fc") ||
      hostname.startsWith("fd") ||
      hostname.startsWith("fe8") ||
      hostname.startsWith("fe9") ||
      hostname.startsWith("fea") ||
      hostname.startsWith("feb")
    );
  }
  return isReservedIpv4(hostname);
}

function isReservedIpv4(hostname: string) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) {
    return false;
  }
  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) return false;
  const [first = 0, second = 0] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    // Carrier-grade NAT, link-local (cloud metadata), private ranges,
    // benchmarking, and multicast/reserved space.
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

function validateWebhookDisplayName(value: string) {
  const displayName = value.trim();
  if (displayName.length > MAX_WEBHOOK_DISPLAY_NAME_LENGTH) {
    throw new ValidationError("Webhook display name is too long");
  }
  return displayName;
}

function normalizeSigningSecret(value: string | undefined, generate: boolean) {
  const secret = value?.trim() ?? "";
  if (!secret && generate) return generateSigningSecret();
  if (
    secret.length > 512 ||
    [...secret].some((char) => {
      const codePoint = char.codePointAt(0) ?? 0;
      return codePoint < 0x20 || codePoint === 0x7f || codePoint > 0x7e;
    })
  ) {
    throw new ValidationError(
      "Webhook signing secret contains invalid characters",
    );
  }
  if (secret.startsWith("whsec_")) {
    const encoded = secret.slice("whsec_".length);
    if (
      !encoded ||
      encoded.length % 4 === 1 ||
      !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)
    ) {
      throw new ValidationError(
        "Webhook signing secret has invalid whsec_ encoding",
      );
    }
    try {
      if (atob(encoded).length < 24) {
        throw new Error("too short");
      }
    } catch {
      throw new ValidationError(
        "Webhook signing secret has invalid whsec_ encoding",
      );
    }
  }
  return secret;
}

function generateSigningSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `whsec_${btoa(binary)}`;
}

function createWebhookId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function normalizeUpdateMask(value: string[] | undefined) {
  if (!value || value.length === 0) return undefined;
  return value.map((field) => {
    const normalized = field
      .trim()
      .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    if (!["url", "display_name", "signing_secret"].includes(normalized)) {
      throw new ValidationError(`Unsupported webhook update field: ${field}`);
    }
    return normalized as "url" | "display_name" | "signing_secret";
  });
}
