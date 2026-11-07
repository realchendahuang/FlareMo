import {
  type FlareMoDb,
  type MemosWebhookRow,
  memosWebhooks,
  type UserRow,
} from "@flaremo/db";
import { and, asc, eq } from "drizzle-orm";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { parseUserChildResourceName } from "./memos-user-shared";
import { OutboundFetchError, validateOutboundUrl } from "./memos-webhooks";

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
  try {
    validateOutboundUrl(url, {
      allowFragment: false,
      maxUrlLength: MAX_WEBHOOK_URL_LENGTH,
    });
  } catch (error) {
    if (!(error instanceof OutboundFetchError)) throw error;
    if (error.code === "unsupported_protocol") {
      throw new ValidationError("Webhook URL must use http or https");
    }
    if (error.code === "blocked_host") {
      throw new ValidationError(
        "Webhook URL must not target a local or private host",
      );
    }
    if (error.message === "URL is too long") {
      throw new ValidationError(
        "Webhook URL is required and must be <= 2048 characters",
      );
    }
    if (error.message === "URL fragments are not allowed") {
      throw new ValidationError(
        "Webhook URL contains unsupported credentials or fragment",
      );
    }
    throw new ValidationError(
      "Webhook URL must be an absolute http or https URL",
    );
  }
  return url;
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
