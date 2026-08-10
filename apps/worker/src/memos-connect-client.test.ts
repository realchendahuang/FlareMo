import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@connectrpc/connect";
import {
  createConnectTransport,
  createGrpcWebTransport,
} from "@connectrpc/connect-web";
import { createDb, memosNotifications } from "@flaremo/db";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import app from "./index";
import { MemoService } from "./memos-generated/api/v1/memo_service_pb";
import {
  UserNotification_Status,
  UserService,
} from "./memos-generated/api/v1/user_service_pb";

let runtime: Miniflare;
let env: Env;
let accessToken: string;

const TEST_AUTH_SECRET =
  "official-connect-client-test-secret-never-used-in-production";
const TEST_BOOTSTRAP_SECRET =
  "official-connect-client-bootstrap-never-used-in-production";
const TEST_PASSWORD = "official-connect-client-password-never-production-123";

describe("official generated Connect clients", () => {
  beforeEach(async () => {
    runtime = await createTestRuntime();
    accessToken = await signIn();
  });

  afterEach(async () => {
    await runtime.dispose();
  });

  it("roundtrips the pinned MemoService through Connect binary and gRPC-Web", async () => {
    const fetchWithAuth: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      request.headers.set("authorization", `Bearer ${accessToken}`);
      return app.fetch(request, env);
    };

    const connectClient = createClient(
      MemoService,
      createConnectTransport({
        baseUrl: "http://flaremo.test",
        fetch: fetchWithAuth,
        useBinaryFormat: true,
      }),
    );
    const grpcWebClient = createClient(
      MemoService,
      createGrpcWebTransport({
        baseUrl: "http://flaremo.test",
        fetch: fetchWithAuth,
        useBinaryFormat: true,
      }),
    );

    const created = await connectClient.createMemo({
      memo: { content: "official Connect client memo" },
    });
    expect(created.name).toMatch(/^memos\//);

    const connectList = await connectClient.listMemos({ pageSize: 10 });
    expect(connectList.memos.some((memo) => memo.name === created.name)).toBe(
      true,
    );

    const grpcWebMemo = await grpcWebClient.getMemo({ name: created.name });
    expect(grpcWebMemo).toMatchObject({
      name: created.name,
      content: "official Connect client memo",
    });

    const userClient = createClient(
      UserService,
      createConnectTransport({
        baseUrl: "http://flaremo.test",
        fetch: fetchWithAuth,
        useBinaryFormat: true,
      }),
    );
    const grpcWebUserClient = createClient(
      UserService,
      createGrpcWebTransport({
        baseUrl: "http://flaremo.test",
        fetch: fetchWithAuth,
        useBinaryFormat: true,
      }),
    );

    const webhook = await userClient.createUserWebhook({
      parent: "users/owner",
      webhook: {
        url: "https://example.com/official-connect-hook",
        displayName: "Official client hook",
      },
    });
    expect(webhook).toMatchObject({
      name: expect.stringMatching(/^users\/owner\/webhooks\//),
      signingSecretSet: true,
      signingSecret: "",
    });
    const grpcWebWebhooks = await grpcWebUserClient.listUserWebhooks({
      parent: "users/owner",
    });
    expect(grpcWebWebhooks.webhooks).toHaveLength(1);

    const now = new Date().toISOString();
    await createDb(env.DB).insert(memosNotifications).values({
      receiverId: "users/owner",
      senderId: "users/owner",
      type: "memo_mention",
      status: "unread",
      sourceEventId: "official-client-notification",
      memoId: created.name,
      relatedMemoId: null,
      createdAt: now,
      updatedAt: now,
    });
    const notifications = await userClient.listUserNotifications({
      parent: "users/owner",
      pageSize: 10,
    });
    expect(notifications.notifications).toHaveLength(1);
    expect(notifications.notifications[0]?.payload.case).toBe("memoMention");
    expect(notifications.notifications[0]?.senderUser?.name).toBe(
      "users/owner",
    );

    const archived = await grpcWebUserClient.updateUserNotification({
      notification: {
        name: notifications.notifications[0]?.name ?? "",
        status: UserNotification_Status.ARCHIVED,
      },
      updateMask: { paths: ["status"] },
    });
    expect(archived.status).toBe(UserNotification_Status.ARCHIVED);

    const secret = await userClient.getUserWebhookSigningSecret({
      name: webhook.name,
    });
    expect(secret.signingSecret).toMatch(/^whsec_/);
  });
});

async function createTestRuntime() {
  const created = new Miniflare({
    script: "export default { fetch() { return new Response('ok') } }",
    modules: true,
    compatibilityDate: "2026-07-10",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: `flaremo-official-client-${crypto.randomUUID()}` },
    r2Buckets: {
      ATTACHMENTS: `flaremo-official-client-attachments-${crypto.randomUUID()}`,
    },
  });
  const db = await created.getD1Database("DB");
  for (const filename of [
    "0000_illegal_inhumans.sql",
    "0001_familiar_morph.sql",
    "0002_wooden_professor_monster.sql",
    "0003_equal_maximus.sql",
    "0004_complex_the_enforcers.sql",
    "0005_confused_masque.sql",
    "0006_silent_kylun.sql",
    "0007_flat_phil_sheldon.sql",
    "0008_legal_scarecrow.sql",
    "0009_neat_iron_fist.sql",
    "0010_deep_gateway.sql",
  ]) {
    const sql = await readFile(
      resolve(import.meta.dirname, `../../../migrations/${filename}`),
      "utf8",
    );
    for (const statement of sql
      .split("--> statement-breakpoint")
      .map((value) => value.trim())
      .filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
  runtime = created;
  env = {
    DB: db,
    ATTACHMENTS: await created.getR2Bucket("ATTACHMENTS"),
    ASSETS: {
      fetch: async () => new Response("asset", { status: 200 }),
    } as Fetcher,
    FLAREMO_SINGLE_USER_EMAIL: "owner@example.com",
    FLAREMO_SINGLE_USER_NAME: "Owner",
    FLAREMO_PUBLIC_URL: "http://flaremo.test",
    BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
    FLAREMO_BOOTSTRAP_SECRET: TEST_BOOTSTRAP_SECRET,
  } as Env;
  return created;
}

async function signIn() {
  const bootstrap = await app.fetch(
    new Request("http://flaremo.test/api/auth/flaremo/bootstrap", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://flaremo.test",
        "x-flaremo-bootstrap-secret": TEST_BOOTSTRAP_SECRET,
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
  expect(bootstrap.status).toBe(201);

  const response = await app.fetch(
    new Request("http://flaremo.test/api/v1/auth/signin", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://flaremo.test",
      },
      body: JSON.stringify({
        passwordCredentials: { username: "owner", password: TEST_PASSWORD },
      }),
    }),
    env,
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { accessToken: string }).accessToken;
}
