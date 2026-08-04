import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  authUserLinks,
  authUsers,
  createDb,
  memosNotifications,
  memosSseEvents,
  users,
} from "@flaremo/db";
import { eq } from "drizzle-orm";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import app from "./index";

let mf: Miniflare;
let env: Env;
let sessionCookie: string;

const TEST_AUTH_SECRET =
  "test-better-auth-secret-that-is-never-used-in-production";
const TEST_BOOTSTRAP_SECRET =
  "test-bootstrap-secret-that-is-never-used-in-production";
const TEST_PASSWORD = "test-password-not-for-production-123";

describe("Memos social REST compatibility", () => {
  beforeEach(async () => {
    ({ mf, env } = await createTestRuntime());
    sessionCookie = await bootstrapAndSignIn();
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("creates and paginates camelCase memo comments", async () => {
    const parent = await createMemo("social parent #comments");

    const first = await json(
      await fetchSocial(`http://flaremo.test/api/v1/${parent.name}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "first comment" }),
      }),
    );
    expect(first).toMatchObject({
      name: expect.stringMatching(/^memos\//),
      creator: "users/owner",
      content: "first comment",
      parent: parent.name,
    });
    expect(first.createTime).toEqual(expect.any(String));
    expect(first.updateTime).toEqual(expect.any(String));
    expect(first.create_time).toBeUndefined();

    const second = await json(
      await fetchSocial(`http://flaremo.test/api/v1/${parent.name}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          comment: { content: "second comment", visibility: "PUBLIC" },
        }),
      }),
    );
    expect(second.parent).toBe(parent.name);

    const firstPage = await json(
      await fetchSocial(
        `http://flaremo.test/api/v1/${parent.name}/comments?pageSize=1`,
      ),
    );
    expect(firstPage.memos).toHaveLength(1);
    expect(firstPage.nextPageToken).toEqual(expect.any(String));

    const secondPage = await json(
      await fetchSocial(
        `http://flaremo.test/api/v1/${parent.name}/comments?pageSize=1&pageToken=${encodeURIComponent(firstPage.nextPageToken)}`,
      ),
    );
    expect(secondPage.memos).toHaveLength(1);
    expect(
      new Set([first.name, second.name]).has(secondPage.memos[0].name),
    ).toBe(true);

    const commentEvent = (
      await createDb(env.DB).select().from(memosSseEvents).all()
    ).find((event) => event.type === "memo.comment.created");
    expect(commentEvent).toMatchObject({
      // The pinned Memos server identifies the parent memo for this event;
      // the comment itself is available through the comments collection.
      name: parent.name,
      parent: null,
      visibility: "private",
      creatorId: "users/owner",
    });
  });

  it("upserts, lists, and deletes memo reactions", async () => {
    const memo = await createMemo("social parent #reactions");
    const reactionPath = `http://flaremo.test/api/v1/${memo.name}/reactions`;

    const created = await json(
      await fetchSocial(reactionPath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reaction: {
            contentId: memo.name,
            reactionType: "👍",
          },
        }),
      }),
    );
    expect(created).toMatchObject({
      name: expect.stringMatching(/^memos\/[^/]+\/reactions\/[^/]+$/),
      creator: "users/owner",
      contentId: memo.name,
      reactionType: "👍",
      createTime: expect.any(String),
    });
    expect(created.content_id).toBeUndefined();

    const updated = await json(
      await fetchSocial(reactionPath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reaction: {
            contentId: memo.name,
            reactionType: "❤️",
          },
        }),
      }),
    );
    // Memos stores one reaction row per creator/content/type. Changing the
    // type creates a distinct reaction resource; repeating the same type is
    // the idempotent upsert case.
    expect(updated.name).not.toBe(created.name);
    expect(updated.reactionType).toBe("❤️");

    const listed = await json(await fetchSocial(`${reactionPath}?pageSize=1`));
    expect(listed.reactions).toHaveLength(1);
    expect(listed.reactions[0]).toMatchObject({
      name: created.name,
      contentId: memo.name,
      reactionType: "👍",
    });

    const updatedReactionId = updated.name.split("/").at(-1);
    const deleted = await fetchSocial(
      `http://flaremo.test/api/v1/${memo.name}/reactions/${updatedReactionId}`,
      { method: "DELETE" },
    );
    expect(deleted.status).toBe(200);

    const remaining = await json(await fetchSocial(reactionPath));
    expect(remaining.reactions).toMatchObject([
      { name: created.name, reactionType: "👍" },
    ]);

    const originalReactionId = created.name.split("/").at(-1);
    const deletedOriginal = await fetchSocial(
      `http://flaremo.test/api/v1/${memo.name}/reactions/${originalReactionId}`,
      { method: "DELETE" },
    );
    expect(deletedOriginal.status).toBe(200);

    const empty = await json(await fetchSocial(reactionPath));
    expect(empty.reactions).toEqual([]);
  });

  it("creates one mention notification and suppresses private memo leakage", async () => {
    const db = createDb(env.DB);
    const now = new Date();
    await db.insert(users).values({
      id: "users/alice",
      email: "alice@example.com",
      name: "Alice",
      avatarUrl: null,
      role: "member",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    await db.insert(authUsers).values({
      id: "auth-alice",
      name: "Alice",
      email: "alice@example.com",
      emailVerified: false,
      image: null,
      username: "alice",
      displayUsername: "alice",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(authUserLinks).values({
      authUserId: "auth-alice",
      flaremoUserId: "users/alice",
      createdAt: now,
    });

    const publicParent = await json(
      await fetchSocial("http://flaremo.test/api/v1/memos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "public mention parent",
          visibility: "public",
        }),
      }),
    );
    const publicComment = await json(
      await fetchSocial(
        `http://flaremo.test/api/v1/${publicParent.name}/comments`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: "hello @alice @alice" }),
        },
      ),
    );
    const afterPublic = await db
      .select()
      .from(memosNotifications)
      .where(eq(memosNotifications.receiverId, "users/alice"))
      .all();
    expect(afterPublic).toHaveLength(1);
    expect(afterPublic[0]).toMatchObject({
      senderId: "users/owner",
      receiverId: "users/alice",
      type: "memo_mention",
      sourceEventId: publicComment.name,
      memoId: publicComment.name,
      relatedMemoId: publicParent.name,
    });

    const mentionedMemo = await json(
      await fetchSocial("http://flaremo.test/api/v1/memos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "memo mention @alice",
          visibility: "public",
        }),
      }),
    );
    const afterMemoCreate = await db
      .select()
      .from(memosNotifications)
      .where(eq(memosNotifications.receiverId, "users/alice"))
      .all();
    expect(afterMemoCreate).toHaveLength(2);
    expect(
      afterMemoCreate.find((row) => row.memoId === mentionedMemo.name),
    ).toMatchObject({
      type: "memo_mention",
      relatedMemoId: null,
    });

    const removedResponse = await fetchSocial(
      `http://flaremo.test/api/v1/${mentionedMemo.name}?updateMask=content`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "memo mention removed" }),
      },
    );
    expect(removedResponse.status).toBe(200);
    const reMentionedResponse = await fetchSocial(
      `http://flaremo.test/api/v1/${mentionedMemo.name}?updateMask=content`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "memo mention again @alice" }),
      },
    );
    expect(reMentionedResponse.status).toBe(200);
    const afterReMention = await db
      .select()
      .from(memosNotifications)
      .where(eq(memosNotifications.receiverId, "users/alice"))
      .all();
    expect(
      afterReMention.filter((row) => row.memoId === mentionedMemo.name),
    ).toHaveLength(2);

    const privateParent = await createMemo("private mention parent");
    await fetchSocial(
      `http://flaremo.test/api/v1/${privateParent.name}/comments`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "private hello @alice" }),
      },
    );
    const afterPrivate = await db
      .select()
      .from(memosNotifications)
      .where(eq(memosNotifications.receiverId, "users/alice"))
      .all();
    expect(afterPrivate).toHaveLength(afterReMention.length);
  });

  it("supports shortcut validateOnly, updateMask, and lifecycle operations", async () => {
    const shortcutPath = "http://flaremo.test/api/v1/users/owner/shortcuts";
    const shortcutInput = {
      title: "Compatibility",
      filter: 'content.contains("compat")',
    };

    const validated = await json(
      await fetchSocial(`${shortcutPath}?validateOnly=true`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(shortcutInput),
      }),
    );
    expect(validated).toMatchObject({
      name: expect.stringMatching(/^users\/owner\/shortcuts\/[^/]+$/),
      ...shortcutInput,
    });
    expect((await json(await fetchSocial(shortcutPath))).shortcuts).toEqual([]);

    const created = await json(
      await fetchSocial(shortcutPath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(shortcutInput),
      }),
    );
    expect(created).toMatchObject(shortcutInput);

    const listed = await json(await fetchSocial(shortcutPath));
    expect(listed.shortcuts).toEqual([created]);

    const updated = await json(
      await fetchSocial(
        `${shortcutPath}/${created.name.split("/").at(-1)}?updateMask=title`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: created.name,
            title: "Renamed compatibility",
          }),
        },
      ),
    );
    expect(updated).toMatchObject({
      name: created.name,
      title: "Renamed compatibility",
      filter: shortcutInput.filter,
    });

    const fetched = await json(
      await fetchSocial(`${shortcutPath}/${created.name.split("/").at(-1)}`),
    );
    expect(fetched).toEqual(updated);

    const deleted = await fetchSocial(
      `${shortcutPath}/${created.name.split("/").at(-1)}`,
      { method: "DELETE" },
    );
    expect(deleted.status).toBe(200);
    expect((await json(await fetchSocial(shortcutPath))).shortcuts).toEqual([]);
  });

  it("rejects shortcuts without an upstream-compatible filter", async () => {
    const response = await fetchSocial(
      "http://flaremo.test/api/v1/users/owner/shortcuts",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Missing filter" }),
      },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: 3,
    });
  });

  it("uses the current JSON error envelope and exact Origin boundary", async () => {
    const missing = await fetchSocial(
      "http://flaremo.test/api/v1/memos/missing/comments",
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({
      code: 5,
      details: [],
    });

    const noOrigin = await fetchSocial(
      "http://flaremo.test/api/v1/users/owner/shortcuts",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "must reject missing origin",
          filter: 'content.contains("compat")',
        }),
      },
      { includeAuth: true, addOrigin: false },
    );
    expect(noOrigin.status).toBe(403);
    expect(await noOrigin.json()).toMatchObject({
      code: 7,
      details: [],
    });

    const wrongUser = await fetchSocial(
      "http://flaremo.test/api/v1/users/not-owner/shortcuts",
    );
    expect(wrongUser.status).toBe(403);
    expect(await wrongUser.json()).toMatchObject({
      code: 7,
      details: [],
    });
  });
});

