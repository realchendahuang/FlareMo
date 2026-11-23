import type { FlareMoDb } from "@flaremo/db";
import { OWNER_FLAREMO_USER_ID } from "./auth";
import { getStoredSetting, upsertStoredSetting } from "./settings";
import { getFlaremoUserById } from "./users";

/**
 * Instance-level scheduler heartbeat, stored under the owner's settings row
 * (same zero-migration instance-scoped pattern as `flaremo.instance.BRANDING`
 * and `flaremo.instance.PLUGINS`).
 *
 * Only non-sensitive aggregate telemetry is persisted — never step error
 * strings, stack traces, secrets, or user content — so `/api/app/health` can
 * safely expose cron freshness to authenticated callers and monitoring probes.
 */
export const SCHEDULER_HEARTBEAT_SETTING_KEY =
  "flaremo.instance.SCHEDULER_HEARTBEAT";

export type SchedulerHeartbeat = {
  ok: boolean;
  lastRunAt: string;
  scheduledAt: string;
  durationMs: number;
  totalSteps: number;
  failedSteps: number;
};

function isNonNegativeInt(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    Number.isInteger(value)
  );
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    !Number.isNaN(Date.parse(value))
  );
}

export function normalizeSchedulerHeartbeat(
  raw: unknown,
): SchedulerHeartbeat | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (
    typeof record.ok !== "boolean" ||
    !isIsoTimestamp(record.lastRunAt) ||
    !isIsoTimestamp(record.scheduledAt) ||
    !isNonNegativeInt(record.durationMs) ||
    !isNonNegativeInt(record.totalSteps) ||
    !isNonNegativeInt(record.failedSteps)
  ) {
    return null;
  }
  return {
    ok: record.ok,
    lastRunAt: record.lastRunAt,
    scheduledAt: record.scheduledAt,
    durationMs: record.durationMs,
    totalSteps: record.totalSteps,
    failedSteps: record.failedSteps,
  };
}

export async function getSchedulerHeartbeat(
  db: FlareMoDb,
): Promise<SchedulerHeartbeat | null> {
  const owner = await getFlaremoUserById(db, OWNER_FLAREMO_USER_ID);
  if (!owner) return null;
  const stored = await getStoredSetting(
    db,
    owner,
    SCHEDULER_HEARTBEAT_SETTING_KEY,
  );
  return normalizeSchedulerHeartbeat(stored?.value);
}

export async function recordSchedulerHeartbeat(
  db: FlareMoDb,
  heartbeat: SchedulerHeartbeat,
): Promise<SchedulerHeartbeat | null> {
  const normalized = normalizeSchedulerHeartbeat({
    ok: Boolean(heartbeat.ok),
    lastRunAt: heartbeat.lastRunAt,
    scheduledAt: heartbeat.scheduledAt,
    durationMs: Math.max(0, Math.round(heartbeat.durationMs)),
    totalSteps: Math.max(0, Math.trunc(heartbeat.totalSteps)),
    failedSteps: Math.max(0, Math.trunc(heartbeat.failedSteps)),
  });
  if (!normalized) return null;
  const owner = await getFlaremoUserById(db, OWNER_FLAREMO_USER_ID);
  if (!owner) return null;
  await upsertStoredSetting(
    db,
    owner,
    SCHEDULER_HEARTBEAT_SETTING_KEY,
    normalized,
  );
  return normalized;
}
