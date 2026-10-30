import type { FlareMoDb } from "@flaremo/db";
import { memoryItems, memos } from "@flaremo/db";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import {
  chunkText,
  chunkVectorIds,
  type EmbeddingProvider,
  embeddingVersion,
  memoTargetNamespace,
  type VectorIndex,
} from "./embedding";
import { recordEmbeddingUsage } from "./embedding-processors";
import { notComment } from "./memo-comment-filter";

// ---------------------------------------------------------------------------
// Full rebuild
// ---------------------------------------------------------------------------

const REBUILD_PAGE_SIZE = 200;

export type RebuildEmbeddingDeps = {
  provider: EmbeddingProvider;
  memosIndex: VectorIndex;
  memoriesIndex: VectorIndex;
  onProgress?: (done: number, total: number) => void;
};

/**
 * Rebuild the derived Vectorize indexes from D1. Idempotent and repeatable:
 * the source of truth never changes, and a stale or corrupt Vectorize index
 * can always be reconstructed from D1. Used for first-run backfill, model or
 * dimension changes, and manual recovery after index corruption.
 */
export async function rebuildEmbeddingIndexes(
  db: FlareMoDb,
  deps: RebuildEmbeddingDeps,
) {
  const version = embeddingVersion(
    deps.provider.model,
    deps.provider.dimensions,
  );

  // Memos: index every normal/archived memo, chunked.
  let total = 0;
  let done = 0;
  for await (const page of paginateMemos(db)) {
    total += page.length;
  }
  for await (const page of paginateMemos(db)) {
    for (const memo of page) {
      const chunks = chunkText(memo.content);
      if (chunks.length > 0) {
        const vectors = await deps.provider.embed(chunks);
        // Rebuild is a recovery path and is metered but never blocked: a
        // spent budget pauses background indexing, not index repair.
        await recordEmbeddingUsage(db, memo.userId, chunks);
        const ids = chunkVectorIds(memo.id, chunks.length);
        await deps.memosIndex.upsert(
          ids.map((id, index_) => ({
            id,
            values: vectors[index_] ?? [],
            // Partition by visibility, matching the write path.
            namespace: memoTargetNamespace(memo.visibility, memo.userId),
            metadata: { memo_id: memo.id, user_id: memo.userId },
          })),
        );
      }
      await db
        .update(memos)
        .set({
          embeddingStatus: "indexed",
          embeddingVersion: version,
          embeddedAt: new Date().toISOString(),
          embeddingError: null,
          embeddingChunks: chunks.length,
        })
        .where(and(eq(memos.id, memo.id), eq(memos.userId, memo.userId)));
      done += 1;
      deps.onProgress?.(done, total);
    }
  }

  // Memories: index every active memory as a single atomic vector.
  const activeMemories = await db
    .select()
    .from(memoryItems)
    .where(eq(memoryItems.status, "active"));
  for (const memory of activeMemories) {
    const vectors = await deps.provider.embed([memory.content]);
    await recordEmbeddingUsage(db, memory.userId, [memory.content]);
    await deps.memoriesIndex.upsert([
      {
        id: memory.id,
        values: vectors[0] ?? [],
        metadata: { memory_id: memory.id, user_id: memory.userId },
        namespace: memory.userId,
      },
    ]);
    await db
      .update(memoryItems)
      .set({
        embeddingStatus: "indexed",
        embeddingVersion: version,
        embeddedAt: new Date().toISOString(),
        embeddingError: null,
        embeddingChunks: 1,
      })
      .where(
        and(
          eq(memoryItems.id, memory.id),
          eq(memoryItems.userId, memory.userId),
        ),
      );
  }

  return { memosIndexed: done, memoriesIndexed: activeMemories.length };
}

async function* paginateMemos(db: FlareMoDb) {
  let afterId: string | undefined;
  do {
    const filters = [
      inArray(memos.status, ["normal", "archived"]),
      // Comments hold no vectors; see processMemoEmbeddingTask.
      notComment(),
      ...(afterId ? [gt(memos.id, afterId)] : []),
    ];
    const page = await db
      .select()
      .from(memos)
      .where(and(...filters))
      .orderBy(asc(memos.id))
      .limit(REBUILD_PAGE_SIZE);
    if (page.length === 0) return;
    afterId = page[page.length - 1]?.id;
    yield page;
  } while (afterId);
}
