import {
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
  type EmbeddingProvider,
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

export function createVectorIndex(
  env: FlareMoEnv,
  kind: "memo" | "memory",
): VectorIndex | null {
  const binding =
    kind === "memo" ? env.VECTORIZE_MEMOS : env.VECTORIZE_MEMORIES;
  if (!binding) return null;
  return new CloudflareVectorIndex(binding);
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
      ...(namespace ? { filter: { namespace } } : {}),
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

  async deleteByIds(ids: string[]) {
    if (ids.length === 0) return;
    await this.index.deleteByIds(ids);
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
