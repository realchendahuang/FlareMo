import type {
  FlareMoDb,
  MemberRemovalJobRow,
  NewMemberRemovalJobRow,
} from "@flaremo/db";
import { memberRemovalJobs } from "@flaremo/db";
import { and, desc, eq, sql } from "drizzle-orm";

export type MemberRemovalJobStatus =
  | "queued"
  | "removing"
  | "failed"
  | "completed";

/**
 * The D1 status enum predates dead-letter handling, so exhausted retries stay
 * in `failed` and are marked `phase: "dead"`. Retryable failures go back to
 * `queued` for the Queue redelivery or the cron recovery sweep.
 */
export const MEMBER_REMOVAL_MAX_ATTEMPTS = 3;
export type MemberRemovalFailureOutcome = "queued" | "dead";

export async function createMemberRemovalJob(
  db: FlareMoDb,
  memberId: string,
  requestedBy: string,
) {
  const now = new Date().toISOString();
  const row: NewMemberRemovalJobRow = {
    id: crypto.randomUUID(),
    memberId,
    requestedBy,
    status: "queued",
    phase: "created",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(memberRemovalJobs).values(row);
  return row;
}

export async function getMemberRemovalJob(db: FlareMoDb, id: string) {
  return db
    .select()
    .from(memberRemovalJobs)
    .where(eq(memberRemovalJobs.id, id))
    .get();
}

export async function listMemberRemovalJobs(db: FlareMoDb, memberId?: string) {
  return db
    .select()
    .from(memberRemovalJobs)
    .where(memberId ? eq(memberRemovalJobs.memberId, memberId) : undefined)
    .orderBy(desc(memberRemovalJobs.createdAt))
    .limit(50)
    .all();
}

export async function listQueuedMemberRemovalJobs(db: FlareMoDb) {
  return db
    .select()
    .from(memberRemovalJobs)
    .where(eq(memberRemovalJobs.status, "queued"))
    .orderBy(desc(memberRemovalJobs.createdAt))
    .limit(20)
    .all();
}

/** Requeue interrupted executions after a bounded lease window. */
export async function requeueStaleMemberRemovalJobs(
  db: FlareMoDb,
  now = Date.now(),
  leaseMs = 15 * 60_000,
) {
  const rows = await db
    .select()
    .from(memberRemovalJobs)
    .where(eq(memberRemovalJobs.status, "removing"))
    .all();
  const stale = rows.filter((row) => now - Date.parse(row.updatedAt) > leaseMs);
  const nowIso = new Date(now).toISOString();
  for (const row of stale) {
    const exhausted = (row.attempts ?? 0) >= MEMBER_REMOVAL_MAX_ATTEMPTS;
    await updateMemberRemovalJob(db, row.id, {
      status: exhausted ? "failed" : "queued",
      phase: exhausted ? "dead" : "recovered",
      errorCode: exhausted
        ? "worker_interrupted_exhausted"
        : "worker_interrupted",
      errorMessage: exhausted
        ? "Execution lease expired after all retry attempts"
        : "Recovered after execution lease expired",
      completedAt: exhausted ? nowIso : null,
    });
  }
  return stale.length;
}

/** Fetch exactly the queued jobs requested by a Queue batch. */
export async function getQueuedMemberRemovalJobsByIds(
  db: FlareMoDb,
  ids: string[],
) {
  if (ids.length === 0) return [];
  const rows = await Promise.all(ids.map((id) => getMemberRemovalJob(db, id)));
  return rows.filter((job): job is MemberRemovalJobRow =>
    Boolean(job && job.status === "queued"),
  );
}

export async function updateMemberRemovalJob(
  db: FlareMoDb,
  id: string,
  patch: Partial<
    Pick<
      MemberRemovalJobRow,
      | "status"
      | "phase"
      | "attempts"
      | "errorCode"
      | "errorMessage"
      | "completedAt"
    >
  >,
) {
  await db
    .update(memberRemovalJobs)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(memberRemovalJobs.id, id));
  return getMemberRemovalJob(db, id);
}

export async function claimMemberRemovalJob(db: FlareMoDb, id: string) {
  const now = new Date().toISOString();
  // Increment at claim time so a crash between claim and failure recording
  // still counts toward the retry budget.
  const result = await db
    .update(memberRemovalJobs)
    .set({
      status: "removing",
      phase: "scheduled_cleanup",
      attempts: sql`${memberRemovalJobs.attempts} + 1`,
      updatedAt: now,
    })
    .where(
      and(eq(memberRemovalJobs.id, id), eq(memberRemovalJobs.status, "queued")),
    );
  return result.meta?.changes === 1;
}

/**
 * Record a failed execution without turning every transient failure into an
 * unrecoverable terminal row. Attempts are counted by claimMemberRemovalJob.
 */
export async function retryOrFailMemberRemovalJob(
  db: FlareMoDb,
  id: string,
  code: string,
  message: string,
): Promise<MemberRemovalFailureOutcome> {
  const job = await getMemberRemovalJob(db, id);
  if (!job) return "dead";
  const exhausted = (job.attempts ?? 0) >= MEMBER_REMOVAL_MAX_ATTEMPTS;
  const nowIso = new Date().toISOString();
  await updateMemberRemovalJob(db, id, {
    status: exhausted ? "failed" : "queued",
    phase: exhausted ? "dead" : "retrying",
    errorCode: code,
    errorMessage: message.slice(0, 500),
    completedAt: exhausted ? nowIso : null,
  });
  return exhausted ? "dead" : "queued";
}

/** Backwards-compatible failure hook used by admin and reconciliation paths. */
export async function failMemberRemovalJob(
  db: FlareMoDb,
  id: string,
  code: string,
  message: string,
) {
  return retryOrFailMemberRemovalJob(db, id, code, message);
}
