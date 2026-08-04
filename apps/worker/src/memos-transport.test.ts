import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createDb,
  memosNotifications,
  memosWebhookDeliveries,
} from "@flaremo/db";
import { dispatchMemosWebhookOutbox } from "@flaremo/domain";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "./index";
import { buildMemosRefreshCookie } from "./memos-native-auth";

let mf: Miniflare;
let env: Env;
let accessToken: string;
let sessionCookie: string;
let refreshCookie: string;
let opaqueSessionToken: string;
let refreshSetCookie: string;

const TEST_AUTH_SECRET =
  "transport-test-better-auth-secret-never-used-in-production";
const TEST_BOOTSTRAP_SECRET =
  "transport-test-bootstrap-secret-never-used-in-production";
const TEST_PASSWORD = "transport-test-password-never-production-123";

describe("Memos native auth and transport boundaries", () => {
  beforeEach(async () => {
    ({ mf, env } = await createTestRuntime());
    ({
      accessToken,
      opaqueSessionToken,
      sessionCookie,
      refreshCookie,
      refreshSetCookie,
    } = await signInCurrent());
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("rejects malformed, forged, expired, and wrongly-scoped native JWTs", async () => {
    const validClaims = {
      type: "access",
      role: "ADMIN",
      status: "NORMAL",
      username: "owner",
      iss: "memos",
      sub: "1",
      aud: ["user.access-token"],
      iat: Math.floor(Date.now() / 1_000),
      exp: Math.floor(Date.now() / 1_000) + 900,
    };

    const forged = await signTestJwt(validClaims, "wrong-secret");
    const wrongAudience = await signTestJwt(
      { ...validClaims, aud: ["wrong-audience"] },
      TEST_AUTH_SECRET,
    );
    const wrongKeyId = await signTestJwt(validClaims, TEST_AUTH_SECRET, {
      alg: "HS256",
      kid: "v2",
      typ: "JWT",
    });
    const wrongAlgorithm = await signTestJwt(validClaims, TEST_AUTH_SECRET, {
      alg: "HS512",
      kid: "v1",
      typ: "JWT",
    });
    const expired = await signTestJwt(
      { ...validClaims, exp: validClaims.iat - 1 },
      TEST_AUTH_SECRET,
    );

    for (const token of [
      "not-a-jwt",
      forged,
      wrongAudience,
      wrongKeyId,
      wrongAlgorithm,
      expired,
    ]) {
      const response = await request("/api/v1/auth/me", {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(401);
    }

    const native = await request("/api/v1/auth/me", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(native.status).toBe(200);
    expect(await native.json()).toMatchObject({
      user: { name: "users/owner", username: "owner" },
    });

    const opaqueSession = await request("/api/v1/auth/me", {
      headers: { authorization: `Bearer ${opaqueSessionToken}` },
    });
    expect(opaqueSession.status).toBe(200);
  });

  it("rotates and revokes memos_refresh with secure cookie attributes", async () => {
    expect(refreshSetCookie).toContain("HttpOnly");
    expect(refreshSetCookie).toContain("SameSite=Lax");
    expect(refreshSetCookie).toContain("Path=/");
    expect(refreshSetCookie).not.toContain("Secure");

    const secureCookie = buildMemosRefreshCookie(
      new Request("https://flaremo.test"),
      "fixture-refresh-token",
      new Date("2030-01-01T00:00:00.000Z"),
    );
    expect(secureCookie).toContain("HttpOnly");
    expect(secureCookie).toContain("SameSite=Lax");
    expect(secureCookie).toContain("Secure");

    const rotated = await request("/api/v1/auth/refresh", {
      method: "POST",
      headers: {
        cookie: refreshCookie,
        origin: "http://flaremo.test",
      },
    });
    expect(rotated.status).toBe(200);
    const rotatedCookies = setCookiePairs(rotated);
    const nextRefreshCookie = findCookie(rotatedCookies, "memos_refresh");
    expect(nextRefreshCookie).not.toBe(refreshCookie);
    expect((await rotated.json()) as { accessToken: string }).toMatchObject({
      accessToken: expect.any(String),
    });

    const reused = await request("/api/v1/auth/refresh", {
      method: "POST",
      headers: {
        cookie: refreshCookie,
        origin: "http://flaremo.test",
      },
    });
    expect(reused.status).toBe(401);

    const signedOut = await request("/api/v1/auth/signout", {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        cookie: nextRefreshCookie,
        origin: "http://flaremo.test",
      },
    });
    expect(signedOut.status).toBe(200);
    const cleared = findCookie(setCookieValues(signedOut), "memos_refresh");
    expect(cleared).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");

    const afterSignout = await request("/api/v1/auth/refresh", {
      method: "POST",
      headers: {
        cookie: nextRefreshCookie,
        origin: "http://flaremo.test",
      },
    });
    expect(afterSignout.status).toBe(401);
  });

  it("serves the canonical Connect JSON unary subset and authenticated SSE stream", async () => {
    const publicProfile = await request(
      "/memos.api.v1.InstanceService/GetInstanceProfile",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(publicProfile.status).toBe(200);
    const publicProfileBody = (await publicProfile.json()) as {
      needsSetup: boolean;
      admin?: { email?: string };
    };
    expect(publicProfileBody).toMatchObject({ needsSetup: false });
    expect(publicProfileBody.admin?.email).toBeUndefined();
    const publicProviders = await request(
      "/memos.api.v1.IdentityProviderService/ListIdentityProviders",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(publicProviders.status).toBe(200);
    expect(await publicProviders.json()).toEqual({ identityProviders: [] });
    const publicSensitiveSettings = await request(
      "/memos.api.v1.InstanceService/BatchGetInstanceSettings",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ names: ["instance/settings/STORAGE"] }),
      },
    );
    expect(publicSensitiveSettings.status).toBe(401);
    const publicWithWrongBearerOrigin = await request(
      "/memos.api.v1.InstanceService/GetInstanceProfile",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          origin: "https://untrusted.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      },
    );
    expect(publicWithWrongBearerOrigin.status).toBe(403);
    const publicWithWrongCookieOrigin = await request(
      "/memos.api.v1.InstanceService/GetInstanceProfile",
      {
        method: "POST",
        headers: {
          cookie: sessionCookie,
          origin: "https://untrusted.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      },
    );
    expect(publicWithWrongCookieOrigin.status).toBe(403);

    const connectPath = "/memos.api.v1.MemoService/CreateMemo";
    const unsupported = await request(connectPath, {
      method: "POST",
      headers: { "content-type": "application/proto" },
      body: "binary-not-supported",
    });
    expect(unsupported.status).toBe(400);

    const binaryCreate = await request(connectPath, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/proto",
      },
      body: encodeCreateMemoProto("Connect protobuf memo"),
    });
    expect(binaryCreate.status).toBe(200);
    expect(binaryCreate.headers.get("content-type")).toBe("application/proto");
    expect((await binaryCreate.arrayBuffer()).byteLength).toBeGreaterThan(0);

    const missingOriginCookieMutation = await request(connectPath, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: sessionCookie,
      },
      body: JSON.stringify({ memo: { content: "must require origin" } }),
    });
    expect(missingOriginCookieMutation.status).toBe(403);

    const created = await connect("CreateMemo", {
      memo: { content: "Connect JSON memo" },
    });
    expect(created).toMatchObject({
      name: expect.stringMatching(/^memos\//),
      content: "Connect JSON memo",
    });

    const publicMemo = await connect("CreateMemo", {
      memo: { content: "Connect public memo", visibility: "PUBLIC" },
    });
    const publicComment = await connect("CreateMemoComment", {
      name: publicMemo.name,
      comment: { content: "Public comment" },
    });
    const anonymousCurrentList = await request("/api/v1/memos");
    expect(anonymousCurrentList.status).toBe(200);
    const anonymousCurrentListBody = (await anonymousCurrentList.json()) as {
      memos: Array<{ name: string }>;
    };
    expect(anonymousCurrentListBody.memos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: publicMemo.name }),
      ]),
    );
    expect(anonymousCurrentListBody.memos).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: created.name })]),
    );
    const anonymousConnectMemo = await request(
      "/memos.api.v1.MemoService/GetMemo",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: publicMemo.name }),
      },
    );
    expect(anonymousConnectMemo.status).toBe(200);
    expect(await anonymousConnectMemo.json()).toMatchObject({
      name: publicMemo.name,
    });
    const anonymousConnectPrivate = await request(
      "/memos.api.v1.MemoService/GetMemo",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: created.name }),
      },
    );
    expect(anonymousConnectPrivate.status).toBe(404);
    const anonymousComments = await request(
      `/api/v1/${publicMemo.name}/comments`,
    );
    expect(anonymousComments.status).toBe(200);
    expect(await anonymousComments.json()).toMatchObject({
      memos: [expect.objectContaining({ name: publicComment.name })],
    });

    const listed = await connect("ListMemos", {
      pageSize: 10,
      orderBy: "create_time desc",
    });
    expect(listed.memos).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: created.name })]),
    );

    const fetched = await connect("GetMemo", { name: created.name });
    expect(fetched).toMatchObject({ name: created.name });

    const updated = await connect("UpdateMemo", {
      memo: { name: created.name, pinned: true },
      updateMask: "pinned",
    });
    expect(updated).toMatchObject({ name: created.name, pinned: true });

    const related = await connect("CreateMemo", {
      memo: { content: "Connect related memo" },
    });
    await connect("SetMemoRelations", {
      name: created.name,
      relations: [{ relatedMemo: { name: related.name }, type: "REFERENCE" }],
    });
    const relationList = await connect("ListMemoRelations", {
      name: created.name,
    });
    expect(relationList.relations[0]?.relatedMemo.name).toBe(related.name);
    expect(relationList.relations[0]?.type).toBe("REFERENCE");

    const incomingRelationList = await connect("ListMemoRelations", {
      name: related.name,
    });
    expect(incomingRelationList.relations).toEqual([
      expect.objectContaining({
        memo: { name: created.name, snippet: expect.any(String) },
        relatedMemo: { name: related.name, snippet: expect.any(String) },
        type: "REFERENCE",
      }),
    ]);

    const attachment = await request("/api/v1/attachments", {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        attachment: {
          filename: "connect.txt",
          content: "Y29ubmVjdA==",
          type: "text/plain",
          memo: created.name,
        },
      }),
    });
    expect(attachment.status).toBe(200);
    const attachmentBody = (await attachment.json()) as { name: string };
    await connect("SetMemoAttachments", {
      name: created.name,
      attachments: [{ name: attachmentBody.name }],
    });
    const attachmentList = await connect("ListMemoAttachments", {
      name: created.name,
    });
    expect(attachmentList.attachments).toEqual([
      expect.objectContaining({ name: attachmentBody.name }),
    ]);

    const secondAttachment = await request("/api/v1/attachments", {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        attachment: {
          filename: "second-connect.txt",
          content: "c2Vjb25k",
          type: "text/plain",
          memo: created.name,
        },
      }),
    });
    expect(secondAttachment.status).toBe(200);
    const secondAttachmentBody = (await secondAttachment.json()) as {
      name: string;
    };

    const firstAttachmentPage = await connectService(
      "AttachmentService",
      "ListAttachments",
      { pageSize: 1, orderBy: "filename asc" },
    );
    expect(firstAttachmentPage.attachments).toHaveLength(1);
    expect(firstAttachmentPage.totalSize).toBeGreaterThanOrEqual(2);
    expect(firstAttachmentPage.nextPageToken).toEqual(expect.any(String));

    const secondAttachmentPage = await connectService(
      "AttachmentService",
      "ListAttachments",
      {
        pageSize: 1,
        orderBy: "filename asc",
        pageToken: firstAttachmentPage.nextPageToken,
      },
    );
    expect(secondAttachmentPage.attachments).toHaveLength(1);
    expect(secondAttachmentPage.nextPageToken).toBeUndefined();
    expect(secondAttachmentPage.attachments[0]?.name).toBe(
      secondAttachmentBody.name,
    );

    const mismatchedAttachmentToken = await request(
      "/memos.api.v1.AttachmentService/ListAttachments",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          pageSize: 1,
          orderBy: "create_time desc",
          pageToken: firstAttachmentPage.nextPageToken,
        }),
      },
    );
    expect(mismatchedAttachmentToken.status).toBe(400);

    const filteredAttachments = await connectService(
      "AttachmentService",
      "ListAttachments",
      { filter: 'filename.contains("second-connect")' },
    );
    expect(filteredAttachments.attachments).toEqual([
      expect.objectContaining({ name: secondAttachmentBody.name }),
    ]);

    const comment = await connect("CreateMemoComment", {
      name: created.name,
      comment: { content: "Connect comment" },
    });
    expect(comment).toMatchObject({
      content: "Connect comment",
      parent: created.name,
    });
    const comments = await connect("ListMemoComments", {
      name: created.name,
      pageSize: 10,
    });
    expect(comments.memos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: comment.name, parent: created.name }),
      ]),
    );

    const reaction = await connect("UpsertMemoReaction", {
      name: created.name,
      reaction: { contentId: created.name, reactionType: "👍" },
    });
    expect(reaction).toMatchObject({
      contentId: created.name,
      reactionType: "👍",
    });
    const reactions = await connect("ListMemoReactions", {
      name: created.name,
    });
    expect(reactions.reactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: reaction.name }),
      ]),
    );
    await connect("DeleteMemoReaction", { name: reaction.name });

    const share = await connect("CreateMemoShare", {
      parent: created.name,
      memoShare: {},
    });
    expect(share.name).toMatch(new RegExp(`^${created.name}/shares/[^/]+$`));
    const shares = await connect("ListMemoShares", { parent: created.name });
    expect(shares.memoShares).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: share.name })]),
    );
    const shareToken = String(share.name).split("/").at(-1);
    const shared = await request("/memos.api.v1.MemoService/GetSharedMemo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shareToken }),
    });
    expect(shared.status).toBe(200);
    expect(await shared.json()).toMatchObject({ name: created.name });
    const canonicalShared = await request(
      "/memos.api.v1.MemoService/GetMemoByShare",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shareId: shareToken }),
      },
    );
    expect(canonicalShared.status).toBe(200);
    expect(await canonicalShared.json()).toMatchObject({ name: created.name });
    await connect("DeleteMemoShare", { name: share.name });

    const profile = await connectService(
      "InstanceService",
      "GetInstanceProfile",
      {},
    );
    expect(profile).toMatchObject({
      demo: false,
      needsSetup: false,
      admin: { name: "users/owner" },
    });
    const instanceSettings = await connectService(
      "InstanceService",
      "BatchGetInstanceSettings",
      {
        names: ["instance/settings/GENERAL", "instance/settings/MEMO_RELATED"],
      },
    );
    expect(instanceSettings.settings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "instance/settings/GENERAL",
          generalSetting: expect.objectContaining({
            disallowUserRegistration: true,
          }),
        }),
      ]),
    );

    const listedUsers = await connectService("UserService", "ListUsers", {});
    expect(listedUsers).toMatchObject({
      users: [expect.objectContaining({ name: "users/owner" })],
      totalSize: 1,
    });
    const userSettings = await connectService(
      "UserService",
      "ListUserSettings",
      {
        parent: "users/owner",
      },
    );
    expect(userSettings.settings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "users/owner/settings/GENERAL" }),
      ]),
    );
    const providers = await connectService(
      "IdentityProviderService",
      "ListIdentityProviders",
      {},
    );
    expect(providers).toEqual({ identityProviders: [] });

    const connectAttachments = await connectService(
      "AttachmentService",
      "ListAttachments",
      { pageSize: 10 },
    );
    expect(connectAttachments.attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: attachmentBody.name }),
      ]),
    );

    const invalidLink = await request(
      "/memos.api.v1.MemoService/GetLinkMetadata",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "http://127.0.0.1/" }),
      },
    );
    expect(invalidLink.status).toBe(400);
    const emptyBinaryLink = await request(
      "/memos.api.v1.MemoService/GetLinkMetadata",
      {
        method: "POST",
        headers: { "content-type": "application/proto" },
        body: new Uint8Array(),
      },
    );
    expect(emptyBinaryLink.status).toBe(400);
    expect(emptyBinaryLink.headers.get("grpc-status")).toBe("3");
    const emptyBatch = await request(
      "/memos.api.v1.MemoService/BatchGetLinkMetadata",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ urls: [] }),
      },
    );
    expect(emptyBatch.status).toBe(400);

    const grpcWebCreate = await request(
      "/memos.api.v1.MemoService/CreateMemo",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/grpc+proto",
        },
        body: frameProto(encodeCreateMemoProto("gRPC framed memo")),
      },
    );
    expect(grpcWebCreate.status).toBe(200);
    expect(grpcWebCreate.headers.get("grpc-status")).toBe("0");
    expect(
      new TextDecoder().decode(await grpcWebCreate.arrayBuffer()),
    ).toContain("gRPC framed memo");

    const grpcWebTextCreate = await request(
      "/memos.api.v1.MemoService/CreateMemo",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/grpc-web-text+proto",
        },
        body: encodeBase64(
          frameProto(encodeCreateMemoProto("gRPC-Web text memo")),
        ),
      },
    );
    expect(grpcWebTextCreate.status).toBe(200);
    expect(grpcWebTextCreate.headers.get("content-type")).toBe(
      "application/grpc-web-text+proto",
    );
    expect(atob(await grpcWebTextCreate.text())).toContain(
      "gRPC-Web text memo",
    );

    const binaryList = await request("/memos.api.v1.MemoService/ListMemos", {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/grpc+proto",
      },
      body: frameProto(encodeListMemosProto()),
    });
    expect(binaryList.status).toBe(200);
    expect(new TextDecoder().decode(await binaryList.arrayBuffer())).toContain(
      "Connect JSON memo",
    );

    const nativeGrpcList = await request(
      "/memos.api.v1.MemoService/ListMemos",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/grpc",
        },
        body: frameProto(encodeListMemosProto()),
      },
    );
    expect(nativeGrpcList.status).toBe(200);
    expect(nativeGrpcList.headers.get("grpc-status")).toBe("0");
    expect(
      new TextDecoder().decode(await nativeGrpcList.arrayBuffer()),
    ).toContain("Connect JSON memo");

    const binaryGet = await request("/memos.api.v1.MemoService/GetMemo", {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/proto",
      },
      body: encodeGetMemoProto(created.name),
    });
    expect(binaryGet.status).toBe(200);
    expect(new TextDecoder().decode(await binaryGet.arrayBuffer())).toContain(
      created.name,
    );

    const binaryUpdate = await request("/memos.api.v1.MemoService/UpdateMemo", {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/proto",
      },
      body: encodeUpdateMemoProto(created.name),
    });
    expect(binaryUpdate.status).toBe(200);
    const updatedAfterBinary = await connect("GetMemo", { name: created.name });
    expect(updatedAfterBinary.pinned).toBe(true);

    const binaryShortcut = await request(
      "/memos.api.v1.ShortcutService/CreateShortcut",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/grpc-web+proto",
        },
        body: frameProto(encodeCreateShortcutProto()),
      },
    );
    expect(binaryShortcut.status).toBe(200);
    expect(
      new TextDecoder().decode(await binaryShortcut.arrayBuffer()),
    ).toContain("Transport shortcut");

    const authBinary = await request("/memos.api.v1.AuthService/SignIn", {
      method: "POST",
      headers: {
        "content-type": "application/proto",
        origin: "http://flaremo.test",
      },
      body: encodeSignInProto(),
    });
    expect(authBinary.status).toBe(200);
    expect(new TextDecoder().decode(await authBinary.arrayBuffer())).toContain(
      "users/owner",
    );

    const binarySignOut = await request("/memos.api.v1.AuthService/SignOut", {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        cookie: refreshCookie,
        "content-type": "application/proto",
        origin: "http://flaremo.test",
      },
      body: new Uint8Array(),
    });
    expect(binarySignOut.status).toBe(200);
    expect(binarySignOut.headers.get("content-type")).toBe("application/proto");
    expect(new Uint8Array(await binarySignOut.arrayBuffer())).toHaveLength(0);

    const compressed = await request("/memos.api.v1.MemoService/CreateMemo", {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/grpc+proto",
      },
      body: Uint8Array.of(1, 0, 0, 0, 0),
    });
    expect(compressed.status).toBe(400);

    const unauthenticatedBinary = await request(
      "/memos.api.v1.UserService/ListUsers",
      {
        method: "POST",
        headers: { "content-type": "application/grpc+proto" },
        body: frameProto(new Uint8Array()),
      },
    );
    expect(unauthenticatedBinary.status).toBe(401);
    expect(unauthenticatedBinary.headers.get("grpc-status")).toBe("16");

    const deleted = await connect("DeleteMemo", {
      name: created.name,
      force: true,
    });
    expect(deleted).toEqual({});
    const deletedLookup = await request("/memos.api.v1.MemoService/GetMemo", {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: created.name }),
    });
    expect(deletedLookup.status).toBe(404);

    const unauthenticated = await request("/api/v1/sse");
    expect(unauthenticated.status).toBe(401);

    const abortController = new AbortController();
    const sse = await request("/api/v1/sse", {
      headers: {
        authorization: `Bearer ${accessToken}`,
        "last-event-id": "0",
      },
      signal: abortController.signal,
    });
    expect(sse.status).toBe(200);
    expect(sse.headers.get("content-type")).toContain("text/event-stream");
    const reader = sse.body?.getReader();
    expect(reader).toBeTruthy();
    const first = await reader?.read();
    expect(new TextDecoder().decode(first?.value)).toContain(": connected");
    const replay = await reader?.read();
    expect(new TextDecoder().decode(replay?.value)).toMatch(
      /id: \d+\ndata: \{"type":"memo\.created","name":"memos\//,
    );
    abortController.abort();
    await reader?.cancel();
  });

  it("serves UserService webhook and notification lifecycle over Connect JSON", async () => {
    for (const url of [
      "http://127.0.0.1/hook",
      "http://localhost/hook",
      "http://service.local/hook",
      "ftp://example.com/hook",
      "https://user:password@example.com/hook",
      "https://example.com/hook#fragment",
    ]) {
      const invalid = await request(
        "/memos.api.v1.UserService/CreateUserWebhook",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            parent: "users/owner",
            webhook: { url },
          }),
        },
      );
      expect(invalid.status).toBe(400);
    }
    const invalidSecret = await request(
      "/memos.api.v1.UserService/CreateUserWebhook",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          parent: "users/owner",
          webhook: {
            url: "https://example.com/invalid-secret",
            signingSecret: "whsec_not-base64",
          },
        }),
      },
    );
    expect(invalidSecret.status).toBe(400);

    const webhook = await connectService("UserService", "CreateUserWebhook", {
      parent: "users/owner",
      webhook: {
        url: "https://example.com/flaremo-hook",
        displayName: "Compatibility hook",
      },
    });
    expect(webhook).toMatchObject({
      name: expect.stringMatching(/^users\/owner\/webhooks\/[0-9a-f-]+$/),
      url: "https://example.com/flaremo-hook",
      displayName: "Compatibility hook",
      signingSecretSet: true,
    });
    expect(webhook.signingSecret).toBeUndefined();

    const pat = await connectService(
      "UserService",
      "CreatePersonalAccessToken",
      { parent: "users/owner", description: "transport lifecycle test" },
    );
    expect(pat.token).toEqual(expect.any(String));
    const patMutation = await request(
      "/memos.api.v1.UserService/CreateUserWebhook",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${String(pat.token)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          parent: "users/owner",
          webhook: { url: "https://example.com/pat-mutation" },
        }),
      },
    );
    expect(patMutation.status).toBe(403);

    const listedWebhooks = await connectService(
      "UserService",
      "ListUserWebhooks",
      { parent: "users/owner" },
    );
    expect(listedWebhooks.webhooks).toEqual([webhook]);

    const webhookName = String(webhook.name);
    const secret = await connectService(
      "UserService",
      "GetUserWebhookSigningSecret",
      { name: webhookName },
    );
    expect(secret.signingSecret).toMatch(/^whsec_[A-Za-z0-9+/]+=*$/);

    const updatedWebhook = await connectService(
      "UserService",
      "UpdateUserWebhook",
      {
        webhook: { name: webhookName, url: "https://example.com/updated" },
        updateMask: "url",
      },
    );
    expect(updatedWebhook).toMatchObject({
      name: webhookName,
      url: "https://example.com/updated",
      signingSecretSet: true,
    });

    const memo = await connect("CreateMemo", {
      memo: { content: "notification source memo" },
    });
    const now = new Date().toISOString();
    await createDb(env.DB)
      .insert(memosNotifications)
      .values({
        receiverId: "users/owner",
        senderId: "users/owner",
        type: "memo_comment",
        status: "unread",
        sourceEventId: "notification-fixture",
        memoId: String(memo.name),
        relatedMemoId: String(memo.name),
        createdAt: now,
        updatedAt: now,
      });

    const listedNotifications = await connectService(
      "UserService",
      "ListUserNotifications",
      { parent: "users/owner", pageSize: 10 },
    );
    const notification = (
      listedNotifications.notifications as Array<Record<string, unknown>>
    )[0];
    expect(notification).toMatchObject({
      name: expect.stringMatching(/^users\/owner\/notifications\/\d+$/),
      sender: "users/owner",
      status: "UNREAD",
      type: "MEMO_COMMENT",
      senderUser: { name: "users/owner", username: "owner" },
      memoComment: {
        memo: memo.name,
        relatedMemo: memo.name,
        memoSnippet: "notification source memo",
      },
    });

    const archived = await connectService(
      "UserService",
      "UpdateUserNotification",
      {
        notification: { name: notification.name, status: "ARCHIVED" },
        updateMask: "status",
      },
    );
    expect(archived).toMatchObject({
      name: notification.name,
      status: "ARCHIVED",
    });

    await connectService("UserService", "DeleteUserNotification", {
      name: notification.name,
    });
    await connectService("UserService", "DeleteUserWebhook", {
      name: webhookName,
    });
    expect(
      (
        await connectService("UserService", "ListUserWebhooks", {
          parent: "users/owner",
        })
      ).webhooks,
    ).toEqual([]);
  });

  it("delivers memo webhooks from the durable outbox with Standard Webhooks headers", async () => {
    const webhook = await connectService("UserService", "CreateUserWebhook", {
      parent: "users/owner",
      webhook: {
        url: "https://example.com/outbox-hook",
        displayName: "Outbox hook",
        signingSecret: "transport-webhook-signing-secret",
      },
    });
    const memo = await connect("CreateMemo", {
      memo: { content: "outbox delivery memo" },
    });
    const requests: Request[] = [];
    const fetchMock = vi
      .fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(new Request(input, init));
        return new Response(JSON.stringify({ code: 0 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      })
      .mockImplementationOnce(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          requests.push(new Request(input, init));
          return new Response("retry later", { status: 503 });
        },
      );
    vi.stubGlobal("fetch", fetchMock);
    const attemptStart = new Date();
    try {
      await dispatchMemosWebhookOutbox(createDb(env.DB), attemptStart);
      const retrying = await createDb(env.DB)
        .select()
        .from(memosWebhookDeliveries)
        .all();
      expect(retrying).toMatchObject([
        { status: "pending", attempts: 1, lastError: "http_503" },
      ]);
      await dispatchMemosWebhookOutbox(
        createDb(env.DB),
        new Date(attemptStart.getTime() + 3_000),
      );
    } finally {
      vi.unstubAllGlobals();
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const request = requests[1];
    expect(request).toBeDefined();
    expect(request.url).toBe("https://example.com/outbox-hook");
    expect(request.headers.get("webhook-id")).toMatch(/^msg_\d+_\d+$/u);
    expect(request.headers.get("webhook-timestamp")).toMatch(/^\d+$/u);
    expect(request.headers.get("webhook-signature")).toMatch(
      /^v1,[A-Za-z0-9+/]+=*$/u,
    );
    const body = (await request.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      url: "https://example.com/outbox-hook",
      activityType: "memos.memo.created",
      creator: "users/owner",
      memo: { name: memo.name, content: "outbox delivery memo" },
    });
    expect(JSON.stringify(body)).not.toContain(
      "transport-webhook-signing-secret",
    );

    const deliveries = await createDb(env.DB)
      .select()
      .from(memosWebhookDeliveries)
      .all();
    expect(deliveries).toMatchObject([
      { status: "delivered", attempts: 2, deliveredAt: expect.any(String) },
    ]);
    expect(webhook.signingSecret).toBeUndefined();
  });
});

