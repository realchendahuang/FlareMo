import type {
  EmbeddingTaskRow,
  FlareMoDb,
  MemoRow,
  MemoryItemRow,
} from "@flaremo/db";
import { memoryItems, memos } from "@flaremo/db";
import { and, eq } from "drizzle-orm";
import {
  chunkText,
  chunkVectorIds,
  type EmbeddingProvider,
  embeddingVersion,
  memoTargetNamespace,
  type VectorIndex,
} from "./embedding";
import type { EmbeddingDispatchDeps } from "./embedding-outbox";
import { isCommentMemo } from "./memo-comment-filter";
import { estimateTokenCount } from "./quotas";
import { incrementUsageCounter } from "./usage";

// Delete operations run after the source row is gone (hard delete) or has no
// chunk count stored, so they clear a bounded window of chunk ids. Vectorize
// deleteByIds is a no-op for missing ids, and any residual vectors are still
// filtered out at query time by the D1 re-read, so this is a conservative
// sweep rather than an exact removal.
export const EMBEDDING_MAX_CHUNKS = 256;

/**
 * Attribute a successful embed call to the deployment's monthly budget.
 * Best-effort: metering failures must never fail the indexing task itself.
 */
export function recordEmbeddingUsage(
  db: FlareMoDb,
  userId: string,
  texts: string[],
) {
  return Promise.all([
    incrementUsageCounter(
      db,
      { id: userId },
      "embedding_tokens",
      estimateTokenCount(texts),
    ).catch(() => undefined),
    incrementUsageCounter(db, { id: userId }, "embedding_calls", 1).catch(
      () => undefined,
    ),
  ]);
}

export async function processEmbeddingTask(
  db: FlareMoDb,
  deps: EmbeddingDispatchDeps,
  task: EmbeddingTaskRow,
  nowIso: string,
) {
  if (task.resourceType === "memo") {
    if (task.operation === "relocate") {
      await processMemoRelocateTask(
        db,
        deps.provider,
        deps.memosIndex,
        task,
        nowIso,
      );
      return;
    }
    await processMemoEmbeddingTask(
      db,
      deps.provider,
      deps.memosIndex,
      task,
      nowIso,
    );
  } else {
    await processMemoryEmbeddingTask(
      db,
      deps.provider,
      deps.memoriesIndex,
      task,
      nowIso,
    );
  }
}

async function processMemoEmbeddingTask(
  db: FlareMoDb,
  provider: EmbeddingProvider | null,
  index: VectorIndex | null,
  task: EmbeddingTaskRow,
  nowIso: string,
) {
  const memo = await db
    .select()
    .from(memos)
    .where(and(eq(memos.id, task.resourceId), eq(memos.userId, task.userId)))
    .get();

  // Semantic indexing disabled: leave the resource unindexed and let the task
  // complete so it does not accumulate. FTS5 keyword search is unaffected.
  if (!provider || !index) return;

  // Comments are read under their parent, never retrieved on their own, so
  // they hold no vectors; an edit to one clears any it had.
  const indexing =
    memo !== undefined &&
    (memo.status === "normal" || memo.status === "archived") &&
    !(await isCommentMemo(db, memo.id));

  if (!indexing || !memo) {
    await index.deleteByIds(chunkIdsForMemo(task.resourceId));
    if (memo) {
      await clearMemoEmbedding(db, memo);
    }
    return;
  }

  const chunks = chunkText(memo.content);
  if (chunks.length === 0) {
    // Content emptied while still indexable: drop any previously stored chunk
    // vectors, then record the empty index state.
    await index.deleteByIds(chunkIdsForMemo(memo.id));
    await db
      .update(memos)
      .set({
        embeddingStatus: "indexed",
        embeddingVersion: embeddingVersion(provider.model, provider.dimensions),
        embeddedAt: nowIso,
        embeddingError: null,
        embeddingChunks: 0,
      })
      .where(and(eq(memos.id, memo.id), eq(memos.userId, memo.userId)));
    return;
  }

  const vectors = await provider.embed(chunks);
  await recordEmbeddingUsage(db, task.userId, chunks);
  const ids = chunkVectorIds(memo.id, chunks.length);
  // deleteByIds is index-wide: clear any copies left by a prior visibility
  // state (e.g. the memo was edited after publishing) before writing to the
  // namespace implied by the current visibility, so exactly one copy remains.
  await index.deleteByIds(chunkIdsForMemo(memo.id));
  await index.upsert(
    ids.map((id, index_) => ({
      id,
      values: vectors[index_] ?? [],
      // The namespace follows the memo's visibility at dispatch time; the D1
      // scope at query time stays the authorization boundary either way.
      namespace: memoTargetNamespace(memo.visibility, memo.userId),
      metadata: { memo_id: memo.id, user_id: memo.userId },
    })),
  );

  await db
    .update(memos)
    .set({
      embeddingStatus: "indexed",
      embeddingVersion: embeddingVersion(provider.model, provider.dimensions),
      embeddedAt: nowIso,
      embeddingError: null,
      embeddingChunks: chunks.length,
    })
    .where(and(eq(memos.id, memo.id), eq(memos.userId, memo.userId)));
}

/**
 * Move a memo's vectors to the namespace implied by its current visibility
 * without regenerating embeddings: chunk ids are derived deterministically
 * from the unchanged content, values are read back with getByIds, old copies
 * are deleted (deleteByIds is index-wide), and the values are re-upserted
 * under the target namespace. If read-back finds fewer vectors than chunks
 * (never indexed or partially lost), the chunks are re-embedded instead —
 * content is unchanged, so this is also a self-heal.
 */
