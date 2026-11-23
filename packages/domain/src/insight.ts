import {
  type CreateMemoInsightInput,
  INSIGHT_DEFAULT_BATCH,
  INSIGHT_EXECUTOR_MAX_LENGTH,
  INSIGHT_MAX_BATCH,
  INSIGHT_MAX_MEMO_IDS,
  INSIGHT_RESULT_MAX_CHARS,
  type MemoInsightDto,
  type MemoInsightInputDto,
  type MemoInsightStatus,
} from "@flaremo/contracts";
import type {
  FlareMoDb,
  MemoInsightInputJson,
  MemoInsightRow,
  UserRow,
} from "@flaremo/db";
import { memoInsights } from "@flaremo/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { NotFoundError, ValidationError } from "./errors";
import { createResourceId, parseResourceName } from "./ids";

/**
 * AI insight task services. See docs/agent-access-design.md §9.
 *
 * FlareMo owns the task contract and the result storage; an external executor
 * (DSH plugin, Workers AI, any agent with a `notes` PAT) pulls pending rows,
 * runs whatever model it has, then writes the result back. Nothing here talks
 * to a model or to memo content: `input` only *references* memos, and the
 * executor reads them through its own credentials, so normal memo visibility
 * rules decide what it can actually see.
 *
 * Everything is scoped by the authoring user. Rows are derived data: they can
 * be deleted and regenerated at any time.
 */

const PENDING_OR_RUNNING = ["pending", "running"] as const;
const TERMINAL_STATUSES = ["done", "failed"] as const;

function nowIso(): string {
  return new Date().toISOString();
}

function toInputDto(
  input: MemoInsightInputJson | null | undefined,
): MemoInsightInputDto {
  const dto: MemoInsightInputDto = {};
  if (input?.memo_ids?.length) dto.memo_ids = [...input.memo_ids];
  if (input?.tag) dto.tag = input.tag;
  if (input?.query) dto.query = input.query;
  return dto;
}

