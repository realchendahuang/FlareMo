/**
 * Injectable plan limits. The domain layer only ever sees numbers-or-null:
 * self-hosted deployments always run SELF_HOST_UNLIMITED, while a hosted
 * shell supplies its own resolver, so subscription concepts never enter
 * this package.
 */
export type PlanLimitValue = number | null;

export type PlanLimits = {
  /** Total attachment object storage across all users, in bytes. */
  attachmentStorageBytes: PlanLimitValue;
  /** Monthly embedding-token budget shared by semantic search and AI flows. */
  aiEmbeddingTokensPerMonth: PlanLimitValue;
  /** Monthly semantic-search query count. */
  semanticSearchQueriesPerMonth: PlanLimitValue;
  /** Maximum member accounts per deployment, owner included. */
  maxMembersPerDeployment: PlanLimitValue;
};

export const SELF_HOST_UNLIMITED: PlanLimits = Object.freeze({
  attachmentStorageBytes: null,
  aiEmbeddingTokensPerMonth: null,
  semanticSearchQueriesPerMonth: null,
  maxMembersPerDeployment: null,
});

/**
 * Per-user quota form for shared deployments (public sign-up instances).
 * The member cap is deployment-scoped by definition — a per-user member
 * limit is a category error — so this shape intentionally has no member
 * dimension. When a per-user dimension is set it wins over the deployment
 * limit for that user; `null` falls through to the deployment value.
 */
export type UserPlanLimits = {
  attachmentStorageBytes: PlanLimitValue;
  aiEmbeddingTokensPerMonth: PlanLimitValue;
  semanticSearchQueriesPerMonth: PlanLimitValue;
};

/**
 * Parse a `FLAREMO_USER_LIMITS_JSON`-style payload. Strict: any missing key,
 * non-numeric value, negative number, or unparsable JSON yields `null`
 * (treated as "not configured"), never a partial or unlimited interpretation.
 */
export function parseUserPlanLimits(
  raw: string | undefined | null,
): UserPlanLimits | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const read = (key: string): PlanLimitValue | undefined => {
    const value = record[key];
    if (value === null) return null;
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
    return undefined;
  };
  const attachmentStorageBytes = read("attachmentStorageBytes");
  const aiEmbeddingTokensPerMonth = read("aiEmbeddingTokensPerMonth");
  const semanticSearchQueriesPerMonth = read("semanticSearchQueriesPerMonth");
  if (
    attachmentStorageBytes === undefined ||
    aiEmbeddingTokensPerMonth === undefined ||
    semanticSearchQueriesPerMonth === undefined
  ) {
    return null;
  }
  return {
    attachmentStorageBytes,
    aiEmbeddingTokensPerMonth,
    semanticSearchQueriesPerMonth,
  };
}
