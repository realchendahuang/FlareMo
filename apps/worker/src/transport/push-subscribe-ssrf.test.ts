import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestRuntime,
  fetchWorker,
  type TestRuntime,
} from "../test-support/runtime";
import { bootstrapAndSignIn } from "../test-support/sign-in";

describe("Web Push subscription SSRF protection", () => {
  let runtime: TestRuntime | undefined;

  beforeEach(async () => {
    runtime = await createTestRuntime({
      name: "flaremo-push-subscribe-ssrf",
      env: {
        FLAREMO_VAPID_PUBLIC_KEY: "test-public-key",
        FLAREMO_VAPID_PRIVATE_KEY: "test-private-key",
      },
    });
  });

  afterEach(async () => {
    await runtime?.runtime.dispose();
    runtime = undefined;
  });

  it("rejects HTTP and private-IP endpoints at the route boundary", async () => {
    if (!runtime) throw new Error("runtime not initialized");
    const cookie = await bootstrapAndSignIn(runtime.env);
    for (const endpoint of [
      "http://push.example/endpoint",
      "https://127.0.0.1/endpoint",
    ]) {
      const response = await fetchWorker(
        new Request("http://flaremo.test/api/app/push/subscribe", {
          method: "POST",
          headers: {
            cookie,
            origin: "http://flaremo.test",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            endpoint,
            keys: { p256dh: "test-p256dh", auth: "test-auth" },
          }),
        }),
        runtime.env,
      );
      expect(response.status).toBe(400);
    }
  });
});
