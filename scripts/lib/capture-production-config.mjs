const SECRET_VAR_NAMES = [
  "BETTER_AUTH_SECRET",
  "FLAREMO_BOOTSTRAP_SECRET",
  "FLAREMO_RECOVERY_SECRET",
  "FLAREMO_ASR_DASHSCOPE_API_KEY",
  "FLAREMO_ASR_TENCENT_SECRET_ID",
  "FLAREMO_ASR_TENCENT_SECRET_KEY",
  "FLAREMO_ASR_TENCENT_HOTWORD_LIST",
];

const BASE_REQUIRED_SECRETS = [
  "BETTER_AUTH_SECRET",
  "FLAREMO_BOOTSTRAP_SECRET",
];

export function inspectCaptureProductionConfig(config) {
  const errors = [];
  const warnings = [];
  const root = asRecord(config);
  const vars = asRecord(root.vars);

  const database = Array.isArray(root.d1_databases)
    ? root.d1_databases.map(asRecord).find((entry) => entry.binding === "DB")
    : undefined;
  const databaseId = stringValue(database?.database_id);
  if (!databaseId || /REPLACE|PLACEHOLDER|YOUR_/i.test(databaseId)) {
    errors.push(
      "D1 binding DB must use a real database_id, not a placeholder.",
    );
  } else if (!isUuid(databaseId)) {
    errors.push("D1 binding DB database_id must be a Cloudflare UUID.");
  }

  const publicUrl = stringValue(vars.FLAREMO_PUBLIC_URL);
  if (!isExactHttpsOrigin(publicUrl)) {
    errors.push(
      "FLAREMO_PUBLIC_URL must be one exact HTTPS origin with no credentials, path, query, or fragment.",
    );
  }
  const trustedOrigins = stringValue(vars.FLAREMO_TRUSTED_ORIGINS);
  for (const origin of trustedOrigins
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)) {
    if (!isExactHttpsOrigin(origin)) {
      errors.push(
        `FLAREMO_TRUSTED_ORIGINS contains an invalid production origin: ${origin}`,
      );
    }
  }

  const assets = asRecord(root.assets);
  const runWorkerFirst = Array.isArray(assets.run_worker_first)
    ? assets.run_worker_first
    : [];
  if (!runWorkerFirst.includes("/api/*")) {
    errors.push('assets.run_worker_first must include "/api/*".');
  }

  for (const name of SECRET_VAR_NAMES) {
    if (stringValue(vars[name])) {
      errors.push(`${name} must be a Worker secret, not a public vars entry.`);
    }
  }

  const provider = stringValue(vars.FLAREMO_ASR_PROVIDER);
  const requiredSecrets = [...BASE_REQUIRED_SECRETS];
  if (provider === "dashscope") {
    requiredSecrets.push("FLAREMO_ASR_DASHSCOPE_API_KEY");
  } else if (provider === "tencent") {
    const appId = stringValue(vars.FLAREMO_ASR_TENCENT_APP_ID);
    const model = stringValue(vars.FLAREMO_ASR_MODEL);
    const hotwordId = stringValue(vars.FLAREMO_ASR_TENCENT_HOTWORD_ID);
    if (!/^\d+$/.test(appId)) {
      errors.push(
        "Tencent Capture requires a numeric FLAREMO_ASR_TENCENT_APP_ID in vars.",
      );
    }
    if (model && !/^16k_[A-Za-z0-9_-]+$/.test(model)) {
      errors.push(
        "Tencent Capture model must be a 16 kHz realtime engine; file, 8 kHz, and short preview engines are invalid.",
      );
    }
    if (hotwordId && !/^[A-Za-z0-9_-]{1,128}$/.test(hotwordId)) {
      errors.push(
        "FLAREMO_ASR_TENCENT_HOTWORD_ID must contain only letters, digits, underscore, or hyphen.",
      );
    }
    requiredSecrets.push(
      "FLAREMO_ASR_TENCENT_SECRET_ID",
      "FLAREMO_ASR_TENCENT_SECRET_KEY",
    );
  } else {
    errors.push(
      'FLAREMO_ASR_PROVIDER must be explicitly set to "tencent" or "dashscope" for production Capture.',
    );
  }

  const rateLimits = Array.isArray(root.ratelimits) ? root.ratelimits : [];
  if (
    !rateLimits.map(asRecord).some((entry) => entry.name === "RATE_LIMITER")
  ) {
    warnings.push(
      "RATE_LIMITER is not bound; authenticated ASR connection starts will not have the optional Worker rate limit.",
    );
  }

  return {
    errors,
    provider:
      provider === "dashscope" || provider === "tencent" ? provider : null,
    requiredSecrets,
    warnings,
  };
}

export function parseWranglerSecretNames(payload) {
  const root = asRecord(payload);
  const entries = Array.isArray(payload)
    ? payload
    : Array.isArray(root.secrets)
      ? root.secrets
      : [];
  return new Set(
    entries
      .map(asRecord)
      .map((entry) => stringValue(entry.name))
      .filter(Boolean),
  );
}

export function findMissingSecretNames(requiredSecrets, configuredSecrets) {
  return requiredSecrets.filter((name) => !configuredSecrets.has(name));
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isExactHttpsOrigin(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.origin === value
    );
  } catch {
    return false;
  }
}
