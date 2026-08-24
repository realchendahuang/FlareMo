import type { FlareMoDb, UserRow } from "@flaremo/db";
import { memos } from "@flaremo/db";
import { and, eq, inArray } from "drizzle-orm";
import type { EmbeddingProvider, VectorIndex } from "./embedding";

export type SemanticSearchDeps = {
  provider: EmbeddingProvider;
  index: VectorIndex;
};

export type SemanticMemoHit = {
  id: string;
  score: number;
};

// A memo is chunked as `memos/{id}#chunks/{idx}`. Strip the chunk suffix to
// recover the owning memo id.
function memoIdFromVectorId(vectorId: string): string {
  const separator = vectorId.indexOf("#chunks/");
  return separator === -1 ? vectorId : vectorId.slice(0, separator);
}

/**
 * Semantic memo search. Vectorize only supplies candidate ids + scores; every
 * hit is re-read from D1 and filtered by owner/status so a stale or
 * unauthorized vector can never surface content on its own.
 */
export async function semanticSearchMemos(
  db: FlareMoDb,
  user: UserRow,
  deps: SemanticSearchDeps,
  query: string,
  limit = 10,
): Promise<SemanticMemoHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const [queryVector] = await deps.provider.embed([trimmed]);
  if (!queryVector || queryVector.length === 0) return [];

  // Over-fetch then re-filter, because chunk-level matches collapse to memo
  // level and the D1 status check can drop some of them.
  const matches = await deps.index.query(queryVector, Math.min(limit * 3, 50));
  if (matches.length === 0) return [];

  const candidateIds = [
    ...new Set(matches.map((match) => memoIdFromVectorId(match.id))),
  ];
  const rows = await db
    .select()
    .from(memos)
    .where(
      and(
        eq(memos.userId, user.id),
        inArray(memos.id, candidateIds),
        inArray(memos.status, ["normal", "archived"]),
      ),
    );
  const allowed = new Set(rows.map((row) => row.id));

  // Aggregate the best chunk score per memo, preserving vector order relevance.
  const scored = new Map<string, number>();
  for (const match of matches) {
    const memoId = memoIdFromVectorId(match.id);
    if (!allowed.has(memoId)) continue;
    const current = scored.get(memoId);
    if (current === undefined || match.score > current) {
      scored.set(memoId, match.score);
    }
  }

  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, score]) => ({ id, score }));
}