function fetchSocial(
  input: string,
  init?: RequestInit,
  options: { includeAuth?: boolean; addOrigin?: boolean } = {},
) {
  const headers = new Headers(init?.headers);
  headers.set("x-flaremo-wire", "current");
  const includeAuth = options.includeAuth !== false;
  const addOrigin = options.addOrigin !== false;
  const path = new URL(input).pathname;
  if (includeAuth && path.startsWith("/api/v1/")) {
    headers.set("cookie", sessionCookie);
    if (addOrigin && isUnsafeMethod(init?.method) && !headers.has("origin")) {
      headers.set("origin", "http://flaremo.test");
    }
  }
  return app.fetch(new Request(input, { ...init, headers }), env);
}

function isUnsafeMethod(method: string | undefined) {
  return !["GET", "HEAD", "OPTIONS"].includes((method ?? "GET").toUpperCase());
}

async function createMemo(content: string) {
  return json(
    await fetchSocial("http://flaremo.test/api/v1/memos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    }),
  );
}

async function bootstrapAndSignIn() {
  const setup = await app.fetch(
    new Request("http://flaremo.test/api/auth/flaremo/bootstrap", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-flaremo-bootstrap-secret": TEST_BOOTSTRAP_SECRET,
        origin: "http://flaremo.test",
      },
      body: JSON.stringify({
        username: "owner",
        name: "Owner",
        email: "owner@example.com",
        password: TEST_PASSWORD,
      }),
    }),
    env,
  );
  expect(setup.status).toBe(201);

  const signIn = await app.fetch(
    new Request("http://flaremo.test/api/auth/sign-in/username", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://flaremo.test",
      },
      body: JSON.stringify({
        username: "owner",
        password: TEST_PASSWORD,
      }),
    }),
    env,
  );
  expect(signIn.status).toBe(200);
  return extractCookieHeader(signIn);
}

