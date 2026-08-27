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