/** Row → wire DTO. `result` is validated as JSON on write, so the cast holds. */
export function insightToDto(row: MemoInsightRow): MemoInsightDto {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    input: toInputDto(row.input),
    result: row.result as MemoInsightDto["result"],
    executor: row.executor,
    error: row.error,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function normalizeInsightId(id: string): string {
  return parseResourceName(id.trim(), "insights");
}

function normalizeExecutor(executor: string | null | undefined): string | null {
  const trimmed = executor?.trim();
  return trimmed ? trimmed.slice(0, INSIGHT_EXECUTOR_MAX_LENGTH) : null;
}

/**
 * Memo ids are stored bare (the `id` field of the memo DTO) so an executor can
 * feed them straight into the memo API. A `memos/` resource name is accepted
 * for callers that already hold one.
 */
function normalizeMemoIds(
  ids: readonly string[] | undefined,
): string[] | undefined {
  if (!ids || ids.length === 0) return undefined;
  if (ids.length > INSIGHT_MAX_MEMO_IDS) {
    throw new ValidationError(
      `An insight can reference at most ${INSIGHT_MAX_MEMO_IDS} memos.`,
    );
  }
  const normalized = new Set<string>();
  for (const raw of ids) {
    const id = raw.trim().replace(/^memos\//, "");
    if (!id) throw new ValidationError("memo_ids cannot contain an empty id.");
    normalized.add(id);
  }
  return [...normalized];
}

/** Validate and canonicalize the JSON an executor wants to store. */
function normalizeResult(result: unknown): unknown {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(result);
  } catch {
    throw new ValidationError("result must be JSON-serializable.");
  }
  if (serialized === undefined) {
    throw new ValidationError("A done insight requires a result.");
  }
  if (serialized.length > INSIGHT_RESULT_MAX_CHARS) {
    throw new ValidationError(
      `result must serialize to at most ${INSIGHT_RESULT_MAX_CHARS} characters.`,
    );
  }
  // Round-trip so only JSON survives (drops undefined-valued keys etc.).
  return JSON.parse(serialized) as unknown;
}

function isTerminal(status: MemoInsightStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

async function requireInsight(
  db: FlareMoDb,
  user: UserRow,
  id: string,
): Promise<MemoInsightRow> {
  const row = await db
    .select()
    .from(memoInsights)
    .where(
      and(
        eq(memoInsights.id, normalizeInsightId(id)),
        eq(memoInsights.userId, user.id),
      ),
    )
    .get();
  if (!row) throw new NotFoundError(`Insight not found: ${id}`);
  return row;
}

// ---------------------------------------------------------------------------
// Create / read / delete
// ---------------------------------------------------------------------------

export async function createInsight(
  db: FlareMoDb,
  user: UserRow,
  input: CreateMemoInsightInput,
): Promise<MemoInsightDto> {
  const memoIds = normalizeMemoIds(input.memo_ids);
  const tag = input.tag?.trim() || undefined;
  const query = input.query?.trim() || undefined;
  if (!memoIds && !tag && !query) {
    throw new ValidationError(
      "Provide at least one of memo_ids, tag or query.",
    );
  }

  const now = nowIso();
  const row = await db
    .insert(memoInsights)
    .values({
      id: createResourceId("insights"),
      userId: user.id,
      kind: input.kind,
      input: {
        ...(memoIds ? { memo_ids: memoIds } : {}),
        ...(tag ? { tag } : {}),
        ...(query ? { query } : {}),
      },
      status: "pending",
      result: null,
      executor: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return insightToDto(row);
}

export async function getInsight(
  db: FlareMoDb,
  user: UserRow,
  id: string,
): Promise<MemoInsightDto> {
  return insightToDto(await requireInsight(db, user, id));
}

/**
 * The executor pull: oldest pending task first. `status` is exposed so a
 * caller can also audit running work (e.g. detect a crashed executor).
 */
export async function listPendingInsights(
  db: FlareMoDb,
  user: UserRow,
  input: { status?: MemoInsightStatus; limit?: number } = {},
): Promise<MemoInsightDto[]> {
  const status = input.status ?? "pending";
  const limit = Math.min(
    Math.max(Math.trunc(input.limit ?? INSIGHT_DEFAULT_BATCH), 1),
    INSIGHT_MAX_BATCH,
  );
  const rows = await db
    .select()
    .from(memoInsights)
    .where(
      and(eq(memoInsights.userId, user.id), eq(memoInsights.status, status)),
    )
    .orderBy(asc(memoInsights.createdAt), asc(memoInsights.id))
    .limit(limit);
  return rows.map(insightToDto);
}

export async function deleteInsight(
  db: FlareMoDb,
  user: UserRow,
  id: string,
): Promise<void> {
  const deleted = await db
    .delete(memoInsights)
    .where(
      and(
        eq(memoInsights.id, normalizeInsightId(id)),
        eq(memoInsights.userId, user.id),
      ),
    )
    .returning({ id: memoInsights.id });
  if (!deleted[0]) throw new NotFoundError(`Insight not found: ${id}`);
}

// ---------------------------------------------------------------------------
// Status transitions (§9.4: pending → running → done | failed)
// ---------------------------------------------------------------------------

/**
 * Claim (`pending → running`), idempotent re-claim, or retry (`failed →
 * pending`, which clears the previous result and error). Terminal rows stay
 * put: `done`/`failed` are first-write-wins so a retried request is harmless.
 * `running → pending` is deliberately not a transition — an executor that
 * crashed mid-run leaves a `running` row visible for the browser to inspect.
 */
export async function updateStatus(
  db: FlareMoDb,
  user: UserRow,
  id: string,
  status: MemoInsightStatus,
  options: { executor?: string | null } = {},
): Promise<MemoInsightDto> {
  const row = await requireInsight(db, user, id);
  if (row.status === status) return insightToDto(row);

  const allowed =
    (row.status === "pending" && status === "running") ||
    (row.status === "failed" && status === "pending");
  if (!allowed) {
    throw new ValidationError(
      `Cannot change insight status from ${row.status} to ${status}.`,
    );
  }

  const patch: Partial<typeof memoInsights.$inferInsert> = {
    status,
    updatedAt: nowIso(),
  };
  if (status === "running") {
    const executor = normalizeExecutor(options.executor);
    if (executor) patch.executor = executor;
  } else {
    // Retry reset: the previous attempt's payload must not survive.
    patch.result = null;
    patch.error = null;
    patch.executor = null;
  }

  const updated = await db
    .update(memoInsights)
    .set(patch)
    .where(
      and(
        eq(memoInsights.id, row.id),
        eq(memoInsights.userId, user.id),
        eq(memoInsights.status, row.status),
      ),
    )
    .returning()
    .get();
  if (!updated) {
    // A concurrent writer moved the row first. Returning the current row keeps
    // the operation idempotent when the race landed on the requested state.
    const current = await requireInsight(db, user, row.id);
    if (current.status === status) return insightToDto(current);
    throw new ValidationError(
      `Cannot change insight status from ${current.status} to ${status}.`,
    );
  }
  return insightToDto(updated);
}

/**
 * Write the result back. Only a `pending`/`running` row is writable; once a
 * row is `done` the first result wins and later writes return it unchanged, so
 * an executor retry after a lost response is safe.
 */
export async function completeInsight(
  db: FlareMoDb,
  user: UserRow,
  id: string,
  input: { result: unknown; executor?: string | null },
): Promise<MemoInsightDto> {
  const row = await requireInsight(db, user, id);
  if (row.status === "done") return insightToDto(row);
  if (isTerminal(row.status)) {
    throw new ValidationError(
      "This insight already failed; reset it to pending before writing a result.",
    );
  }
  if (input.result === undefined || input.result === null) {
    throw new ValidationError("A done insight requires a result.");
  }
  const result = normalizeResult(input.result);
  const executor = normalizeExecutor(input.executor);

  const updated = await db
    .update(memoInsights)
    .set({
      status: "done",
      result,
      executor: executor ?? row.executor,
      error: null,
      updatedAt: nowIso(),
    })
    .where(
      and(
        eq(memoInsights.id, row.id),
        eq(memoInsights.userId, user.id),
        inArray(memoInsights.status, [...PENDING_OR_RUNNING]),
      ),
    )
    .returning()
    .get();
  if (!updated) {
    const current = await requireInsight(db, user, row.id);
    if (current.status === "done") return insightToDto(current);
    throw new ValidationError(
      "This insight already failed; reset it to pending before writing a result.",
    );
  }
  return insightToDto(updated);
}

/**
 * Record a failed run. A row that is already terminal keeps its first verdict,
 * so a stale executor reporting failure cannot overwrite a finished result.
 */
export async function failInsight(
  db: FlareMoDb,
  user: UserRow,
  id: string,
  input: { error?: string | null; executor?: string | null } = {},
): Promise<MemoInsightDto> {
  const row = await requireInsight(db, user, id);
  if (isTerminal(row.status)) return insightToDto(row);

  const executor = normalizeExecutor(input.executor);
  const error = input.error?.trim() || null;

  const updated = await db
    .update(memoInsights)
    .set({
      status: "failed",
      error,
      executor: executor ?? row.executor,
      updatedAt: nowIso(),
    })
    .where(
      and(
        eq(memoInsights.id, row.id),
        eq(memoInsights.userId, user.id),
        inArray(memoInsights.status, [...PENDING_OR_RUNNING]),
      ),
    )
    .returning()
    .get();
  if (!updated) return insightToDto(await requireInsight(db, user, row.id));
  return insightToDto(updated);
}
