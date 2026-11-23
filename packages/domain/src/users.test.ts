import { importBundleSchema } from "@flaremo/contracts";
import {
  applyFlaremoMigrations,
  authMembers,
  authOrganizations,
  authUsers,
  createDb,
  memos,
  memoTags,
  type UserRow,
  users,
} from "@flaremo/db";
import { eq } from "drizzle-orm";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  completeOwnerBootstrap,
  getViewerTeamMembership,
  listFlaremoUsersWithMemberships,
} from "./auth";
import { ConflictError, ForbiddenError, ValidationError } from "./errors";
import { importData } from "./import-export";
import { readHourlyCountTotals } from "./memo-hourly-counts";
import { createMemo } from "./memos";
import { createMemoComment } from "./memos-comments";
import type { TeamViewer } from "./team-permissions";
import {
  beginFlaremoMemberRemoval,
  createFlaremoMember,
  createFlaremoMemberWithLink,
  ensureSingleUser,
  finalizeFlaremoMemberRemoval,
  getDefaultTeam,
  getFlaremoUserById,
  grantTeamReader,
  revokeTeamReader,
  updateFlaremoUserEmail,
  updateTeamMemberRole,
} from "./users";

let mf: Miniflare;
let db: ReturnType<typeof createDb>;
let user: UserRow;
const OWNER_AUTH_USER_ID = "auth/owner";

async function createTestAuthUser(
  authUserId: string,
  email: string,
  name: string,
): Promise<void> {
  const now = new Date();
  await db.insert(authUsers).values({
    id: authUserId,
    email,
    name,
    emailVerified: true,
    image: null,
    username: email.split("@")[0],
    displayUsername: name,
    createdAt: now,
    updatedAt: now,
  });
}

/** Create a member through the real provisioning path (identity, link, team). */
async function createMember(
  name: string,
): Promise<{ id: string; authUserId: string; viewer: TeamViewer }> {
  const slug = name.toLowerCase().replaceAll(" ", "-");
  const email = `${slug}@example.com`;
  const authUserId = `auth/${slug}`;
  await createTestAuthUser(authUserId, email, name);
  const member = await createFlaremoMemberWithLink(db, {
    authUserId,
    email,
    name,
  });
  const membership = await getViewerTeamMembership(db, authUserId);
  expect(membership).toMatchObject({ role: "member" });
  return {
    id: member.id,
    authUserId,
    viewer: {
      ...member,
      teamRole: membership?.role,
      teamOrganizationId: membership?.organizationId,
    },
  };
}

