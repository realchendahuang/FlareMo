export type FlareMoEnv = Env & {
  BETTER_AUTH_SECRET?: string;
  FLAREMO_BOOTSTRAP_SECRET?: string;
  FLAREMO_RECOVERY_SECRET?: string;
  FLAREMO_PUBLIC_URL?: string;
  FLAREMO_TRUSTED_ORIGINS?: string;
  // Per-user quota payload for shared deployments (numbers-or-null; see
  // parseUserPlanLimits). Unset = no per-user limits; only deployment-level
  // (or none) applies.
  FLAREMO_USER_LIMITS_JSON?: string;
  // Semantic-search configuration. Provider/model/dimensions are non-secret;
  // the external HTTP provider's API URL/key are optional (the key is a secret).
  FLAREMO_EMBEDDING_PROVIDER?: string;
  FLAREMO_EMBEDDING_MODEL?: string;
  FLAREMO_EMBEDDING_DIMENSIONS?: string;
  FLAREMO_EMBEDDING_API_URL?: string;
  FLAREMO_EMBEDDING_API_KEY?: string;
  // Usage-panel limits. Defaults are the Workers Free Vectorize allowance.
  FLAREMO_VECTORIZE_STORED_LIMIT?: string;
  FLAREMO_VECTORIZE_QUERIED_LIMIT?: string;
};
