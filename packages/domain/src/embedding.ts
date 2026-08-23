// Semantic-search embedding and vector-index abstractions. These are plain
// interfaces so the domain layer stays free of Cloudflare runtime types; the
// Worker adapts `env.AI` and `env.VECTORIZE_*` to them in the app layer. The
// domain only ever reads D1 as the source of truth — the vector index is a
// rebuildable derived index, exactly as documented in docs/semantic-search.md.

export type EmbeddingProviderName = "workers-ai" | "http" | "none";

export const DEFAULT_EMBEDDING_MODEL = "@cf/qwen/qwen3-embedding-0.6b";
export const DEFAULT_EMBEDDING_DIMENSIONS = 1024;

/** Approximate a token budget in characters. Mixed CJK/Latin text averages
 * well under 2 chars per token; this conservative budget keeps chunks safely
 * under the model's context window without a tokenizer dependency. */
export const EMBEDDING_CHARS_PER_TOKEN = 2;
export const DEFAULT_EMBEDDING_CHUNK_TOKENS = 512;

export interface EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  /** Embed a batch of texts, returning one vector per input in order. */
  embed(texts: string[]): Promise<number[][]>;
}

export interface VectorIndexMatch {
  id: string;
  score: number;
}

export interface VectorIndexVector {
  id: string;
  values: number[];
  metadata?: Record<string, unknown>;
}

export interface VectorIndexInfo {
  vectorCount: number;
  dimensions: number;
}

export interface VectorIndex {
  query(vector: number[], topK: number): Promise<VectorIndexMatch[]>;
  upsert(vectors: VectorIndexVector[]): Promise<void>;
  deleteByIds(ids: string[]): Promise<void>;
  describe(): Promise<VectorIndexInfo>;
}

/** A `null` provider means semantic search is disabled; callers fall back to
 * FTS5 keyword search. */
export type EmbeddingProviderFactory = () => EmbeddingProvider | null;

/**
 * Stable identifier for an embedding configuration. It is stamped onto every
 * indexed resource so a model or dimension change can be detected and trigger
 * a full rebuild rather than mixing incompatible vectors in one index.
 */
export function embeddingVersion(model: string, dimensions: number): string {
  return `${model}@${dimensions}`;
}

/**
 * Split long text into stable chunks near sentence/line boundaries. Short
 * text is returned as a single chunk; the id of chunk `i` is `${resourceId}#chunks/${i}`.
 */
export function chunkText(
  text: string,
  maxTokens: number = DEFAULT_EMBEDDING_CHUNK_TOKENS,
): string[] {
  const normalized = text.trim();
  if (!normalized) return [];
  const budget = maxTokens * EMBEDDING_CHARS_PER_TOKEN;
  if ([...normalized].length <= budget) return [normalized];

  // Split into candidate blocks on paragraph and sentence boundaries first,
  // then greedily pack them into chunks that stay under the budget.
  const blocks = normalized
    .split(/(?<=\n)|(?<=[。！？.!?；;])/)
    .map((block) => block.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";
  for (const block of blocks) {
    if ([...block].length > budget) {
      // A single oversized block (no boundary found): hard-split by budget.
      if (current) {
        chunks.push(current.trim());
        current = "";
      }
      const runes = [...block];
      for (let i = 0; i < runes.length; i += budget) {
        chunks.push(runes.slice(i, i + budget).join(""));
      }
      continue;
    }
    if ([...current].length + [...block].length + 1 > budget) {
      chunks.push(current.trim());
      current = block;
    } else {
      current = current ? `${current} ${block}` : block;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export function chunkVectorIds(
  resourceId: string,
  chunkCount: number,
): string[] {
  return Array.from(
    { length: chunkCount },
    (_, index) => `${resourceId}#chunks/${index}`,
  );
}
