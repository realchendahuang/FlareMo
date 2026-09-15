import assert from "node:assert/strict";
import test from "node:test";
import { inspectWorkerSecret } from "./sync-worker-secrets.mjs";

test("skips empty Worker secrets", () => {
  assert.equal(inspectWorkerSecret("BETTER_AUTH_SECRET", "").status, "missing");
});

test("rejects short or placeholder Worker secrets", () => {
  assert.equal(
    inspectWorkerSecret("BETTER_AUTH_SECRET", "short").status,
    "invalid",
  );
  assert.equal(
    inspectWorkerSecret("FLAREMO_BOOTSTRAP_SECRET", "change-me").status,
    "invalid",
  );
});

test("accepts a diverse 32+ character secret", () => {
  const value = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6";
  const result = inspectWorkerSecret("BETTER_AUTH_SECRET", value);
  assert.equal(result.status, "ok");
  assert.equal(result.secret, value);
});
