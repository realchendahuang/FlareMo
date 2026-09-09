import { applyFlaremoMigrations, createDb } from "@flaremo/db";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claimMemberRemovalJob,
  createMemberRemovalJob,
  getMemberRemovalJob,
  requeueStaleMemberRemovalJobs,
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
    await raw
      .prepare("UPDATE member_removal_jobs SET updated_at = ? WHERE id = ?")
      .bind(new Date(Date.now() - 16 * 60_000).toISOString(), job.id)
      .run();
    expect(await requeueStaleMemberRemovalJobs(db)).toBe(1);
    expect((await getMemberRemovalJob(db, job.id))?.status).toBe("queued");
  });
});
