import { attachments, createDb, memberRemovalJobs } from "@flaremo/db";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTestRuntime,
  fetchWorker,
  type TestRuntime,
} from "./test-support/runtime";
import { bootstrapAndSignIn } from "./test-support/sign-in";

/**
 * Regression test for the PAT failure path: the delete handler used to re-open
 * the browser-only request context inside its catch block, which throws for any
 * Authorization header — so a member removed by a machine token left its job in
 * "removing" forever with no error recorded.
 */
describe("admin member removal failure recording", () => {
  let runtime: TestRuntime | undefined;

  afterEach(async () => {
    await runtime?.runtime.dispose();
    runtime = undefined;
  });

  it("records a failed job even when the caller uses a PAT", async () => {
    runtime = await createTestRuntime({ name: "flaremo-member-removal" });
    const cookie = await bootstrapAndSignIn(runtime.env);
    const post = (path: string, body: unknown) =>
      fetchWorker(
        new Request(`http://flaremo.test${path}`, {
          method: "POST",
          headers: {
            cookie,
            origin: "http://flaremo.test",
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
        runtime.env,
      );

    const created = await post("/api/app/admin/users", {
      name: "Removed Member",
      email: "removed@example.com",
    });
    expect(created.status).toBe(201);
    const member = (await created.json()) as { id: string };

    // The member needs at least one R2 object; otherwise the cleanup pass has
    // nothing to delete and never reaches the failing branch.
    const db = createDb(runtime.db);
    const attachmentId = "attachments/removal-test";
    const now = new Date().toISOString();
    await db.insert(attachments).values({
      id: attachmentId,
      userId: member.id,
      memoId: null,
      r2Key: `${attachmentId}/clip.bin`,
      filename: "clip.bin",
      contentType: "application/octet-stream",
      size: 10,
      state: "ready",
      createdAt: now,
      updatedAt: now,
    });

    const patResponse = await post("/api/app/account/personal-access-tokens", {
      name: "ops",
      scopes: ["admin"],
    });
    expect(patResponse.status).toBe(201);
    const { token } = (await patResponse.json()) as { token: string };

    // Fail R2 mid-cleanup: the job is created before the failure, so the only
    // observable difference is whether the catch block can persist it.
    const originalAttachments = runtime.env.ATTACHMENTS;
    runtime.env.ATTACHMENTS = {
      delete: () => {
        throw new Error("r2 delete failed");
      },
      list: async () => ({ objects: [], truncated: false, cursor: undefined }),
    } as unknown as R2Bucket;
    try {
      const removed = await fetchWorker(
        new Request(
          `http://flaremo.test/api/app/admin/users/${encodeURIComponent(member.id)}`,
          {
            method: "DELETE",
            headers: { authorization: `Bearer ${token}` },
          },
        ),
        runtime.env,
      );
      expect(removed.status).toBe(500);
    } finally {
      runtime.env.ATTACHMENTS = originalAttachments;
    }

    const jobs = await db
      .select()
      .from(memberRemovalJobs)
      .where(eq(memberRemovalJobs.memberId, member.id));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe("failed");
    expect(jobs[0]?.errorMessage).toContain("r2 delete failed");
  });
});