async function connect(method: string, body: Record<string, unknown>) {
  return connectService("MemoService", method, body);
}

async function connectService(
  service: string,
  method: string,
  body: Record<string, unknown>,
) {
  const response = await request(`/memos.api.v1.${service}/${method}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<Record<string, unknown>>;
}

function request(path: string, init: RequestInit = {}) {
  return app.fetch(new Request(`http://flaremo.test${path}`, init), env);
}

async function signInCurrent() {
  const setup = await request("/api/auth/flaremo/bootstrap", {
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
  });
  expect(setup.status).toBe(201);

  const response = await request("/api/v1/auth/signin", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://flaremo.test",
    },
    body: JSON.stringify({
      passwordCredentials: {
        username: "owner",
        password: TEST_PASSWORD,
      },
    }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { accessToken: string };
  const rawSetCookies = setCookieValues(response);
  const cookies = rawSetCookies.map((value) => value.split(";", 1)[0] ?? "");
  const nativeRefreshCookie = findCookie(cookies, "memos_refresh");
  const nativeRefreshSetCookie = findCookie(rawSetCookies, "memos_refresh");
  const browserCookies = cookies.filter(
    (cookie) => !cookie.startsWith("memos_refresh="),
  );
  expect(browserCookies.length).toBeGreaterThan(0);

  const opaqueResponse = await request("/api/auth/sign-in/username", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://flaremo.test",
    },
    body: JSON.stringify({ username: "owner", password: TEST_PASSWORD }),
  });
  expect(opaqueResponse.status).toBe(200);
  const opaqueBody = (await opaqueResponse.json()) as { token: string };
  return {
    accessToken: body.accessToken,
    opaqueSessionToken: opaqueBody.token,
    sessionCookie: browserCookies.join("; "),
    refreshCookie: nativeRefreshCookie,
    refreshSetCookie: nativeRefreshSetCookie,
  };
}

