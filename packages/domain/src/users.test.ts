import type { UserRow } from "@flaremo/db";
import { applyFlaremoMigrations, createDb, memos, users } from "@flaremo/db";
import { eq } from "drizzle-orm";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConflictError, ForbiddenError, ValidationError } from "./errors";
import { createMemo } from "./memos";
import {
  beginFlaremoMemberRemoval,
  createFlaremoMember,
  ensureSingleUser,
  finalizeFlaremoMemberRemoval,
  getFlaremoUserById,
  updateFlaremoUserEmail,
  updateFlaremoUserRole,
} from "./users";

let mf: Miniflare;
let db: ReturnType<typeof createDb>;
let user: UserRow;

describe("updateFlaremoUserEmail", () => {
  beforeEach(async () => {
    mf = new Miniflare({
      script: "export default { fetch() { return new Response('ok') } }",
      modules: true,
      compatibilityDate: "2026-07-10",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: { DB: "flaremo-users-test" },
    });
    const database = await mf.getD1Database("DB");
    db = createDb(database);
    await applyFlaremoMigrations(database);
    user = await ensureSingleUser(db, {
      email: "owner@example.com",
      name: "Owner",
    });
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("updates the domain user's email and normalizes it to lowercase", async () => {
    const updated = await updateFlaremoUserEmail(
      db,
      user,
      "New.Owner@Example.com",
    );
    expect(updated.email).toBe("new.owner@example.com");
  });

  it("rejects an invalid email address", async () => {
    await expect(
      updateFlaremoUserEmail(db, user, "not-an-email"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects an email already taken by another user", async () => {
    await createFlaremoMember(db, {
      email: "other@example.com",
      name: "Other",
    });
    await expect(
      updateFlaremoUserEmail(db, user, "other@example.com"),
    ).rejects.toThrow(ConflictError);
  });

  it("allows re-using the current email value", async () => {
    const updated = await updateFlaremoUserEmail(db, user, "owner@example.com");
    expect(updated.email).toBe("owner@example.com");
  });

  it("removes private data while retaining team content and its author", async () => {
    const member = await createFlaremoMember(db, {
      email: "member@example.com",
      name: "Member",
    });
    const privateMemo = await createMemo(db, member, {
      content: "private",
      visibility: "private",
      source: "web",
    });
    const teamMemo = await createMemo(db, member, {
      content: "team",
      visibility: "protected",
      source: "web",
    });

    const artifacts = await beginFlaremoMemberRemoval(db, member.id);
    expect(artifacts.memoIds).toEqual([privateMemo.id]);
    expect((await getFlaremoUserById(db, member.id))?.status).toBe("removed");

    await finalizeFlaremoMemberRemoval(db, member.id, artifacts);
    const rows = await db
      .select()
      .from(memos)
      .where(eq(memos.userId, member.id));
    expect(rows.map((row) => row.id)).toEqual([teamMemo.id]);
    expect(await getFlaremoUserById(db, member.id)).toMatchObject({
      name: "Member",
      status: "removed",
    });
  });

  it("supports assigning and removing the team administrator role", async () => {
    const member = await createFlaremoMember(db, {
      email: "admin@example.com",
      name: "Admin",
    });
    expect((await updateFlaremoUserRole(db, member.id, "admin")).role).toBe(
      "admin",
    );
    expect((await updateFlaremoUserRole(db, member.id, "member")).role).toBe(
      "member",
    );
  });

  it("removes a second administrator while the owner stays active", async () => {
    const secondAdmin = await createFlaremoMember(db, {
      email: "second-admin@example.com",
      name: "Second Admin",
    });
    await updateFlaremoUserRole(db, secondAdmin.id, "admin");

    const artifacts = await beginFlaremoMemberRemoval(db, secondAdmin.id);
    await finalizeFlaremoMemberRemoval(db, secondAdmin.id, artifacts);
    expect((await getFlaremoUserById(db, secondAdmin.id))?.status).toBe(
      "removed",
    );
    expect((await getFlaremoUserById(db, user.id))?.status).toBe("active");
  });

  it("rejects demoting the last active administrator", async () => {
    const lastAdmin = await createFlaremoMember(db, {
      email: "last-admin@example.com",
      name: "Last Admin",
    });
    await updateFlaremoUserRole(db, lastAdmin.id, "admin");
    // Simulate a degraded deployment whose owner row is no longer an active
    // administrator; the guard must then keep `lastAdmin` in place.
    await db
      .update(users)
      .set({ status: "removed" })
      .where(eq(users.id, user.id));

    const error = await updateFlaremoUserRole(db, lastAdmin.id, "member").then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(ForbiddenError);
    expect((error as Error).message).toBe(
      "The last active administrator cannot be changed.",
    );
    expect((await getFlaremoUserById(db, lastAdmin.id))?.role).toBe("admin");
    expect((await getFlaremoUserById(db, lastAdmin.id))?.status).toBe("active");
  });

  it("rejects removing the last active administrator", async () => {
    const lastAdmin = await createFlaremoMember(db, {
      email: "last-admin@example.com",
      name: "Last Admin",
    });
    await updateFlaremoUserRole(db, lastAdmin.id, "admin");
    await db
      .update(users)
      .set({ status: "removed" })
      .where(eq(users.id, user.id));

    const error = await beginFlaremoMemberRemoval(db, lastAdmin.id).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(ForbiddenError);
    expect((error as Error).message).toBe(
      "The last active administrator cannot be changed.",
    );
    expect((await getFlaremoUserById(db, lastAdmin.id))?.status).toBe("active");
  });

  it("rejects demoting or removing the owner account", async () => {
    const roleError = await updateFlaremoUserRole(db, user.id, "member").then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(roleError).toBeInstanceOf(ForbiddenError);
    expect((roleError as Error).message).toBe(
      "The owner role cannot be changed.",
    );

    const removalError = await beginFlaremoMemberRemoval(db, user.id).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(removalError).toBeInstanceOf(ForbiddenError);
    expect((removalError as Error).message).toBe(
      "The owner account cannot be removed.",
    );

    const owner = await getFlaremoUserById(db, user.id);
    expect(owner).toMatchObject({ role: "owner", status: "active" });
  });
});