function extractCookieHeader(response: Response) {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const cookies = (
    headers.getSetCookie?.() ?? [response.headers.get("set-cookie")]
  )
    .filter((value): value is string => Boolean(value))
    .map((value) => value.split(";", 1)[0] ?? "")
    .filter(Boolean);
  expect(cookies.length).toBeGreaterThan(0);
  return cookies.join("; ");
}

async function json<T = Record<string, unknown>>(
  response: Response,
  status = 200,
) {
  expect(response.status).toBe(status);
  return response.json() as Promise<T>;
}

async function createTestRuntime() {
  const runtime = new Miniflare({
    script: "export default { fetch() { return new Response('ok') } }",
    modules: true,
    compatibilityDate: "2026-07-10",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: `flaremo-social-${crypto.randomUUID()}` },
    r2Buckets: {
      ATTACHMENTS: `flaremo-social-attachments-${crypto.randomUUID()}`,
    },
  });
  const db = await runtime.getD1Database("DB");
  const migrationDirectory = resolve(
    import.meta.dirname,
    "../../../migrations",
  );
  const migrations = (await readdir(migrationDirectory))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();
  for (const filename of migrations) {
    await applyMigration(
      db,
      await readFile(resolve(migrationDirectory, filename), "utf8"),
    );
  }
  return {
    mf: runtime,
    env: {
      DB: db,
      ATTACHMENTS: await runtime.getR2Bucket("ATTACHMENTS"),
      ASSETS: {
        fetch: async () => new Response("asset", { status: 200 }),
      } as Fetcher,
      FLAREMO_SINGLE_USER_EMAIL: "owner@example.com",
      FLAREMO_SINGLE_USER_NAME: "Owner",
      FLAREMO_PUBLIC_URL: "http://flaremo.test",
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      FLAREMO_BOOTSTRAP_SECRET: TEST_BOOTSTRAP_SECRET,
    } as Env,
  };
}

async function applyMigration(db: D1Database, sql: string) {
  const statements = sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await db.prepare(statement).run();
  }
}
