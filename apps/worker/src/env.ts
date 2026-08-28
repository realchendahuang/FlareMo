import type { RateLimiterBinding } from "./rate-limit";

export type FlareMoEnv = Env & {
  BETTER_AUTH_SECRET?: string;
  FLAREMO_BOOTSTRAP_SECRET?: string;
  FLAREMO_RECOVERY_SECRET?: string;
  FLAREMO_PUBLIC_URL?: string;
  FLAREMO_TRUSTED_ORIGINS?: string;
  // Optional Cloudflare rate-limiting binding for credential endpoints
  // (see src/rate-limit.ts). Unbound deployments skip throttling entirely.
  RATE_LIMITER?: RateLimiterBinding;
  // Transactional email for registration verification (see src/email.ts).
  // `cloudflare` uses the EMAIL binding (Workers Paid); `none` skips
  // verification entirely (self-host default).
  FLAREMO_EMAIL_PROVIDER?: string;
  FLAREMO_EMAIL_FROM?: string;
  // Registration captcha (pluggable provider; see src/captcha.ts). Site key
  // is a public var; secrets are Wrangler secrets. Provider `http` requires
  // FLAREMO_CAPTCHA_VERIFY_URL; `tencent` additionally requires the secret
  // id/key pair.
  FLAREMO_CAPTCHA_PROVIDER?: string;
  FLAREMO_CAPTCHA_SITE_KEY?: string;
  FLAREMO_CAPTCHA_VERIFY_URL?: string;
  FLAREMO_CAPTCHA_SECRET_ID?: string;
  FLAREMO_CAPTCHA_SECRET?: string;
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