describe("team users", () => {
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
    // The bootstrap owner joins the default team through the same path the
    // worker's setup flow uses.
    await createTestAuthUser(OWNER_AUTH_USER_ID, "owner@example.com", "Owner");
    await completeOwnerBootstrap(db, {
      authUserId: OWNER_AUTH_USER_ID,
      singleUser: { email: "owner@example.com", name: "Owner" },
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

  it("publishes team memos into the default team and personal memos into none", async () => {
    const member = await createMember("Member");
    const team = await getDefaultTeam(db);
    expect(team).not.toBeNull();

    const teamMemo = await createMemo(db, member.viewer, {
      content: "team",
      visibility: "protected",
      source: "web",
    });
    expect(teamMemo.teamId).toBe(team?.id);

    const personalMemo = await createMemo(db, member.viewer, {
      content: "personal",
      visibility: "private",
      source: "web",
    });
    expect(personalMemo.teamId).toBeNull();
  });

  it("denies team publishing for readers but keeps personal notes working", async () => {
    const member = await createMember("Reader");
    await grantTeamReader(db, {
      authUserId: member.authUserId,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const membership = await getViewerTeamMembership(db, member.authUserId);
    expect(membership).toMatchObject({ role: "reader" });
    const reader = { ...member.viewer, teamRole: "reader" as const };

    await expect(
      createMemo(db, reader, {
        content: "team",
        visibility: "protected",
        source: "web",
      }),
    ).rejects.toThrow(ForbiddenError);
    // Personal notes stay fully available to the read-only seat.
    const personal = await createMemo(db, reader, {
      content: "personal",
      visibility: "private",
      source: "web",
    });
    expect(personal.teamId).toBeNull();
  });

  it("denies readers from commenting where the comment would become team-visible", async () => {
    const author = await createMember("Comment Author");
    const member = await createMember("Reader Commenter");
    await grantTeamReader(db, {
      authUserId: member.authUserId,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const reader = { ...member.viewer, teamRole: "reader" as const };

    const teamMemo = await createMemo(db, author.viewer, {
      content: "team parent",
      visibility: "protected",
      source: "web",
    });
    await expect(
      createMemoComment(db, reader, teamMemo.id, { content: "reply" }),
    ).rejects.toThrow(ForbiddenError);

    // A comment on a private memo stays private and remains allowed.
    const personalMemo = await createMemo(db, reader, {
      content: "personal parent",
      visibility: "private",
      source: "web",
    });
    await expect(
      createMemoComment(db, reader, personalMemo.id, { content: "reply" }),
    ).resolves.toBeTruthy();
  });

  it("downgrades imported team memos to private for readers", async () => {
    const member = await createMember("Reader Importer");
    await grantTeamReader(db, {
      authUserId: member.authUserId,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const reader = { ...member.viewer, teamRole: "reader" as const };
    const team = await getDefaultTeam(db);

    const bundle = importBundleSchema.parse({
      version: 6,
      memos: [
        {
          name: "memos/reader-import",
          content: "restored from a backup",
          visibility: "protected",
          state: "normal",
          pinned: false,
          payload: {},
          team_id: team?.id ?? null,
          create_time: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    await importData(db, reader, bundle);

    const imported = await db
      .select()
      .from(memos)
      .where(eq(memos.id, "memos/reader-import"))
      .get();
    expect(imported?.visibility).toBe("private");
    expect(imported?.teamId).toBeNull();
  });

  it("cuts off access automatically when the reader seat expires", async () => {
    const member = await createMember("Lapsed");
    // Grant, then lapse: the past-dated expiry folds the membership out at
    // the single fail-closed gate (getViewerTeamMembership) — no cron needed.
    await grantTeamReader(db, {
      authUserId: member.authUserId,
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await getViewerTeamMembership(db, member.authUserId)).toBeNull();

    // Renewal from the admin restores access immediately.
    await grantTeamReader(db, {
      authUserId: member.authUserId,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    expect(await getViewerTeamMembership(db, member.authUserId)).toMatchObject({
      role: "reader",
    });

    // Revocation removes the membership row entirely.
    await revokeTeamReader(db, member.authUserId);
    expect(await getViewerTeamMembership(db, member.authUserId)).toBeNull();
  });

  it("joins admin users in one pass across unlinked and multi-org identities", async () => {
    const mapped = await createMember("Mapped");
    const unlinked = await createFlaremoMember(db, {
      email: "unlinked@example.com",
      name: "Unlinked",
    });
    const now = new Date();
    await db.insert(authOrganizations).values({
      id: "org/secondary",
      name: "Secondary",
      slug: "secondary",
      logo: null,
      metadata: null,
      createdAt: now,
    });
    await db.insert(authMembers).values({
      id: "member/secondary",
      organizationId: "org/secondary",
      userId: mapped.authUserId,
      role: "admin",
      expiresAt: null,
      createdAt: now,
    });

    // Keep this above the D1 binding threshold to guard against a future
    // per-user query or IN-list implementation in the admin read path.
    for (let index = 0; index < 105; index += 1) {
      await createFlaremoMember(db, {
        email: `bulk-${index}@example.com`,
        name: `Bulk ${index}`,
      });
    }

    const rows = await listFlaremoUsersWithMemberships(db);
    expect(rows).toHaveLength(108);
    expect(rows.find((row) => row.user.id === unlinked.id)).toMatchObject({
      authUser: null,
      membership: null,
    });
    expect(rows.find((row) => row.user.id === mapped.id)).toMatchObject({
      authUser: { id: mapped.authUserId },
      membership: { role: "member" },
    });
  });

  it("removes private data and adopts team content into the owner account", async () => {
    const member = await createMember("Member");
    const privateMemo = await createMemo(db, member.viewer, {
      content: "private",
      visibility: "private",
      source: "web",
    });
    const teamMemo = await createMemo(db, member.viewer, {
      content: "team #adopted",
      visibility: "protected",
      source: "web",
    });

    const artifacts = await beginFlaremoMemberRemoval(db, member.id);
    expect(artifacts.memoIds).toEqual([privateMemo.id]);
    expect((await getFlaremoUserById(db, member.id))?.status).toBe("removed");

    // Both memos belong to the member's counter until the removal runs.
    expect(await readHourlyCountTotals(db, member.id)).toMatchObject({
      normal: 2,
    });

    await finalizeFlaremoMemberRemoval(db, member.id, artifacts);
    const adopted = await db
      .select()
      .from(memos)
      .where(eq(memos.id, teamMemo.id))
      .get();
    expect(adopted).toMatchObject({ userId: "users/owner" });
    expect(await getFlaremoUserById(db, member.id)).toMatchObject({
      name: "Member",
      status: "removed",
    });

    // The private memo was deleted and the team memo was adopted, so the
    // member's counter must be empty and the owner's must count the adopted
    // memo. Left to the nightly rebuild, the owner under-reports and the
    // removed member keeps counting memos that no longer exist.
    expect(await readHourlyCountTotals(db, member.id)).toMatchObject({
      normal: 0,
      activeDays: 0,
    });
    expect(await readHourlyCountTotals(db, "users/owner")).toMatchObject({
      normal: 1,
    });

    // The adopted memo's tag row has to follow it. `memo_tags.user_id` is
    // denormalized from the author, and the fast-path tag query filters on it
    // while `counts` filters on `memos.user_id` — leaving them apart makes the
    // owner see the adopted memo in `counts` but not in `tags`.
    const adoptedTag = await db
      .select()
      .from(memoTags)
      .where(eq(memoTags.memoId, teamMemo.id))
      .get();
    expect(adoptedTag).toMatchObject({ userId: "users/owner", tag: "adopted" });
  });

  it("supports assigning and removing the team administrator role", async () => {
    const member = await createMember("Admin");
    await updateTeamMemberRole(db, member.authUserId, "admin");
    expect((await getViewerTeamMembership(db, member.authUserId))?.role).toBe(
      "admin",
    );
    await updateTeamMemberRole(db, member.authUserId, "member");
    expect((await getViewerTeamMembership(db, member.authUserId))?.role).toBe(
      "member",
    );
  });

  it("removes a second administrator while the owner stays active", async () => {
    const secondAdmin = await createMember("Second Admin");
    await updateTeamMemberRole(db, secondAdmin.authUserId, "admin");

    const artifacts = await beginFlaremoMemberRemoval(db, secondAdmin.id);
    await finalizeFlaremoMemberRemoval(db, secondAdmin.id, artifacts);
    expect((await getFlaremoUserById(db, secondAdmin.id))?.status).toBe(
      "removed",
    );
    expect((await getFlaremoUserById(db, user.id))?.status).toBe("active");
  });

  it("rejects demoting the last active administrator", async () => {
    const lastAdmin = await createMember("Last Admin");
    await updateTeamMemberRole(db, lastAdmin.authUserId, "admin");
    // Simulate a degraded deployment whose owner row no longer holds an
    // administrator membership; the guard must then keep `lastAdmin` in place.
    await db
      .update(users)
      .set({ status: "removed" })
      .where(eq(users.id, user.id));

    const error = await updateTeamMemberRole(
      db,
      lastAdmin.authUserId,
      "member",
    ).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(ForbiddenError);
    expect((error as Error).message).toBe(
      "The last active administrator cannot be changed.",
    );
    expect(
      (await getViewerTeamMembership(db, lastAdmin.authUserId))?.role,
    ).toBe("admin");
    expect((await getFlaremoUserById(db, lastAdmin.id))?.status).toBe("active");
  });

  it("rejects removing the last active administrator", async () => {
    const lastAdmin = await createMember("Last Admin");
    await updateTeamMemberRole(db, lastAdmin.authUserId, "admin");
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
    const roleError = await updateTeamMemberRole(
      db,
      OWNER_AUTH_USER_ID,
      "member",
    ).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(roleError).toBeInstanceOf(ForbiddenError);
    expect((roleError as Error).message).toBe(
      "The owner role cannot be changed.",
    );

    const removalError = await beginFlaremoMemberRemoval(
      db,
      "users/owner",
    ).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(removalError).toBeInstanceOf(ForbiddenError);
    expect((removalError as Error).message).toBe(
      "The owner account cannot be removed.",
    );

    const owner = await getFlaremoUserById(db, user.id);
    expect(owner).toMatchObject({ status: "active" });
  });
});
