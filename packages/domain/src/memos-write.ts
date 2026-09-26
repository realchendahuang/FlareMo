import type { CreateMemoInput, UpdateMemoInput } from "@flaremo/contracts";
import type { FlareMoDb, MemoRow } from "@flaremo/db";
import { memoRevisions, memos, memoTags } from "@flaremo/db";
import { and, eq } from "drizzle-orm";
import { insertEmbeddingTask } from "./embedding-outbox";
import { ConflictError, ForbiddenError } from "./errors";
import { createResourceId } from "./ids";
import {
  assertMemoContentSize,
  hasUncheckedTaskList,
  normalizeMemoClientId,
  normalizeMemoPayload,
  resolveMemoTeamId,
} from "./memos-helpers";
import { getMemoByClientId, getMemoById } from "./memos-read";
import { insertMemosSseEvent } from "./memos-sse";
import { findMentionedUsers, insertMemoNotification } from "./memos-user";
import { insertMemosWebhookEvent } from "./memos-webhooks";
import { assertMemoCountQuota, type QuotaScope } from "./quotas";
import { pruneMemoRevisions } from "./revisions";
import { extractTags, normalizeMemoTags } from "./tags";
import {
  assertCanEditMemo,
  assertCanGovernMemo,
  canReadMemo,
  isActiveTeamMember,
  type TeamViewer,
} from "./team-permissions";