function setCookieValues(response: Response) {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  return (headers.getSetCookie?.() ?? [response.headers.get("set-cookie")])
    .filter((value): value is string => Boolean(value))
    .filter(Boolean);
}

function setCookiePairs(response: Response) {
  return setCookieValues(response).map((value) => value.split(";", 1)[0] ?? "");
}

function findCookie(cookies: string[], name: string) {
  const cookie = cookies.find((value) => value.startsWith(`${name}=`));
  if (!cookie) throw new Error(`test cookie ${name} missing`);
  return cookie;
}

function encodeCreateMemoProto(content: string) {
  const contentBytes = new TextEncoder().encode(content);
  const memo = Uint8Array.from([
    0x3a,
    contentBytes.length,
    ...contentBytes,
    0x48,
    1,
  ]);
  return Uint8Array.from([0x0a, memo.length, ...memo]);
}

function encodeListMemosProto() {
  return Uint8Array.of(0x08, 0x0a);
}

function encodeGetMemoProto(name: string) {
  return encodeStringField(1, name);
}

function encodeUpdateMemoProto(name: string) {
  const memo = concat(encodeStringField(1, name), Uint8Array.of(0x58, 0x01));
  const updateMask = encodeStringField(1, "pinned");
  return concat(encodeMessageField(1, memo), encodeMessageField(2, updateMask));
}

