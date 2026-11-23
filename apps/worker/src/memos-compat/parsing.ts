/**
 * Pure parsing cores shared by the Memos compatibility surfaces
 * (routes/memos-api.ts, routes/memos-current/*, routes/memos-connect/*).
 *
 * The `parse*` helpers return `null`/`undefined` for invalid input instead of
 * throwing: callers can treat that as "absent" or map it to their own error
 * envelope. The `compat*` helpers are for the surfaces that share the single
 * CompatValidationError: they turn a failed parse into the canonical 400
 * validation error, so the adapter handlers never re-implement the throw.
 * The normalization logic itself is verified-identical across surfaces.
 */

import { CompatValidationError } from "./errors";

const MEMOS_VISIBILITIES = ["private", "protected", "public"] as const;

/**
 * Visibility string to the legacy lowercase triple. Absent input defaults to
 * PRIVATE, matching both surfaces' previous `value ?? "PRIVATE"` behavior.
 */
export function parseMemosVisibility(
  value: unknown,
): (typeof MEMOS_VISIBILITIES)[number] | null {
  if (value === undefined || value === null) return "private";
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  if (MEMOS_VISIBILITIES.includes(normalized as never)) {
    return normalized as (typeof MEMOS_VISIBILITIES)[number];
  }
  return null;
}

/** Relation type to the legacy lowercase pair; absent input defaults to REFERENCE. */
export function parseMemosRelationType(value: unknown) {
  if (value === undefined || value === null) return "reference";
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  if (normalized === "reference" || normalized === "comment") {
    return normalized;
  }
  return null;
}

/**
 * Page-size core: accepts anything `Number()` accepts, requires a positive
 * integer, and performs no clamping — each surface applies its own ceiling
 * (current Memos caps at 100, Connect at 1000) and its own default.
 */
export function parseMemosPageSize(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

/**
 * Comma-separated field-mask splitting used by update paths. An empty result
 * means "updateMask is required" to the caller.
 */
export function splitUpdateMaskFields(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
}

export type MemosOrderBy =
  | "created_at asc"
  | "created_at desc"
  | "updated_at asc"
  | "updated_at desc";

/**
 * Memo list order core shared by the current REST, Connect, and MCP surfaces.
 * Accepts every wire spelling of the two domain orders: the protobuf-JSON
 * aliases (create_time/update_time), the legacy snake_case columns
 * (created_at/updated_at), their historical *_time spellings, and the
 * user-facing display_time alias that third-party sync clients (e.g.
 * Obsidian memos-sync) send for creation order. Returns null for anything
 * else; each surface maps that to its own error envelope.
 */
export function parseMemosOrderBy(value: string): MemosOrderBy | null {
  const match =
    /^(create_time|update_time|display_time|created_at|created_time|updated_at|updated_time)\s+(asc|desc)$/i.exec(
      value.trim(),
    );
  if (!match) return null;
  const field = match[1]?.toLowerCase().startsWith("update")
    ? "updated_at"
    : "created_at";
  const direction = match[2]?.toLowerCase() === "asc" ? "asc" : "desc";
  return `${field} ${direction}`;
}

/**
 * Memo state core: maps the current-Memos State enum (case-insensitive, so
 * both the proto spelling and lowercase legacy statuses are accepted) onto
 * the domain status values. STATE_UNSPECIFIED, empty, and unknown values
 * return undefined — callers decide whether that means "no state" (list
 * queries) or an error (explicit update masks).
 */
export function parseMemosState(
  value: unknown,
): "normal" | "archived" | "trashed" | "deleted" | undefined {
  if (typeof value !== "string") return undefined;
  switch (value.trim().toUpperCase()) {
    case "NORMAL":
      return "normal";
    case "ARCHIVED":
      return "archived";
    case "TRASHED":
      return "trashed";
    case "DELETED":
      return "deleted";
    default:
      return undefined;
  }
}

function describeUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === undefined) return String(value);
  try {
    return JSON.stringify(value) ?? typeof value;
  } catch {
    return typeof value;
  }
}

/** Visibility to the legacy lowercase triple, failing closed on unknown input. */
export function compatMemoVisibility(
  value: unknown,
): "private" | "protected" | "public" {
  const normalized = parseMemosVisibility(value);
  if (!normalized) {
    throw new CompatValidationError(
      `Unsupported memo visibility: ${describeUnknown(value)}`,
    );
  }
  return normalized;
}

/** Relation type to the legacy lowercase pair, failing closed on unknown input. */
export function compatMemoRelationType(
  value: unknown,
): "reference" | "comment" {
  const normalized = parseMemosRelationType(value);
  if (!normalized) {
    throw new CompatValidationError(
      `Unsupported memo relation type: ${describeUnknown(value)}`,
    );
  }
  return normalized;
}
