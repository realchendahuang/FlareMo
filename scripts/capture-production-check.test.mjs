import assert from "node:assert/strict";
import test from "node:test";
import {
  findMissingSecretNames,
  inspectCaptureProductionConfig,
  parseWranglerSecretNames,
} from "./lib/capture-production-config.mjs";

const databaseId = "12345678-1234-4234-9234-123456789abc";

test("accepts a production Tencent Capture configuration", () => {
  const result = inspectCaptureProductionConfig(
    config({
      FLAREMO_ASR_MODEL: "16k_zh_en",
      FLAREMO_ASR_PROVIDER: "tencent",
      FLAREMO_ASR_TENCENT_APP_ID: "1234567890",
      FLAREMO_ASR_TENCENT_HOTWORD_ID: "flaremo_terms",
    }),
  );

  assert.deepEqual(result.errors, []);
  assert.equal(result.provider, "tencent");
  assert.deepEqual(result.requiredSecrets, [
    "BETTER_AUTH_SECRET",
    "FLAREMO_BOOTSTRAP_SECRET",
    "FLAREMO_ASR_TENCENT_SECRET_ID",
    "FLAREMO_ASR_TENCENT_SECRET_KEY",
  ]);
});

test("accepts DashScope and requires its permanent key as a Worker secret", () => {
  const result = inspectCaptureProductionConfig(
    config({
      FLAREMO_ASR_MODEL: "qwen-audio-3.0-asr-flash-streaming",
      FLAREMO_ASR_PROVIDER: "dashscope",
    }),
  );

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.requiredSecrets, [
    "BETTER_AUTH_SECRET",
    "FLAREMO_BOOTSTRAP_SECRET",
    "FLAREMO_ASR_DASHSCOPE_API_KEY",
  ]);
});

test("reports every unsafe or incomplete production setting", () => {
  const candidate = config({
    FLAREMO_ASR_MODEL: "16k_zh_en_2.0",
    FLAREMO_ASR_PROVIDER: "tencent",
    FLAREMO_ASR_TENCENT_APP_ID: "not-numeric",
    FLAREMO_ASR_TENCENT_SECRET_KEY: "public-secret",
    FLAREMO_PUBLIC_URL: "http://localhost:8790",
  });
  candidate.d1_databases[0].database_id = "REPLACE_WITH_YOUR_D1_DATABASE_ID";
  candidate.assets.run_worker_first = ["/file/*"];

  const errors = inspectCaptureProductionConfig(candidate).errors.join("\n");
  assert.match(errors, /real database_id/);
  assert.match(errors, /exact HTTPS origin/);
  assert.match(errors, /run_worker_first/);
  assert.match(errors, /must be a Worker secret/);
  assert.match(errors, /numeric FLAREMO_ASR_TENCENT_APP_ID/);
  assert.match(errors, /16 kHz realtime engine/);
});

test("parses Wrangler secret-name responses without exposing values", () => {
  assert.deepEqual(
    [...parseWranglerSecretNames([{ name: "ONE" }, { name: "TWO" }])],
    ["ONE", "TWO"],
  );
  assert.deepEqual(
    [...parseWranglerSecretNames({ secrets: [{ name: "THREE" }] })],
    ["THREE"],
  );
  assert.deepEqual(
    findMissingSecretNames(["ONE", "TWO", "THREE"], new Set(["ONE", "THREE"])),
    ["TWO"],
  );
});

function config(vars) {
  return {
    assets: { run_worker_first: ["/api/*"] },
    d1_databases: [
      { binding: "DB", database_id: databaseId, database_name: "flaremo" },
    ],
    ratelimits: [{ name: "RATE_LIMITER" }],
    vars: {
      FLAREMO_PUBLIC_URL: "https://notes.example.com",
      ...vars,
    },
  };
}
