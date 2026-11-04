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
  // Volcano Engine (Doubao) streaming ASR. AppID and Access Token are the
  // console credentials; resource id selects hourly vs concurrent billing.
  FLAREMO_ASR_VOLCENGINE_APP_ID?: string;
  FLAREMO_ASR_VOLCENGINE_ACCESS_TOKEN?: string;
  FLAREMO_ASR_VOLCENGINE_RESOURCE_ID?: string;
  // Optional console boosting/correct table names for accuracy hints.
  FLAREMO_ASR_VOLCENGINE_BOOSTING_TABLE?: string;
  FLAREMO_ASR_VOLCENGINE_CORRECT_TABLE?: string;
  // MiniMax batch ASR (asr-1.0; see src/asr/minimax.ts). The key is a Worker
  // secret; the base URL is optional (defaults to the domestic endpoint,
  // https://api.minimaxi.com; https://api.minimax.io switches international).
  FLAREMO_ASR_MINIMAX_API_KEY?: string;
  FLAREMO_ASR_MINIMAX_BASE_URL?: string;
  // Optional offload queues: bound deployments hand durable jobs to the
  // consumer (member removal: {jobId}; export tasks: {taskId}) which runs the
  // same idempotent executor as the daily cron. Unbound deployments run the
  // executors inline and rely on the cron reconciler alone.
  MEMBER_REMOVAL_QUEUE?: Queue<{ jobId: string }>;
  DATA_EXPORT_QUEUE?: Queue<{ taskId: string }>;
  BETTER_AUTH_SECRET?: string;
  FLAREMO_BOOTSTRAP_SECRET?: string;
  FLAREMO_RECOVERY_SECRET?: string;
  FLAREMO_PUBLIC_URL?: string;
  FLAREMO_TRUSTED_ORIGINS?: string;
  // Optional GitHub repository slug (owner/name) shown by the in-app
  // "System update" entry. Unset hides the update entry entirely.
  FLAREMO_DEPLOY_REPOSITORY?: string;
  // Optional Cloudflare rate-limiting binding for credential endpoints
  // (per IP) and paid ASR connection starts (per authenticated user; see
  // src/rate-limit.ts). Unbound deployments skip throttling entirely.
  RATE_LIMITER?: RateLimiterBinding;
  // Transactional email for registration verification (see src/email.ts).
  // `cloudflare` uses the EMAIL binding (Workers Paid); `resend` uses the
  // Resend HTTP API (needs RESEND_API_KEY); `none` skips verification entirely
  // (self-host default). Owner-configured D1 settings take precedence over
  // these env vars when both exist (see src/integrations/config.ts).
  FLAREMO_EMAIL_PROVIDER?: string;
  FLAREMO_EMAIL_FROM?: string;
  RESEND_API_KEY?: string;
  // Encryption key for owner-configured integration secrets (email, OAuth).
  // Falls back to FLAREMO_VOICE_CONFIG_KEY when unset.
  FLAREMO_INTEGRATION_CONFIG_KEY?: string;
  // Env-based OAuth social providers (see src/auth.ts). Owner-configured D1
  // settings take precedence; providers with both id and secret are enabled.
  FLAREMO_OAUTH_GOOGLE_CLIENT_ID?: string;
  FLAREMO_OAUTH_GOOGLE_CLIENT_SECRET?: string;
  FLAREMO_OAUTH_GITHUB_CLIENT_ID?: string;
  FLAREMO_OAUTH_GITHUB_CLIENT_SECRET?: string;
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
  // Optional Cloudflare account analytics for the owner usage panel (see
  // src/cf-analytics.ts). Written by `pnpm setup:usage`; token needs only the
  // "Account Analytics: Read" permission. Queries are filtered down to this
  // deployment's own resources, so a shared account stays accurate. Unset
  // token/account hides the panel section entirely.
  FLAREMO_CF_ANALYTICS_TOKEN?: string;
  FLAREMO_CF_ACCOUNT_ID?: string;
  FLAREMO_CF_WORKER_NAME?: string;
  FLAREMO_CF_D1_ID?: string;
  FLAREMO_CF_R2_BUCKET?: string;
};
