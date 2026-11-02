import type { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import app from "../index";
import { createAppTestHarness, json } from "../test-support/app";
import { createTestRuntime } from "../test-support/runtime";

let mf: Miniflare;
let env: Env;
let sessionCookie: string;

const { bootstrapAndSignIn } = createAppTestHarness(() => ({
  env,
  sessionCookie,
}));

function putAvatar(contentType: string, bytes: number[]) {
  return app.fetch(
    new Request("http://flaremo.test/api/app/me/avatar", {
      method: "PUT",
      headers: {
        "content-type": contentType,
        cookie: sessionCookie,
        origin: "http://flaremo.test",
      },
      body: new Uint8Array(bytes),
    }),
    env,
  );
}

describe("avatar format switches", () => {
  beforeEach(async () => {
    ({ runtime: mf, env } = await createTestRuntime({
      databaseName: "flaremo-avatar-test",
      attachmentsName: "flaremo-avatar-attachments-test",
      env: { FLAREMO_DEPLOY_REPOSITORY: "example/flaremo" },
    }));
    sessionCookie = await bootstrapAndSignIn();
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("serves the newest upload after switching from PNG to JPEG", async () => {
    expect((await putAvatar("image/png", [1, 2, 3])).status).toBe(200);
    const second = await json<{ avatar_url: string }>(
      await putAvatar("image/jpeg", [9, 9, 9, 9]),
    );

    const served = await app.fetch(
      new Request(`http://flaremo.test${second.avatar_url}`),
      env,
    );
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/jpeg");
  });
});
