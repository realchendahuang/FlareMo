import {
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
  type EmbeddingProvider,
  memoTeamNamespace,
  memoUserNamespace,
  type VectorIndex,
  type VectorIndexInfo,
  type VectorIndexVector,
} from "@flaremo/domain";
import type { FlareMoEnv } from "./env";

// The Worker-side adapters between Cloudflare's `Ai` / `VectorizeIndex`
// bindings and the domain layer's provider/index abstractions. The domain stays
// free of runtime types; only this file knows the Cloudflare shapes.

export function resolveEmbeddingConfig(env: FlareMoEnv) {
  const provider = (env.FLAREMO_EMBEDDING_PROVIDER ?? "workers-ai").trim();
  const model = env.FLAREMO_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
  const dimensions = Number.parseInt(
    env.FLAREMO_EMBEDDING_DIMENSIONS?.trim() ||
      String(DEFAULT_EMBEDDING_DIMENSIONS),
    10,
  );
  return {
    provider,
    model,
    dimensions:
      Number.isFinite(dimensions) && dimensions > 0
        ? dimensions
        : DEFAULT_EMBEDDING_DIMENSIONS,
  };
}

export function createEmbeddingProvider(
  env: FlareMoEnv,
): EmbeddingProvider | null {
  const config = resolveEmbeddingConfig(env);
  if (config.provider === "none") return null;
  if (config.provider === "http") {
    return new HttpEmbeddingProvider(
      config.model,
      config.dimensions,
      env.FLAREMO_EMBEDDING_API_URL,
      env.FLAREMO_EMBEDDING_API_KEY,
    );
  }
  return new WorkersAiEmbeddingProvider(env, config.model, config.dimensions);
}

export function createVectorIndex(env: FlareMoEnv): VectorIndex | null {
  if (!env.VECTORIZE_MEMOS) return null;
  return new CloudflareVectorIndex(env.VECTORIZE_MEMOS);
}

/**
 * The memo vector partitions a caller's semantic search scans. Always the
 * author's personal namespace; the shared team namespace joins when the
 * deployment runs the team layout (default) — `solo` deployments skip it
 * entirely. A space narrows the scan to that space's namespaces only. The D1
 * `memoReadScope` re-check stays the authorization boundary regardless of
 * what is scanned.
 */
export function memoSearchNamespaces(
  env: FlareMoEnv,
  user: { id: string },
  space?: "personal" | "team",
): string[] | undefined {
  const layout = (env.FLAREMO_VECTORIZE_TEAM_LAYOUT ?? "team").trim();
  const personal = memoUserNamespace(user.id);
  // Solo deployments index everything in the user namespace, so a team
  // space scan still has to scan it.
  if (layout === "solo") return [personal];
  if (space === "personal") return [personal];
  if (space === "team") return [memoTeamNamespace()];
  return [personal, memoTeamNamespace()];
}

class WorkersAiEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly env: FlareMoEnv,
    public readonly model: string,
    public readonly dimensions: number,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const result = await this.env.AI.run(
      this.model as never,
      {
        text: texts,
      } as never,
    );
    const data = (result as { data?: number[][] }).data;
    if (!Array.isArray(data) || data.length !== texts.length) {
      throw new Error(
        `Workers AI returned an unexpected embedding shape for ${this.model}`,
      );
    }
    return data;
  }
}

class HttpEmbeddingProvider implements EmbeddingProvider {
  constructor(
    public readonly model: string,
    public readonly dimensions: number,
    private readonly url: string | undefined,
    private readonly apiKey: string | undefined,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.url) {
      throw new Error(
        "FLAREMO_EMBEDDING_API_URL is required for the http embedding provider",
      );
    }
    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ input: texts, model: this.model }),
    });
    if (!response.ok) {
      throw new Error(`Embedding provider returned HTTP ${response.status}`);
    }
    const body = (await response.json()) as {
      data?: Array<{ embedding: number[] }>;
    };
    const vectors = body.data?.map((entry) => entry.embedding);
    if (!vectors || vectors.length !== texts.length) {
      throw new Error(
        "Embedding provider returned an unexpected response shape",
      );
    }
    return vectors;
  }
}

class CloudflareVectorIndex implements VectorIndex {
  constructor(private readonly index: VectorizeIndex) {}
  async query(vector: number[], topK: number, namespace?: string) {
    const result = await this.index.query(vector, {
      topK,
      returnMetadata: false,
      // `namespace` is a first-class Vectorize query option; routing it
      // through `filter` would match it against vector metadata instead.
      ...(namespace ? { namespace } : {}),
    });
    return result.matches.map((match) => ({
      id: match.id,
      score: match.score,
    }));
  }

  async upsert(vectors: VectorIndexVector[]) {
    await this.index.upsert(
      vectors.map((vector) => ({
        id: vector.id,
        values: vector.values,
        metadata: (vector.metadata ?? {}) as Record<
          string,
          string | number | boolean
        >,
        ...(vector.namespace ? { namespace: vector.namespace } : {}),
      })),
    );
  }

  async getByIds(ids: string[]): Promise<VectorIndexVector[]> {
    if (ids.length === 0) return [];
    const found: VectorIndexVector[] = [];
    // Vectorize caps id-list operations at 100 ids per call.
    for (let offset = 0; offset < ids.length; offset += 100) {
      const batch = await this.index.getByIds(ids.slice(offset, offset + 100));
      for (const vector of batch) {
        found.push({
          id: vector.id,
          values: Array.from(vector.values ?? []),
          metadata: (vector.metadata ?? {}) as Record<string, unknown>,
          ...(vector.namespace ? { namespace: vector.namespace } : {}),
        });
      }
    }
    return found;
  }

  async deleteByIds(ids: string[]) {
    if (ids.length === 0) return;
    // Vectorize caps id-list operations at 100 ids per call.
    for (let offset = 0; offset < ids.length; offset += 100) {
      await this.index.deleteByIds(ids.slice(offset, offset + 100));
    }
  }

  async describe(): Promise<VectorIndexInfo> {
    const details = await this.index.describe();
    const dimensions =
      "dimensions" in details.config
        ? details.config.dimensions
        : this.readPresetDimensions(details.config);
    return {
      vectorCount: details.vectorsCount,
      dimensions,
    };
  }

  private readPresetDimensions(config: { preset: string }): number {
    // Preset-based indexes encode their dimension in the preset id; fall back
    // to the configured default when it cannot be parsed.
    const match = config.preset.match(/(\d+)/);
    const parsed = Number.parseInt(match?.[1] ?? "", 10);
    return Number.isFinite(parsed) ? parsed : DEFAULT_EMBEDDING_DIMENSIONS;
  }
}
