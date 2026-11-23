import { applyFlaremoMigrations, createDb } from "@flaremo/db";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claimMemberRemovalJob,
  createMemberRemovalJob,
  getMemberRemovalJob,
  MEMBER_REMOVAL_MAX_ATTEMPTS,
  requeueStaleMemberRemovalJobs,
  retryOrFailMemberRemovalJob,
} from "./member-removal-jobs";

let mf: Miniflare;
let db: ReturnType<typeof createDb>;
let raw: Awaited<ReturnType<Miniflare["getD1Database"]>>;
describe("member removal jobs", () => {
  beforeEach(async () => {
    mf = new Miniflare({
      script: "export default {fetch(){return new Response('ok')}}",
      modules: true,
      compatibilityDate: "2026-07-10",
      d1Databases: { DB: "jobs" },
    });
    raw = await mf.getD1Database("DB");
    await applyFlaremoMigrations(raw);
    db = createDb(raw);
  });
  afterEach(() => mf.dispose());
  it("claims once and recovers stale work", async () => {
    const job = await createMemberRemovalJob(db, "member-1", "admin-1");
    expect(await claimMemberRemovalJob(db, job.id)).toBe(true);
    expect(await claimMemberRemovalJob(db, job.id)).toBe(false);
    expect((await getMemberRemovalJob(db, job.id))?.attempts).toBe(1);
    await raw
      .prepare("UPDATE member_removal_jobs SET updated_at = ? WHERE id = ?")
      .bind(new Date(Date.now() - 16 * 60_000).toISOString(), job.id)
      .run();
    expect(await requeueStaleMemberRemovalJobs(db)).toBe(1);
    expect((await getMemberRemovalJob(db, job.id))?.status).toBe("queued");
  });

  it("requeues transient failures and dead-letters exhausted attempts", async () => {
    const job = await createMemberRemovalJob(db, "member-2", "admin-1");
    for (let attempt = 1; attempt < MEMBER_REMOVAL_MAX_ATTEMPTS; attempt += 1) {
      expect(await claimMemberRemovalJob(db, job.id)).toBe(true);
      expect(
        await retryOrFailMemberRemovalJob(
          db,
          job.id,
          "scheduled_member_removal_failed",
          "transient cleanup failure",
        ),
      ).toBe("queued");
      expect(await getMemberRemovalJob(db, job.id)).toMatchObject({
        status: "queued",
        phase: "retrying",
        attempts: attempt,
      });
    }

    expect(await claimMemberRemovalJob(db, job.id)).toBe(true);
    expect(
      await retryOrFailMemberRemovalJob(
        db,
        job.id,
        "scheduled_member_removal_failed",
        "final cleanup failure",
      ),
    ).toBe("dead");
    expect(await getMemberRemovalJob(db, job.id)).toMatchObject({
      status: "failed",
      phase: "dead",
      attempts: MEMBER_REMOVAL_MAX_ATTEMPTS,
      errorCode: "scheduled_member_removal_failed",
      completedAt: expect.any(String),
    });
  });

  it("dead-letters a stale execution after its retry budget is exhausted", async () => {
    const job = await createMemberRemovalJob(db, "member-3", "admin-1");
    expect(await claimMemberRemovalJob(db, job.id)).toBe(true);
    await raw
      .prepare(
        "UPDATE member_removal_jobs SET attempts = ?, updated_at = ? WHERE id = ?",
      )
      .bind(
        MEMBER_REMOVAL_MAX_ATTEMPTS,
        new Date(Date.now() - 16 * 60_000).toISOString(),
        job.id,
      )
      .run();
    expect(await requeueStaleMemberRemovalJobs(db)).toBe(1);
    expect(await getMemberRemovalJob(db, job.id)).toMatchObject({
      status: "failed",
      phase: "dead",
      errorCode: "worker_interrupted_exhausted",
    });
  });
});
