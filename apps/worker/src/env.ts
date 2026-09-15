import type { RateLimiterBinding } from "./rate-limit";

export type FlareMoEnv = Env & {
  // Voice capture ASR providers (see src/asr/provider.ts). Provider selection
  // is a public var; provider credentials are Worker secrets.
  FLAREMO_VOICE_CONFIG_KEY?: string;
  FLAREMO_ASR_PROVIDER?: string;
  FLAREMO_ASR_MODEL?: string;
  FLAREMO_ASR_DASHSCOPE_API_KEY?: string;
  FLAREMO_ASR_TENCENT_APP_ID?: string;
  FLAREMO_ASR_TENCENT_SECRET_ID?: string;
  FLAREMO_ASR_TENCENT_SECRET_KEY?: string;
  // Tencent accuracy hint. A console vocabulary ID is public; a temporary
  // hotword list is sensitive and stays a secret.
  FLAREMO_ASR_TENCENT_HOTWORD_ID?: string;
  FLAREMO_ASR_TENCENT_HOTWORD_LIST?: string;
  MEMBER_REMOVAL_QUEUE?: Queue<{ jobId: string }>;
  DATA_EXPORT_QUEUE?: Queue<{ taskId: string }>;
  BETTER_AUTH_SECRET?: string;
  FLAREMO_BOOTSTRAP_SECRET?: string;
  FLAREMO_RECOVERY_SECRET?: string;
  FLAREMO_PUBLIC_URL?: string;
  FLAREMO_TRUSTED_ORIGINS?: string;
  // Optional Cloudflare rate-limiting binding for credential endpoints
  // (per IP) and paid ASR connection starts (per authenticated user; see
  // src/rate-limit.ts). Unbound deployments skip throttling entirely.
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
  // Web Push (see packages/domain/src/push.ts). Generate with
  // `npx web-push generate-vapid-keys`; both keys are plain config values —
  // unset keys disable push end-to-end.
  FLAREMO_VAPID_PUBLIC_KEY?: string;
  FLAREMO_VAPID_PRIVATE_KEY?: string;
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
  // Memo vector layout (see docs/vector-namespace-design.md). "team" (default)
  // partitions memos into per-user personal namespaces plus one shared team
  // namespace; "solo" skips the team namespace entirely (personal-only
  // deployments: no team partition, team publish entry hidden).
  FLAREMO_VECTORIZE_TEAM_LAYOUT?: string;
  // Upper bound (rows) for CEL memo-filter scans that cannot fully translate
  // to SQL (see src/filter-scan-limit.ts). Unset = 5000.
  FLAREMO_MEMO_FILTER_SCAN_LIMIT?: string;
  // Recycle-bin retention in days: trashed memos older than this are
  // hard-deleted (with their R2 attachments) by the daily sweep. Unset = 30;
  // 0 disables the purge entirely.
  FLAREMO_TRASH_RETENTION_DAYS?: string;
};
