export type FlareMoEnv = Env & {
  BETTER_AUTH_SECRET?: string;
  FLAREMO_BOOTSTRAP_SECRET?: string;
  FLAREMO_RECOVERY_SECRET?: string;
  FLAREMO_PUBLIC_URL?: string;
  FLAREMO_TRUSTED_ORIGINS?: string;
};