function encodeCreateShortcutProto() {
  const shortcut = concat(
    encodeStringField(2, "Transport shortcut"),
    encodeStringField(3, "pinned == true"),
  );
  return concat(
    encodeStringField(1, "users/owner"),
    encodeMessageField(2, shortcut),
  );
}

function encodeSignInProto() {
  const credentials = concat(
    encodeStringField(1, "owner"),
    encodeStringField(2, TEST_PASSWORD),
  );
  return encodeMessageField(1, credentials);
}

function encodeStringField(field: number, value: string) {
  const bytes = new TextEncoder().encode(value);
  return concat(
    encodeVarint((field << 3) | 2),
    encodeVarint(bytes.length),
    bytes,
  );
}

function encodeMessageField(field: number, value: Uint8Array) {
  return concat(
    encodeVarint((field << 3) | 2),
    encodeVarint(value.length),
    value,
  );
}

function encodeVarint(value: number) {
  const output: number[] = [];
  let current = BigInt(value);
  while (current > 127n) {
    output.push(Number((current & 127n) | 128n));
    current >>= 7n;
  }
  output.push(Number(current));
  return Uint8Array.from(output);
}

function frameProto(payload: Uint8Array) {
  const frame = new Uint8Array(payload.length + 5);
  new DataView(frame.buffer).setUint32(1, payload.length);
  frame.set(payload, 5);
  return frame;
}

function encodeBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function concat(...values: Uint8Array[]) {
  const output = new Uint8Array(
    values.reduce((length, value) => length + value.length, 0),
  );
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.length;
  }
  return output;
}

async function createTestRuntime() {
  const runtime = new Miniflare({
    script: "export default { fetch() { return new Response('ok') } }",
    modules: true,
    compatibilityDate: "2026-07-10",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: `flaremo-transport-${crypto.randomUUID()}` },
    r2Buckets: {
      ATTACHMENTS: `flaremo-transport-attachments-${crypto.randomUUID()}`,
    },
  });
  const db = await runtime.getD1Database("DB");
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
  mf = runtime;
  env = {
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
  } as Env;
  return { mf, env };
}

async function signTestJwt(
  payload: Record<string, unknown>,
  secret: string,
  header = { alg: "HS256", kid: "v1", typ: "JWT" },
) {
  const encodedHeader = encodeBase64Url(JSON.stringify(header));
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${encodeBase64Url(new Uint8Array(signature))}`;
}

function encodeBase64Url(value: string | Uint8Array) {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}
