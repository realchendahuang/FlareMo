import { createDb } from "@flaremo/db";
import { createMemberRemovalJob, SELF_HOST_UNLIMITED } from "@flaremo/domain";
import type { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import app, { createFlareMoApp } from "../index";
import { createAppTestHarness, json } from "../test-support/app";
import { createTestRuntime, TEST_PASSWORD } from "../test-support/runtime";

let mf: Miniflare;
let env: Env;
let sessionCookie: string;

const {
  fetchApp,
  createMemo,
  createActivatedMember,
  createMemoAs,
  extractCookieHeader,
  bootstrapAndSignIn,
} = createAppTestHarness(() => ({
  env,
  sessionCookie,
}));

describe("FlareMo team and admin API", () => {
  beforeEach(async () => {
    ({ runtime: mf, env } = await createTestRuntime({
      databaseName: "flaremo-test",
      attachmentsName: "flaremo-attachments-test",
      env: { FLAREMO_DEPLOY_REPOSITORY: "example/flaremo" },
    }));
    sessionCookie = await bootstrapAndSignIn();
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("rejects a registration over the member cap with 429", async () => {
    const quotaApp = createFlareMoApp({
      resolvePlanLimits: () => ({
        ...SELF_HOST_UNLIMITED,
        maxMembersPerDeployment: 1,
      }),
    });

    const open = await quotaApp.fetch(
      new Request("http://flaremo.test/api/app/admin/settings", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: sessionCookie,
          origin: "http://flaremo.test",
        },
        body: JSON.stringify({ registration_open: true }),
      }),
      env,
    );
    expect(open.status).toBe(200);

    const response = await quotaApp.fetch(
      new Request("http://flaremo.test/api/auth/flaremo/register", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://flaremo.test",
        },
        body: JSON.stringify({
          name: "Member",
          email: "member@example.com",
          password: TEST_PASSWORD,
        }),
      }),
      env,
    );
    expect(response.status).toBe(429);
    const body = await response.json<{ error: { message: string } }>();
    expect(body.error.message).toContain("Member limit");
  });

  it("rejects adding a member whose email is already taken", async () => {
    const createMember = (email: string) =>
      app.fetch(
        new Request("http://flaremo.test/api/app/admin/users", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: sessionCookie,
            origin: "http://flaremo.test",
          },
          body: JSON.stringify({ name: "Duplicate Member", email }),
        }),
        env,
      );

    expect((await createMember("duplicate@example.com")).status).toBe(201);

    // The second attempt must name the real cause, not read as a server
    // fault: the identity insert used to fail on the unique index and the
    // bare driver error surfaced as a 500 "Internal server error".
    const duplicate = await createMember("duplicate@example.com");
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({
      error: { message: "That email is already in use." },
    });

    // A differently-cased address is the same identity: the byte-wise unique
    // index would have admitted it and the link insert then failed, leaving
    // an orphaned domain row behind.
    const cased = await createMember("Duplicate@Example.com");
    expect(cased.status).toBe(409);

    // The owner's own address is equally taken.
    expect((await createMember("owner@example.com")).status).toBe(409);

    const members = await json<{
      users: Array<{ email: string; role: string | null }>;
    }>(await fetchApp("http://flaremo.test/api/app/admin/users"));
    const matches = members.users.filter(
      (user) => user.email === "duplicate@example.com",
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.role).toBe("member");
    // No orphan: every listed row carries a team membership.
    expect(members.users.filter((user) => user.role === null)).toEqual([]);
  });

  it("enforces team visibility and retains team content after removal", async () => {
    const createMemberResponse = await app.fetch(
      new Request("http://flaremo.test/api/app/admin/users", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: sessionCookie,
          origin: "http://flaremo.test",
        },
        body: JSON.stringify({
          name: "Team Member",
          email: "team-member@example.com",
          password: TEST_PASSWORD,
        }),
      }),
      env,
    );
    expect(createMemberResponse.status).toBe(201);
    const member = await createMemberResponse.json<{
      id: string;
      activation_path: string;
    }>();

    const updateRole = async (role: "admin" | "member") =>
      app.fetch(
        new Request(
          `http://flaremo.test/api/app/admin/users/${encodeURIComponent(member.id)}/role`,
          {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
              cookie: sessionCookie,
              origin: "http://flaremo.test",
            },
            body: JSON.stringify({ role }),
          },
        ),
        env,
      );
    expect((await updateRole("admin")).status).toBe(200);
    expect((await updateRole("member")).status).toBe(200);

    const activationToken = new URL(
      `http://flaremo.test${member.activation_path}`,
    ).searchParams.get("token");
    const reset = await app.fetch(
      new Request("http://flaremo.test/api/auth/reset-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://flaremo.test",
        },
        body: JSON.stringify({
          token: activationToken,
          newPassword: TEST_PASSWORD,
        }),
      }),
      env,
    );
    expect(reset.status).toBe(200);
    const signIn = await app.fetch(
      new Request("http://flaremo.test/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://flaremo.test",
        },
        body: JSON.stringify({
          email: "team-member@example.com",
          password: TEST_PASSWORD,
        }),
      }),
      env,
    );
    expect(signIn.status).toBe(200);
    const memberCookie = extractCookieHeader(signIn);

    // Role changes take effect for the existing session, without re-login.
    // Voice credentials are owner-only: neither admins nor members manage them.
    const voiceRequest = (method: string, body?: unknown, suffix = "") =>
      app.fetch(
        new Request(`http://flaremo.test/api/app/voice-settings${suffix}`, {
          method,
          headers: {
            cookie: memberCookie,
            origin: "http://flaremo.test",
            "content-type": "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
        env,
      );
    for (const role of ["member", "admin", "member"] as const) {
      expect((await updateRole(role)).status).toBe(200);
      const me = await app.fetch(
        new Request("http://flaremo.test/api/app/me", {
          headers: { cookie: memberCookie },
        }),
        env,
      );
      expect(await me.json()).toMatchObject({
        is_instance_owner: false,
        can_manage_voice_service: false,
      });
      for (const [method, suffix] of [
        ["GET", ""],
        ["PUT", ""],
        ["DELETE", ""],
        ["POST", "/test"],
      ]) {
        expect((await voiceRequest(method, undefined, suffix)).status).toBe(
          403,
        );
      }
    }

    const createMemberMemo = async (visibility: "private" | "protected") => {
      const response = await app.fetch(
        new Request("http://flaremo.test/api/app/memos", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: memberCookie,
            origin: "http://flaremo.test",
          },
          body: JSON.stringify({
            content: `${visibility} member memo`,
            visibility,
          }),
        }),
        env,
      );
      expect(response.status).toBe(201);
      return response.json<{ id: string }>();
    };
    const privateMemo = await createMemberMemo("private");
    const teamMemo = await createMemberMemo("protected");

    const readAsOwner = (memoId: string) =>
      app.fetch(
        new Request(`http://flaremo.test/api/app/memos/${memoId}`, {
          headers: { cookie: sessionCookie },
        }),
        env,
      );
    expect((await readAsOwner(privateMemo.id)).status).toBe(404);
    const teamResponse = await readAsOwner(teamMemo.id);
    expect(teamResponse.status).toBe(200);
    // Content authority (docs/content-authority.md): the owner governs another
    // member's team memo (archive/trash/hard delete) but can never edit it.
    expect(
      await teamResponse.json<{
        can_manage: boolean;
        can_govern: boolean;
        memo: { creator_name?: string };
      }>(),
    ).toMatchObject({
      can_manage: false,
      can_govern: true,
      memo: { creator_name: "Team Member" },
    });

    const removeResponse = await app.fetch(
      new Request(
        `http://flaremo.test/api/app/admin/users/${encodeURIComponent(member.id)}`,
        {
          method: "DELETE",
          headers: { cookie: sessionCookie, origin: "http://flaremo.test" },
        },
      ),
      env,
    );
    expect(removeResponse.status).toBe(200);
    expect(
      (
        await app.fetch(
          new Request("http://flaremo.test/api/app/health", {
            headers: { cookie: memberCookie },
          }),
          env,
        )
      ).status,
    ).toBe(401);
    expect((await readAsOwner(privateMemo.id)).status).toBe(404);
    const retainedResponse = await readAsOwner(teamMemo.id);
    expect(retainedResponse.status).toBe(200);
    // The removed member's team memo is adopted by the owner account, so the
    // owner can keep managing it; the content itself is untouched.
    expect(
      await retainedResponse.json<{
        can_manage: boolean;
        memo: { creator_name?: string };
      }>(),
    ).toMatchObject({
      can_manage: true,
      memo: { creator_name: "Owner" },
    });
  });

  it("protects the last active administrator through the admin API", async () => {
    const secondAdmin = await createActivatedMember(
      "second-admin@example.com",
      "Second Admin",
    );
    const setRole = (
      memberId: string,
      role: "admin" | "member",
      cookie: string,
    ) =>
      app.fetch(
        new Request(
          `http://flaremo.test/api/app/admin/users/${encodeURIComponent(memberId)}/role`,
          {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
              cookie,
              origin: "http://flaremo.test",
            },
            body: JSON.stringify({ role }),
          },
        ),
        env,
      );

    expect((await setRole(secondAdmin.id, "admin", sessionCookie)).status).toBe(
      200,
    );
    // Demoting the second administrator succeeds while the owner remains the
    // other active administrator.
    const demoted = await setRole(secondAdmin.id, "member", sessionCookie);
    expect(demoted.status).toBe(200);
    expect((await demoted.json<{ role: string }>()).role).toBe("member");
    expect((await setRole(secondAdmin.id, "admin", sessionCookie)).status).toBe(
      200,
    );

    // With the owner as the last active administrator, demoting or removing it
    // must fail closed even when another administrator issues the request.
    const demoteOwner = await setRole(
      "users/owner",
      "member",
      secondAdmin.cookie,
    );
    expect(demoteOwner.status).toBe(403);
    expect(await demoteOwner.json()).toEqual({
      error: { message: "The owner role cannot be changed." },
    });

    const removeOwner = await app.fetch(
      new Request(
        `http://flaremo.test/api/app/admin/users/${encodeURIComponent("users/owner")}`,
        {
          method: "DELETE",
          headers: {
            cookie: secondAdmin.cookie,
            origin: "http://flaremo.test",
          },
        },
      ),
      env,
    );
    expect(removeOwner.status).toBe(403);
    expect(await removeOwner.json()).toEqual({
      error: { message: "The owner account cannot be removed." },
    });

    // A reset token mints a credential, so the same takeover guard applies:
    // an administrator cannot reset the owner's password, and only the owner
    // can reset another administrator's.
    const resetOwnerPassword = await app.fetch(
      new Request(
        `http://flaremo.test/api/app/admin/users/${encodeURIComponent("users/owner")}/reset-password`,
        {
          method: "POST",
          headers: {
            cookie: secondAdmin.cookie,
            origin: "http://flaremo.test",
          },
        },
      ),
      env,
    );
    expect(resetOwnerPassword.status).toBe(403);
    expect(await resetOwnerPassword.json()).toEqual({
      error: {
        message: "The owner password cannot be reset through the admin API.",
      },
    });

    const resetAdminPassword = await app.fetch(
      new Request(
        `http://flaremo.test/api/app/admin/users/${encodeURIComponent(secondAdmin.id)}/reset-password`,
        {
          method: "POST",
          headers: {
            cookie: secondAdmin.cookie,
            origin: "http://flaremo.test",
          },
        },
      ),
      env,
    );
    expect(resetAdminPassword.status).toBe(403);
    expect(await resetAdminPassword.json()).toEqual({
      error: {
        message: "Only the owner can reset another administrator's password.",
      },
    });

    const removeSelf = await app.fetch(
      new Request(
        `http://flaremo.test/api/app/admin/users/${encodeURIComponent(secondAdmin.id)}`,
        {
          method: "DELETE",
          headers: {
            cookie: secondAdmin.cookie,
            origin: "http://flaremo.test",
          },
        },
      ),
      env,
    );
    expect(removeSelf.status).toBe(403);
    expect(await removeSelf.json()).toEqual({
      error: { message: "You cannot remove yourself from the team." },
    });

    const members = await json<{
      users: Array<{ id: string; role: string; status: string }>;
    }>(await fetchApp("http://flaremo.test/api/app/admin/users"));
    expect(members.users.find((user) => user.id === "users/owner")).toEqual(
      expect.objectContaining({ role: "owner", status: "active" }),
    );
  });

  it("refuses member-credential minting from a personal access token", async () => {
    const member = await createActivatedMember(
      "pat-reset-target@example.com",
      "Pat Reset Target",
    );
    const created = await json<{ token: string }>(
      await app.fetch(
        new Request(
          "http://flaremo.test/api/app/account/personal-access-tokens",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie: sessionCookie,
              origin: "http://flaremo.test",
            },
            body: JSON.stringify({ name: "Owner CLI", expires_in_days: 30 }),
          },
        ),
        env,
      ),
    );

    // A leaked admin PAT must not be able to mint a password-reset link…
    const reset = await app.fetch(
      new Request(
        `http://flaremo.test/api/app/admin/users/${encodeURIComponent(member.id)}/reset-password`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${created.token}` },
        },
      ),
      env,
    );
    expect(reset.status).toBe(401);

    // …nor create a new member with an activation link.
    const createUser = await app.fetch(
      new Request("http://flaremo.test/api/app/admin/users", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${created.token}`,
        },
        body: JSON.stringify({
          email: "pat-created@example.com",
          name: "Pat Created",
        }),
      }),
      env,
    );
    expect(createUser.status).toBe(401);
  });

  it("invalidates a removed member's personal access token", async () => {
    const member = await createActivatedMember(
      "pat-member@example.com",
      "Pat Member",
    );
    const createdToken = await json<{
      token: string;
      personal_access_token: { id: string; enabled: boolean };
    }>(
      await app.fetch(
        new Request(
          "http://flaremo.test/api/app/account/personal-access-tokens",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie: member.cookie,
              origin: "http://flaremo.test",
            },
            body: JSON.stringify({ name: "CLI token", expires_in_days: 30 }),
          },
        ),
        env,
      ),
    );
    expect(createdToken.token).toMatch(/^memos_pat_/);
    expect(createdToken.personal_access_token.enabled).toBe(true);

    const patMemosBefore = await app.fetch(
      new Request("http://flaremo.test/api/v1/memos", {
        headers: {
          authorization: `Bearer ${createdToken.token}`,
          "x-flaremo-wire": "legacy",
        },
      }),
      env,
    );
    expect(patMemosBefore.status).toBe(200);

    await json(
      await fetchApp(
        `http://flaremo.test/api/app/admin/users/${encodeURIComponent(member.id)}`,
        { method: "DELETE" },
      ),
    );

    const patMemosAfter = await app.fetch(
      new Request("http://flaremo.test/api/v1/memos", {
        headers: {
          authorization: `Bearer ${createdToken.token}`,
          "x-flaremo-wire": "legacy",
        },
      }),
      env,
    );
    expect(patMemosAfter.status).toBe(401);
    // A PAT must not reach the browser-facing surface either.
    const patAppHealth = await app.fetch(
      new Request("http://flaremo.test/api/app/health", {
        headers: { authorization: `Bearer ${createdToken.token}` },
      }),
      env,
    );
    expect(patAppHealth.status).toBe(401);
  });

  it("lets the instance owner's PAT drive the admin surface and provision reader seats by email", async () => {
    // The owner mints a PAT through their browser session.
    const created = await json<{ token: string }>(
      await fetchApp(
        "http://flaremo.test/api/app/account/personal-access-tokens",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "provisioning", expires_in_days: 30 }),
        },
      ),
    );
    expect(created.token).toMatch(/^memos_pat_/);

    // A PAT acts as its owner on the admin surface.
    const members = await json<{ users: Array<{ id: string; role: string }> }>(
      await app.fetch(
        new Request("http://flaremo.test/api/app/admin/users", {
          headers: { authorization: `Bearer ${created.token}` },
        }),
        env,
      ),
    );
    expect(members.users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "users/owner", role: "owner" }),
      ]),
    );

    // A non-admin member's PAT fails the same role check as their session.
    const member = await createActivatedMember(
      "provision-denied@example.com",
      "Provision Denied",
    );
    const memberToken = await json<{ token: string }>(
      await app.fetch(
        new Request(
          "http://flaremo.test/api/app/account/personal-access-tokens",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie: member.cookie,
              origin: "http://flaremo.test",
            },
            body: JSON.stringify({ name: "self" }),
          },
        ),
        env,
      ),
    );
    const denied = await app.fetch(
      new Request("http://flaremo.test/api/app/admin/users", {
        headers: { authorization: `Bearer ${memberToken.token}` },
      }),
      env,
    );
    expect(denied.status).toBe(403);

    // Machine provisioning: an unknown email creates an account plus a
    // one-time activation link, ready to hand to the reader.
    const provisioned = await json<{
      id: string;
      role: string;
      created: boolean;
      activation_path: string;
      reader_expires_at: string | null;
      username: string;
    }>(
      await app.fetch(
        new Request("http://flaremo.test/api/app/admin/team/reader", {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${created.token}`,
          },
          body: JSON.stringify({
            email: "paid-reader@example.com",
            expires_at: "2027-01-01T00:00:00.000Z",
          }),
        }),
        env,
      ),
    );
    expect(provisioned.created).toBe(true);
    expect(provisioned.role).toBe("reader");
    expect(provisioned.reader_expires_at).toBe("2027-01-01T00:00:00.000Z");
    expect(provisioned.activation_path).toMatch(/^\/reset\?token=/);

    // Idempotent renewal: the same email re-grants with a new absolute date.
    const renewed = await json<{
      created: boolean;
      role: string;
      reader_expires_at: string | null;
    }>(
      await app.fetch(
        new Request("http://flaremo.test/api/app/admin/team/reader", {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${created.token}`,
          },
          body: JSON.stringify({
            email: "paid-reader@example.com",
            expires_at: "2027-06-01T00:00:00.000Z",
          }),
        }),
        env,
      ),
    );
    expect(renewed.created).toBe(false);
    expect(renewed.reader_expires_at).toBe("2027-06-01T00:00:00.000Z");

    // The seat is visible in the admin member list.
    const memberList = await json<{
      users: Array<{
        id: string;
        role: string;
        reader_expires_at: string | null;
      }>;
    }>(
      await app.fetch(
        new Request("http://flaremo.test/api/app/admin/users", {
          headers: { authorization: `Bearer ${created.token}` },
        }),
        env,
      ),
    );
    const readerRow = memberList.users.find((row) => row.role === "reader");
    expect(readerRow).toEqual(
      expect.objectContaining({
        role: "reader",
        reader_expires_at: "2027-06-01T00:00:00.000Z",
      }),
    );

    // Never demote the owner or an administrator into a reader.
    const demoteOwner = await app.fetch(
      new Request("http://flaremo.test/api/app/admin/team/reader", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${created.token}`,
        },
        body: JSON.stringify({
          email: "owner@example.com",
          expires_at: "2027-01-01T00:00:00.000Z",
        }),
      }),
      env,
    );
    expect(demoteOwner.status).toBe(403);

    // After activation and sign-in the reader sees their own seat in /me.
    const activationToken = new URL(
      `http://flaremo.test${provisioned.activation_path}`,
    ).searchParams.get("token");
    const reset = await app.fetch(
      new Request("http://flaremo.test/api/auth/reset-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://flaremo.test",
        },
        body: JSON.stringify({
          token: activationToken,
          newPassword: TEST_PASSWORD,
        }),
      }),
      env,
    );
    expect(reset.status).toBe(200);
    const readerSignIn = await app.fetch(
      new Request("http://flaremo.test/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://flaremo.test",
        },
        body: JSON.stringify({
          email: "paid-reader@example.com",
          password: TEST_PASSWORD,
        }),
      }),
      env,
    );
    expect(readerSignIn.status).toBe(200);
    const me = await json<{
      role: string | null;
      team: { id: string } | null;
      team_expired: boolean;
      reader_expires_at: string | null;
    }>(
      await app.fetch(
        new Request("http://flaremo.test/api/app/me", {
          headers: { cookie: extractCookieHeader(readerSignIn) },
        }),
        env,
      ),
    );
    expect(me.role).toBe("reader");
    expect(me.team).toEqual(
      expect.objectContaining({ id: "orgs/default-team" }),
    );
    expect(me.team_expired).toBe(false);
    expect(me.reader_expires_at).toBe("2027-06-01T00:00:00.000Z");
  });

  it("replays member removal without deleting retained team or public content", async () => {
    const removed = await createActivatedMember(
      "replay-removed@example.com",
      "Replay Removed",
    );
    const spectator = await createActivatedMember(
      "replay-spectator@example.com",
      "Replay Spectator",
    );

    const removedPrivateId = await createMemoAs(
      removed.cookie,
      "replay private",
      "private",
    );
    const removedTeamId = await createMemoAs(
      removed.cookie,
      "replay team",
      "protected",
    );
    const removedPublicId = await createMemoAs(
      removed.cookie,
      "replay public",
      "public",
    );
    const spectatorTeamId = await createMemoAs(
      spectator.cookie,
      "spectator team",
      "protected",
    );
    const ownerAnchor = await createMemo<{ id: string }>("owner replay anchor");

    await json(
      await fetchApp(
        `http://flaremo.test/api/app/admin/users/${encodeURIComponent(removed.id)}`,
        { method: "DELETE" },
      ),
    );

    // Replay the same removal through the shared queued-job executor; a
    // retried or doubly-queued job must be a safe no-op.
    const replayJob = await createMemberRemovalJob(
      createDb(env.DB),
      removed.id,
      "users/owner",
    );
    await app.scheduled(
      { scheduledTime: Date.now() } as ScheduledController,
      env,
    );

    const job = await json<{ job: { status: string; phase: string } }>(
      await fetchApp(
        `http://flaremo.test/api/app/admin/member-removal-jobs/${replayJob.id}`,
      ),
    );
    expect(job.job).toMatchObject({ status: "completed", phase: "completed" });

    const readMemo = (memoId: string) =>
      fetchApp(`http://flaremo.test/api/app/memos/${memoId}`);
    expect((await readMemo(removedPrivateId)).status).toBe(404);

    const retainedRows = await env.DB.prepare(
      "SELECT id, visibility, user_id FROM memos WHERE id IN (?, ?, ?, ?, ?)",
    )
      .bind(
        `memos/${removedPrivateId}`,
        `memos/${removedTeamId}`,
        `memos/${removedPublicId}`,
        `memos/${spectatorTeamId}`,
        `memos/${ownerAnchor.id}`,
      )
      .all<{ id: string; visibility: string; user_id: string }>();
    const retained = new Map(retainedRows.results.map((row) => [row.id, row]));
    expect(retained.has(`memos/${removedPrivateId}`)).toBe(false);
    // Team and public content is adopted by the owner account after removal.
    expect(retained.get(`memos/${removedTeamId}`)).toMatchObject({
      visibility: "protected",
      user_id: "users/owner",
    });
    expect(retained.get(`memos/${removedPublicId}`)).toMatchObject({
      visibility: "public",
      user_id: "users/owner",
    });
    expect(retained.get(`memos/${spectatorTeamId}`)).toMatchObject({
      visibility: "protected",
      user_id: spectator.id,
    });
    expect(retained.get(`memos/${ownerAnchor.id}`)).toMatchObject({
      user_id: "users/owner",
    });

    // The retained team memo renders under its adopting owner.
    const teamRead = await json<{
      memo: { creator_name?: string; visibility: string };
    }>(await readMemo(removedTeamId));
    expect(teamRead.memo).toMatchObject({
      creator_name: "Owner",
      visibility: "protected",
    });
    expect((await readMemo(removedPublicId)).status).toBe(200);
    expect((await readMemo(spectatorTeamId)).status).toBe(200);
    expect((await readMemo(ownerAnchor.id)).status).toBe(200);

    const spectatorRow = await env.DB.prepare(
      "SELECT status FROM users WHERE id = ?",
    )
      .bind(spectator.id)
      .first<{ status: string }>();
    expect(spectatorRow?.status).toBe("active");
  });
});