async function processMemoRelocateTask(
  db: FlareMoDb,
  provider: EmbeddingProvider | null,
  index: VectorIndex | null,
  task: EmbeddingTaskRow,
  nowIso: string,
) {
  const memo = await db
    .select()
    .from(memos)
    .where(and(eq(memos.id, task.resourceId), eq(memos.userId, task.userId)))
    .get();

  if (!provider || !index) return;

  const indexing =
    memo !== undefined &&
    (memo.status === "normal" || memo.status === "archived");

  if (!indexing || !memo) {
    await index.deleteByIds(chunkIdsForMemo(task.resourceId));
    if (memo) {
      await clearMemoEmbedding(db, memo);
    }
    return;
  }

  const chunks = chunkText(memo.content);
  const targetNamespace = memoTargetNamespace(memo.visibility, memo.userId);

  if (chunks.length === 0) {
    await index.deleteByIds(chunkIdsForMemo(memo.id));
    await db
      .update(memos)
      .set({
        embeddingStatus: "indexed",
        embeddingVersion: embeddingVersion(provider.model, provider.dimensions),
        embeddedAt: nowIso,
        embeddingError: null,
        embeddingChunks: 0,
      })
      .where(and(eq(memos.id, memo.id), eq(memos.userId, memo.userId)));
    return;
  }

  const ids = chunkVectorIds(memo.id, chunks.length);
  // deleteByIds is index-wide (no namespace parameter), so a delete here is
  // safe under either scoping semantic; it clears any stale copy regardless
  // of where a previous write left it. Delete happens BEFORE the upsert —
  // writing first and deleting after could remove the fresh copy if the
  // delete turns out to cross namespaces.
  const stored = await index.getByIds(ids).catch(() => []);
  await index.deleteByIds(chunkIdsForMemo(memo.id));

  let values = stored.length === ids.length ? stored : [];
  if (values.length === 0) {
    const vectors = await provider.embed(chunks);
    await recordEmbeddingUsage(db, task.userId, chunks);
    values = ids.map((id, index_) => ({
      id,
      values: vectors[index_] ?? [],
    }));
  }
  await index.upsert(
    values.map((vector) => ({
      id: vector.id,
      values: vector.values,
      namespace: targetNamespace,
      metadata: { memo_id: memo.id, user_id: memo.userId },
    })),
  );

  await db
    .update(memos)
    .set({
      embeddingStatus: "indexed",
      embeddingVersion: embeddingVersion(provider.model, provider.dimensions),
      embeddedAt: nowIso,
      embeddingError: null,
      embeddingChunks: chunks.length,
    })
    .where(and(eq(memos.id, memo.id), eq(memos.userId, memo.userId)));
}

async function processMemoryEmbeddingTask(
  db: FlareMoDb,
  provider: EmbeddingProvider | null,
  index: VectorIndex | null,
  task: EmbeddingTaskRow,
  nowIso: string,
) {
  const memory = await db
    .select()
    .from(memoryItems)
    .where(
      and(
        eq(memoryItems.id, task.resourceId),
        eq(memoryItems.userId, task.userId),
      ),
    )
    .get();

  if (!provider || !index) return;

  const indexing = memory !== undefined && memory.status === "active";

  if (!indexing || !memory) {
    await index.deleteByIds([memoryIdVector(memory?.id ?? task.resourceId)]);
    if (memory) {
      await clearMemoryEmbedding(db, memory);
    }
    return;
  }

  const vectors = await provider.embed([memory.content]);
  await recordEmbeddingUsage(db, task.userId, [memory.content]);
  await index.upsert([
    {
      id: memoryIdVector(memory.id),
      values: vectors[0] ?? [],
      metadata: { memory_id: memory.id, user_id: memory.userId },
      namespace: task.userId,
    },
  ]);

  await db
    .update(memoryItems)
    .set({
      embeddingStatus: "indexed",
      embeddingVersion: embeddingVersion(provider.model, provider.dimensions),
      embeddedAt: nowIso,
      embeddingError: null,
      embeddingChunks: 1,
    })
    .where(
      and(eq(memoryItems.id, memory.id), eq(memoryItems.userId, memory.userId)),
    );
}

async function clearMemoEmbedding(db: FlareMoDb, memo: MemoRow) {
  await db
    .update(memos)
    .set({
      embeddingStatus: "not_indexed",
      embeddingVersion: null,
      embeddedAt: null,
      embeddingError: null,
      embeddingChunks: null,
    })
    .where(and(eq(memos.id, memo.id), eq(memos.userId, memo.userId)));
}

async function clearMemoryEmbedding(db: FlareMoDb, memory: MemoryItemRow) {
  await db
    .update(memoryItems)
    .set({
      embeddingStatus: "not_indexed",
      embeddingVersion: null,
      embeddedAt: null,
      embeddingError: null,
      embeddingChunks: null,
    })
    .where(
      and(eq(memoryItems.id, memory.id), eq(memoryItems.userId, memory.userId)),
    );
}

/** All possible vector ids for a memo (deleteByIds no-ops missing ids). */
export function chunkIdsForMemo(memoId: string): string[] {
  return Array.from(
    { length: EMBEDDING_MAX_CHUNKS },
    (_, index) => `${memoId}#chunks/${index}`,
  );
}

/** Memories are atomic conclusions (no chunking): vector id = resource id. */
export function memoryIdVector(memoryId: string): string {
  // Memories are atomic conclusions (no chunking), so the vector id is the
  // resource id itself.
  return memoryId;
}
