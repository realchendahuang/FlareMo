import {
  currentListAttachmentsResponseSchema,
  currentListMemosResponseSchema,
  currentMemoSchema,
} from "@flaremo/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTestRuntime,
  fetchWorker,
  type TestRuntime,
} from "./test-support/runtime";
import { bootstrapAndSignIn } from "./test-support/sign-in";

/**
 * Response-level contract gate for the current memos API. The OpenAPI coverage
 * test only compares route tables (path + method), so a renamed or retyped
 * response field used to reach clients undetected. These assertions validate
 * the actual payloads against the very schemas the contract is built from.
 */
describe("current memos API response contract", () => {
  let runtime: TestRuntime | undefined;

  afterEach(async () => {
    await runtime?.runtime.dispose();
    runtime = undefined;
  });

  it("keeps create/list/get/attachments payloads inside the contract", async () => {
    runtime = await createTestRuntime({ name: "flaremo-memos-contract" });
    const cookie = await bootstrapAndSignIn(runtime.env);
    const json = (body: unknown): RequestInit => ({
      method: "POST",
      headers: {
        cookie,
        origin: "http://flaremo.test",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const created = await fetchWorker(
      new Request(
        "http://flaremo.test/api/v1/memos",
        json({ content: "contract check #contract", visibility: "PRIVATE" }),
      ),
      runtime.env,
    );
    expect(created.status).toBe(200);
    const memo = currentMemoSchema.parse(await created.json());
    expect(memo.content).toContain("contract check");
    expect(memo.tags).toContain("contract");

    const list = await fetchWorker(
      new Request("http://flaremo.test/api/v1/memos?pageSize=10", {
        headers: { cookie },
      }),
      runtime.env,
    );
    expect(list.status).toBe(200);
    const listBody = currentListMemosResponseSchema.parse(await list.json());
    expect(listBody.memos.some((entry) => entry.name === memo.name)).toBe(true);

    const memoId = memo.name.replace(/^memos\//, "");
    const fetched = await fetchWorker(
      new Request(`http://flaremo.test/api/v1/memos/${memoId}`, {
        headers: { cookie },
      }),
      runtime.env,
    );
    expect(fetched.status).toBe(200);
    expect(currentMemoSchema.parse(await fetched.json()).name).toBe(memo.name);

    const attachments = await fetchWorker(
      new Request(`http://flaremo.test/api/v1/memos/${memoId}/attachments`, {
        headers: { cookie },
      }),
      runtime.env,
    );
    expect(attachments.status).toBe(200);
    expect(
      currentListAttachmentsResponseSchema.parse(await attachments.json())
        .attachments,
    ).toEqual([]);
  });
});