export async function createMemo(
  db: FlareMoDb,
  user: TeamViewer,
  input: CreateMemoInput,
  scope?: QuotaScope,
): Promise<MemoRow> {
  if (!isActiveTeamMember(user)) {
    throw new ForbiddenError("Removed members cannot create memos.");
  }
  assertMemoContentSize(input.content);
  await assertMemoCountQuota(db, scope?.userLimits, user.id);
  const now = new Date().toISOString();
  const payload = normalizeMemoPayload(input.payload);
  const clientId = normalizeMemoClientId(payload.client_id);
  if (clientId) {
    payload.client_id = clientId;
    const existing = await getMemoByClientId(db, user.id, clientId);
    if (existing) return existing;
  }
  const tags = normalizeMemoTags(payload.tags ?? extractTags(input.content));
  payload.tags = tags;
  // The task-list flags are domain truth, not client courtesy: recomputing
  // keeps every write path (web, IM, agents) stamped even when the client
  // sends no property at all.
  payload.property = {
    ...payload.property,
    has_incomplete_tasks: hasUncheckedTaskList(input.content),
  };
  const row = {
    id: createResourceId("memos"),
    userId: user.id,
    teamId: resolveMemoTeamId(user, input.visibility),
    content: input.content,
    visibility: input.visibility,
    status: "normal" as const,
    pinned: false,
    source: input.source,
    clientId,
    payload,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  const eventStatement = insertMemosSseEvent(db, {
    type: "memo.created",
    name: row.id,
    visibility: row.visibility,
    teamId: row.teamId,
    creatorId: user.id,
    createdAt: now,
  });
  const webhookEventStatement = insertMemosWebhookEvent(db, {
    receiverId: user.id,
    activityType: "memos.memo.created",
    creator: user,
    memo: row,
    createdAt: now,
  });
  const notificationStatements = await buildMemoMentionNotifications(db, {
    memoId: row.id,
    relatedMemoId: null,
    sourceEventId: row.id,
    senderId: user.id,
    content: row.content,
    previousContent: "",
    teamId: row.teamId,
    visibility: row.visibility,
    previousVisibility: "private",
    createdAt: now,
  });

  const insertMemo = db.insert(memos).values(row);
  const embeddingTaskStatement = insertEmbeddingTask(db, {
    userId: user.id,
    resourceType: "memo",
    resourceId: row.id,
    operation: "index",
    createdAt: now,
  });
  try {
    if (tags.length > 0) {
      await db.batch([
        insertMemo,
        db.insert(memoTags).values(
          tags.map((tag) => ({
            memoId: row.id,
            userId: user.id,
            tag,
            createdAt: now,
          })),
        ),
        eventStatement,
        webhookEventStatement,
        embeddingTaskStatement,
        ...notificationStatements,
      ]);
    } else {
      await db.batch([
        insertMemo,
        eventStatement,
        webhookEventStatement,
        embeddingTaskStatement,
        ...notificationStatements,
      ]);
    }
  } catch (error) {
    // A second tab can submit the same queued entry at the same time. The
    // unique `(user_id, client_id)` index is the final idempotency boundary.
    if (clientId) {
      const existing = await getMemoByClientId(db, user.id, clientId);
      if (existing) return existing;
    }
    throw error;
  }
  return getMemoById(db, user, row.id, { includeDeleted: true });
}

export async function updateMemo(
  db: FlareMoDb,
  user: TeamViewer,
  id: string,
  input: UpdateMemoInput,
): Promise<MemoRow> {
  const existing = await getMemoById(db, user, id, { includeDeleted: true });
  // Content edits and state governance are different powers with different
  // holders: only the author edits (docs/content-authority.md), administrators
  // and the owner govern. A patch touching both is only accepted for a viewer
  // holding both rights.
  if (
    input.content !== undefined ||
    input.payload !== undefined ||
    input.pinned !== undefined ||
    input.visibility !== undefined
  ) {
    assertCanEditMemo(user, existing);
  }
  if (input.status !== undefined) {
    assertCanGovernMemo(user, existing);
  }
  // Only the incoming content is re-validated; content inherited from the
  // persisted row is left untouched so legacy oversized rows stay updatable.
  if (input.content !== undefined) {
    assertMemoContentSize(input.content);
  }
  const now = new Date().toISOString();
  const status = input.status;
  const metadataChanged =
    input.content !== undefined || input.payload !== undefined;
  const nextContent = input.content ?? existing.content;
  const nextPayload =
    input.payload !== undefined
      ? normalizeMemoPayload(input.payload)
      : normalizeMemoPayload(existing.payload);
  const persistedClientId =
    existing.clientId ?? normalizeMemoClientId(existing.payload.client_id);
  const requestedClientId =
    input.payload !== undefined
      ? normalizeMemoClientId(nextPayload.client_id)
      : undefined;
  // payload.client_id stays mutable like any other payload field. A payload
  // update that omits it preserves the previous creation id so the
  // idempotency key is not silently dropped.
  const nextClientId = requestedClientId ?? persistedClientId;
  if (nextClientId && nextClientId !== existing.clientId) {
    const owner = await getMemoByClientId(db, existing.userId, nextClientId);
    if (owner && owner.id !== existing.id) {
      throw new ConflictError("Memo client_id is already in use");
    }
  }
  if (input.payload !== undefined && nextClientId) {
    nextPayload.client_id = nextClientId;
  }
  // Tags are domain truth re-derived from the new content on every edit, so
  // an edit that adds/removes `#tags` updates them. But when the caller sends
  // an explicit payload (import overwrite, revision restore, API clients
  // managing tags outside the content), its tags win — content-derived tags
  // would drop tags the content itself does not spell out.
  const tags = metadataChanged
    ? normalizeMemoTags(
        input.payload !== undefined
          ? (nextPayload.tags ?? extractTags(nextContent))
          : extractTags(nextContent),
      )
    : [];
  if (metadataChanged) {
    nextPayload.tags = tags;
    nextPayload.property = {
      ...nextPayload.property,
      has_incomplete_tasks: hasUncheckedTaskList(nextContent),
    };
  }

  const shouldCreateRevision =
    input.content !== undefined ||
    input.visibility !== undefined ||
    input.payload !== undefined;
  const revisionId = shouldCreateRevision
    ? createResourceId("revisions")
    : undefined;
  const nextVisibility = input.visibility ?? existing.visibility;
  // Publishing into the team (or unpublishing to personal) follows the
  // visibility transition. Moving another author's memo to personal keeps the
  // author as owner of the now-personal memo.
  const nextTeamId =
    input.visibility !== undefined && input.visibility !== existing.visibility
      ? resolveMemoTeamId(user, input.visibility)
      : existing.teamId;
  const nextMemo = {
    ...existing,
    content: nextContent,
    teamId: nextTeamId,
    visibility: nextVisibility,
    status: status ?? existing.status,
    pinned: input.pinned ?? existing.pinned,
    payload: metadataChanged ? nextPayload : existing.payload,
    updatedAt: now,
    deletedAt:
      status === "trashed" || status === "deleted"
        ? now
        : status === "normal" || status === "archived"
          ? null
          : existing.deletedAt,
  };
  const webhookEventStatement = insertMemosWebhookEvent(db, {
    receiverId: existing.userId,
    activityType:
      status === "deleted" ? "memos.memo.deleted" : "memos.memo.updated",
    creator: user,
    memo: nextMemo,
    createdAt: now,
  });
  const notificationStatements =
    input.content !== undefined && nextContent !== existing.content
      ? await buildMemoMentionNotifications(db, {
          memoId: existing.id,
          relatedMemoId: null,
          sourceEventId: revisionId ?? `${existing.id}:${now}`,
          senderId: user.id,
          content: nextContent,
          previousContent:
            existing.visibility === "private" ? "" : existing.content,
          teamId: nextTeamId,
          visibility: nextVisibility,
          previousVisibility: existing.visibility,
          createdAt: now,
        })
      : [];
  const patch = {
    ...(input.content !== undefined ? { content: input.content } : {}),
    ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
    ...(nextTeamId !== existing.teamId ? { teamId: nextTeamId } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
    ...(nextClientId !== existing.clientId ? { clientId: nextClientId } : {}),
    ...(metadataChanged ? { payload: nextPayload } : {}),
    updatedAt: now,
    ...(status === "trashed" || status === "deleted" ? { deletedAt: now } : {}),
    ...(status === "normal" || status === "archived"
      ? { deletedAt: null }
      : {}),
  };
  const eventStatement = insertMemosSseEvent(db, {
    type: status === "deleted" ? "memo.deleted" : "memo.updated",
    name: existing.id,
    visibility: input.visibility ?? existing.visibility,
    teamId: nextTeamId,
    creatorId: existing.userId,
    createdAt: now,
  });

  // Re-index whenever the indexed text or the indexable status changes. The
  // dispatch step re-reads the latest row and decides index vs delete, so a
  // status-only transition (archive/trash/restore) is handled by one task.
  // A visibility change moves the vectors between the personal and team
  // namespaces instead: relocate re-derives chunk ids and copies the stored
  // values without regenerating embeddings.
  const visibilityChanged =
    input.visibility !== undefined && input.visibility !== existing.visibility;
  const embeddingTaskStatement =
    input.content !== undefined || input.status !== undefined
      ? insertEmbeddingTask(db, {
          userId: existing.userId,
          resourceType: "memo",
          resourceId: existing.id,
          operation: "reindex",
          createdAt: now,
        })
      : visibilityChanged
        ? insertEmbeddingTask(db, {
            userId: existing.userId,
            resourceType: "memo",
            resourceId: existing.id,
            operation: "relocate",
            createdAt: now,
          })
        : undefined;

  // Optimistic concurrency: the update only lands when the row still carries
  // the updatedAt snapshot this decision was made from. A concurrent edit
  // moves the column, the statement affects zero rows, and the caller gets a
  // conflict instead of a silent lost update. The revision statement still
  // snapshots the previous state either way; it is inert history.
  const updateStatement = db
    .update(memos)
    .set(patch)
    .where(
      and(
        eq(memos.id, id),
        eq(memos.userId, existing.userId),
        eq(memos.updatedAt, existing.updatedAt),
      ),
    )
    .returning({ id: memos.id });
  const revisionStatement = db.insert(memoRevisions).values({
    id: revisionId ?? createResourceId("revisions"),
    memoId: existing.id,
    userId: existing.userId,
    content: existing.content,
    visibility: existing.visibility,
    payload: existing.payload,
    createdAt: now,
  });
  const deleteTagsStatement = db
    .delete(memoTags)
    .where(and(eq(memoTags.memoId, id), eq(memoTags.userId, existing.userId)));
  // The conditional update is always the batch's first statement so its
  // returned rows can be inspected for the optimistic-concurrency check.
  const restStatements = [
    eventStatement,
    webhookEventStatement,
    ...(embeddingTaskStatement ? [embeddingTaskStatement] : []),
    ...notificationStatements,
  ];
  const runBatch = async (statements: unknown[]) => {
    try {
      return (await db.batch(
        statements as unknown as Parameters<FlareMoDb["batch"]>[0],
      )) as unknown as unknown[];
    } catch (error) {
      // A concurrent createMemo may claim the same client_id after this
      // function's pre-check; surface the unique-index race as a conflict
      // instead of a bare D1 error.
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("UNIQUE constraint failed: memos.client_id")) {
        throw new ConflictError("Memo client_id is already in use");
      }
      throw error;
    }
  };
  let batchResults: unknown[];
  if (metadataChanged && tags.length > 0 && shouldCreateRevision) {
    batchResults = await runBatch([
      updateStatement,
      revisionStatement,
      deleteTagsStatement,
      db.insert(memoTags).values(
        tags.map((tag) => ({
          memoId: id,
          userId: existing.userId,
          tag,
          createdAt: now,
        })),
      ),
      ...restStatements,
    ]);
  } else if (metadataChanged && shouldCreateRevision) {
    batchResults = await runBatch([
      updateStatement,
      revisionStatement,
      deleteTagsStatement,
      ...restStatements,
    ]);
  } else if (shouldCreateRevision) {
    batchResults = await runBatch([
      updateStatement,
      revisionStatement,
      ...restStatements,
    ]);
  } else {
    batchResults = await runBatch([updateStatement, ...restStatements]);
  }

  const updatedRows = batchResults[0] as { id: string }[] | undefined;
  if (!updatedRows || updatedRows.length === 0) {
    throw new ConflictError(
      "Memo was modified concurrently; reload it and try again.",
    );
  }

  void pruneMemoRevisions(db, id).catch(() => undefined);

  return getMemoById(db, user, id, { includeDeleted: true });
}

type MemoMentionNotificationInput = {
  memoId: string;
  relatedMemoId: string | null;
  sourceEventId: string;
  senderId: string;
  content: string;
  previousContent: string;
  teamId: string | null;
  visibility: MemoRow["visibility"];
  previousVisibility: MemoRow["visibility"];
  createdAt: string;
};

async function buildMemoMentionNotifications(
  db: FlareMoDb,
  input: MemoMentionNotificationInput,
) {
  if (input.visibility === "private") return [];
  const previousUsers =
    input.previousVisibility === "private"
      ? []
      : await findMentionedUsers(db, input.previousContent, [input.senderId]);
  const previousUserIds = new Set(previousUsers.map((user) => user.id));
  const mentionedUsers = await findMentionedUsers(db, input.content, [
    input.senderId,
  ]);
  // A mention never outruns read access: only mentioned users who may read
  // the memo receive a notification (and its content snippet).
  const memoView = {
    id: input.memoId,
    userId: input.senderId,
    teamId: input.teamId,
    visibility: input.visibility,
    status: "normal" as const,
  };
  return mentionedUsers
    .filter((user) => !previousUserIds.has(user.id))
    .filter((user) => canReadMemo(user, memoView as MemoRow))
    .map((user) =>
      insertMemoNotification(db, {
        receiverId: user.id,
        senderId: input.senderId,
        type: "memo_mention",
        sourceEventId: input.sourceEventId,
        memoId: input.memoId,
        relatedMemoId: input.relatedMemoId,
        createdAt: input.createdAt,
      }),
    );
}
