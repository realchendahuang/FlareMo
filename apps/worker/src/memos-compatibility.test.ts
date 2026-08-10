import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { FLAREMO_API_VERSION } from "@flaremo/contracts";
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

describe("Memos-compatible API contract", () => {
  beforeEach(async () => {
    ({ mf, env } = await createTestRuntime("source"));
    sessionCookie = await bootstrapAndSignIn();
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("keeps core memo DTO shape stable", async () => {
    const created = await json(
      await fetchApp("http://flaremo.test/api/v1/memos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "contract memo #compat",
          visibility: "protected",
          payload: {
            tags: ["compat"],
            property: { has_link: true },
          },
        }),
      }),
      201,
    );

    expect(created).toMatchObject({
      name: expect.stringMatching(/^memos\//),
      id: expect.any(String),
      content: "contract memo #compat",
      visibility: "protected",
      state: "normal",
      pinned: false,
      creator: expect.stringMatching(/^users\//),
      payload: {
        tags: ["compat"],
      },
    });
    expect(created.create_time).toEqual(expect.any(String));
    expect(created.update_time).toEqual(expect.any(String));
    expect(created.display_time).toEqual(expect.any(String));

    const listed = await json(
      await fetchApp("http://flaremo.test/api/v1/memos?tag=compat"),
    );
    expect(listed.memos).toHaveLength(1);
    expect(listed.memos[0].name).toBe(created.name);

    const updated = await json(
      await fetchApp(`http://flaremo.test/api/v1/${created.name}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pinned: true, visibility: "public" }),
      }),
    );
    expect(updated.pinned).toBe(true);
    expect(updated.visibility).toBe("public");
  });

  it("covers the complete memo CRUD contract and field mutations", async () => {
    const created = await json(
      await fetchApp("http://flaremo.test/api/v1/memos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "complete CRUD #alpha",
          visibility: "private",
          source: "compat-fixture",
          payload: { tags: ["alpha"], client_id: "fixture-client" },
        }),
      }),
      201,
    );

    const fetched = await json(
      await fetchApp(`http://flaremo.test/api/v1/${created.name}`),
    );
    expect(fetched).toEqual(created);

    const updated = await json(
      await fetchApp(`http://flaremo.test/api/v1/${created.name}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "updated CRUD #beta",
          visibility: "protected",
          status: "archived",
          pinned: true,
          payload: { tags: ["beta"], client_id: "updated-client" },
        }),
      }),
    );
    expect(updated).toMatchObject({
      name: created.name,
      id: created.id,
      content: "updated CRUD #beta",
      visibility: "protected",
      state: "archived",
      pinned: true,
      creator: created.creator,
      payload: { tags: ["beta"], client_id: "updated-client" },
    });
    expect(Date.parse(updated.update_time)).toBeGreaterThanOrEqual(
      Date.parse(created.update_time),
    );

    const trashed = await json(
      await fetchApp(`http://flaremo.test/api/v1/${created.name}`, {
        method: "DELETE",
      }),
    );
    expect(trashed).toMatchObject({
      name: created.name,
      state: "trashed",
      pinned: true,
    });

    const hardDeleted = await json(
      await fetchApp(`http://flaremo.test/api/v1/${created.name}?hard=true`, {
        method: "DELETE",
      }),
    );
    expect(hardDeleted).toEqual({ ok: true });
    expect(
      (await fetchApp(`http://flaremo.test/api/v1/${created.name}`)).status,
    ).toBe(404);
  });

  it("combines state, visibility, pinned, tag, pagination, and ordering", async () => {
    const normalAlpha = await createMemoWith({
      content: "normal alpha #alpha",
      visibility: "private",
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const publicAlpha = await createMemoWith({
      content: "public alpha #alpha",
      visibility: "public",
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const archivedBeta = await createMemoWith({
      content: "archived beta #beta",
      visibility: "protected",
    });

    await json(
      await fetchApp(`http://flaremo.test/api/v1/${publicAlpha.name}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pinned: true }),
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 2));
    await json(
      await fetchApp(`http://flaremo.test/api/v1/${archivedBeta.name}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "archived",
          content: "archived beta revised #beta",
        }),
      }),
    );

    const alpha = await listMemos("state=normal&tag=alpha");
    expect(alpha.memos.map((memo: { name: string }) => memo.name)).toEqual([
      publicAlpha.name,
      normalAlpha.name,
    ]);
    expect(
      alpha.memos.every(
        (memo: { payload: { tags?: string[] }; state: string }) =>
          memo.state === "normal" && memo.payload.tags?.includes("alpha"),
      ),
    ).toBe(true);

    const archived = await listMemos("state=archived&tag=beta");
    expect(archived.memos).toHaveLength(1);
    expect(archived.memos[0]).toMatchObject({
      name: archivedBeta.name,
      state: "archived",
      visibility: "protected",
      pinned: false,
    });

    for (const orderBy of [
      "created_at asc",
      "created_at desc",
      "updated_at asc",
      "updated_at desc",
    ]) {
      const names: string[] = [];
      let pageToken: string | undefined;
      do {
        const params = new URLSearchParams({
          include_deleted: "true",
          order_by: orderBy,
          page_size: "1",
        });
        if (pageToken) params.set("page_token", pageToken);
        const page = await listMemos(params.toString());
        names.push(...page.memos.map((memo: { name: string }) => memo.name));
        pageToken = page.next_page_token;
      } while (pageToken);

      expect(new Set(names)).toEqual(
        new Set([normalAlpha.name, publicAlpha.name, archivedBeta.name]),
      );
      expect(names[0]).toBe(publicAlpha.name);
    }

    const firstPage = await listMemos(
      "include_deleted=true&page_size=1&order_by=created_at%20asc",
    );
    const mismatchedToken = await fetchApp(
      `http://flaremo.test/api/v1/memos?include_deleted=true&page_size=1&order_by=created_at%20desc&page_token=${encodeURIComponent(firstPage.next_page_token)}`,
    );
    expect(mismatchedToken.status).toBe(400);
  });

  it("roundtrips memos, attachments, relations, and shares into an empty store", async () => {
    const memo = await createMemo("exportable memo #bundle");
    const related = await createMemo("related memo #bundle");
    const formData = new FormData();
    formData.set("memo", memo.name);
    formData.set(
      "file",
      new File(["bundle attachment"], "bundle.txt", { type: "text/plain" }),
    );

    const attachment = await json(
      await fetchApp("http://flaremo.test/api/v1/attachments", {
        method: "POST",
        body: formData,
      }),
      201,
    );
    await json(
      await fetchApp(`http://flaremo.test/api/v1/${memo.name}/relations`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          relations: [{ related_memo: related.name, type: "reference" }],
        }),
      }),
    );
    const share = await json(
      await fetchApp(`http://flaremo.test/api/v1/${memo.name}/shares`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      201,
    );

    const bundle = await json(
      await fetchApp("http://flaremo.test/api/v1/export"),
    );
    expect(bundle.memos).toHaveLength(2);
    expect(bundle.attachments).toHaveLength(1);
    expect(bundle.relations).toHaveLength(1);
    expect(bundle.shares).toHaveLength(1);
    const exportedAttachment = bundle.attachments.find(
      (item: { name: string }) => item.name === attachment.name,
    );
    expect(exportedAttachment).toMatchObject({
      name: attachment.name,
      filename: "bundle.txt",
      content_type: "text/plain",
      data_base64: "YnVuZGxlIGF0dGFjaG1lbnQ=",
    });

    await mf.dispose();
    ({ mf, env } = await createTestRuntime("restored"));
    sessionCookie = await bootstrapAndSignIn();

    const imported = await json(
      await fetchApp("http://flaremo.test/api/v1/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bundle),
      }),
    );
    expect(imported).toMatchObject({
      imported_memos: 2,
      imported_attachments: 1,
      imported_relations: 1,
      imported_shares: 1,
      skipped_memos: 0,
      overwritten_memos: 0,
    });

    const restoredMemos = await listMemos("include_deleted=true&page_size=100");
    expect(restoredMemos.memos.map((item) => item.content).sort()).toEqual([
      "exportable memo #bundle",
      "related memo #bundle",
    ]);
    const restoredMemo = restoredMemos.memos.find(
      (item) => item.content === "exportable memo #bundle",
    );
    expect(restoredMemo).toBeTruthy();

    const restoredAttachments = await json(
      await fetchApp(
        `http://flaremo.test/api/v1/${restoredMemo?.name}/attachments`,
      ),
    );
    expect(restoredAttachments.attachments).toHaveLength(1);
    const restoredBlob = await fetchApp(
      `http://flaremo.test/api/v1/${restoredAttachments.attachments[0].name}/blob`,
    );
    expect(restoredBlob.status).toBe(200);
    expect(await restoredBlob.text()).toBe("bundle attachment");

    const relationContext = await json(
      await fetchApp(
        `http://flaremo.test/api/v1/${restoredMemo?.name}/relation-context`,
      ),
    );
    expect(relationContext.relations).toHaveLength(1);
    expect(relationContext.relations[0].memo.content).toBe(
      "related memo #bundle",
    );

    const restoredShares = await json(
      await fetchApp(`http://flaremo.test/api/v1/${restoredMemo?.name}/shares`),
    );
    expect(restoredShares.shares).toHaveLength(1);
    expect(restoredShares.shares[0].token).not.toBe(share.token);
    expect(restoredShares.shares[0].token).toEqual(expect.any(String));
    const publicShare = await json(
      await fetchApp(
        `http://flaremo.test/api/public/shares/${restoredShares.shares[0].token}`,
      ),
    );
    expect(publicShare.memo.content).toBe("exportable memo #bundle");
    expect(publicShare.attachments).toHaveLength(1);

    const objectsAfterImport = await env.ATTACHMENTS.list();
    expect(objectsAfterImport.objects).toHaveLength(1);
    const skipped = await json(
      await fetchApp("http://flaremo.test/api/v1/import?conflict=skip", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bundle),
      }),
    );
    expect(skipped.imported_memos).toBe(0);
    expect(skipped.skipped_memos).toBeGreaterThanOrEqual(1);
    expect(skipped.imported_attachments).toBe(0);
    expect((await env.ATTACHMENTS.list()).objects).toHaveLength(
      objectsAfterImport.objects.length,
    );

    const overwritten = await json(
      await fetchApp("http://flaremo.test/api/v1/import?conflict=overwrite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bundle),
      }),
    );
    expect(overwritten.overwritten_memos).toBeGreaterThanOrEqual(1);
    expect(overwritten.imported_attachments).toBeGreaterThanOrEqual(1);
    expect((await env.ATTACHMENTS.list()).objects).toHaveLength(
      objectsAfterImport.objects.length,
    );
  });

  it("documents every supported public path in OpenAPI", async () => {
    const openapi = await json(
      await fetchApp("http://flaremo.test/openapi.json", {
        headers: { "x-flaremo-wire": "legacy" },
      }),
    );
    expect(openapi.info.version).toBe(FLAREMO_API_VERSION);
    const paths = Object.keys(openapi.paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/api/v1/memos",
        "/api/v1/memos/{id}",
        "/api/v1/memos/{id}/attachments",
        "/api/v1/memos/{id}/context",
        "/api/v1/memos/{id}/relation-context",
        "/api/v1/memos/{id}/relations",
        "/api/v1/memos/{id}/revisions",
        "/api/v1/memos/{id}/revisions/restore",
        "/api/v1/memos/{id}/shares",
        "/api/v1/shares/{share_id}",
        "/api/public/shares/{token}",
        "/api/public/shares/{token}/attachments/{id}/blob",
        "/api/v1/attachments",
        "/api/v1/attachments/{id}",
        "/api/v1/attachments/{id}/blob",
        "/api/v1/export",
        "/api/v1/import",
        "/api/v1/mcp",
        "/openapi.json",
      ]),
    );
  });

  it("keeps public share attachments isolated by share token", async () => {
    const sharedMemo = await createMemo("share isolation memo");
    const sharedFormData = new FormData();
    sharedFormData.set("memo", sharedMemo.name);
    sharedFormData.set(
      "file",
      new File(["shared"], "shared.txt", { type: "text/plain" }),
    );

    const sharedAttachment = await json(
      await fetchApp("http://flaremo.test/api/v1/attachments", {
        method: "POST",
        body: sharedFormData,
      }),
      201,
    );
    expect(sharedAttachment.name).toMatch(/^attachments\//);

    const share = await json(
      await fetchApp(`http://flaremo.test/api/v1/${sharedMemo.name}/shares`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      201,
    );

    const privateMemo = await createMemo("private attachment memo");
    const privateFormData = new FormData();
    privateFormData.set("memo", privateMemo.name);
    privateFormData.set(
      "file",
      new File(["private"], "private.txt", { type: "text/plain" }),
    );
    const privateAttachment = await json(
      await fetchApp("http://flaremo.test/api/v1/attachments", {
        method: "POST",
        body: privateFormData,
      }),
      201,
    );

    const publicShare = await json(
      await fetchApp(`http://flaremo.test/api/public/shares/${share.token}`),
    );
    expect(publicShare.attachments[0].download_url).toContain(
      sharedAttachment.id,
    );

    const sharedBlob = await fetchApp(
      `http://flaremo.test${publicShare.attachments[0].download_url}`,
    );
    expect(sharedBlob.status).toBe(200);
    expect(await sharedBlob.text()).toBe("shared");

    const privateBlob = await fetchApp(
      `http://flaremo.test/api/public/shares/${share.token}/attachments/${privateAttachment.id}/blob`,
    );
    expect(privateBlob.status).toBe(404);
  });

  it("serves the current camelCase REST facade on top of Better Auth", async () => {
    const currentOpenapi = await fetchCurrent(
      "http://flaremo.test/openapi.json",
      undefined,
      { authenticated: false },
    );
    expect(currentOpenapi.status).toBe(200);
    const currentOpenapiBody = await currentOpenapi.json();
    expect(currentOpenapiBody).toMatchObject({
      info: { title: "FlareMo current Memos-compatible API" },
      paths: {
        "/api/v1/auth/signin": expect.any(Object),
        "/api/v1/memos": expect.any(Object),
        "/file/attachments/{attachment}/{filename}": expect.any(Object),
        "/memos.api.v1.MemoService/GetMemoByShare": expect.any(Object),
        "/memos.api.v1.AttachmentService/ListAttachments": expect.any(Object),
        "/memos.api.v1.InstanceService/GetInstanceProfile": expect.any(Object),
        "/mcp": expect.any(Object),
      },
    });
    expect(
      currentOpenapiBody.paths["/memos.api.v1.MemoService/GetMemo"].post
        .security,
    ).toEqual(expect.arrayContaining([{}]));

    const legacyOpenapi = await fetchApp(
      "http://flaremo.test/openapi.json",
      { headers: { "x-flaremo-wire": "legacy" } },
      { authenticated: false },
    );
    expect(legacyOpenapi.status).toBe(200);
    expect(await legacyOpenapi.json()).toMatchObject({
      info: { title: "FlareMo Memos-compatible API" },
    });

    const missingOriginSignIn = await fetchCurrent(
      "http://flaremo.test/api/v1/auth/signin",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          passwordCredentials: {
            username: "owner",
            password: TEST_PASSWORD,
          },
        }),
      },
      { authenticated: false },
    );
    expect(missingOriginSignIn.status).toBe(403);

    const signInResponse = await fetchCurrent(
      "http://flaremo.test/api/v1/auth/signin",
      {
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
      },
      { authenticated: false },
    );
    expect(signInResponse.status).toBe(200);
    expect(signInResponse.headers.get("set-cookie")).toBeTruthy();
    expect(signInResponse.headers.get("cache-control")).toBe("no-store");
    const signIn = (await signInResponse.json()) as {
      accessToken: string;
      user: { name: string; role: string; username: string };
      accessTokenExpiresAt: string;
    };
    expect(signIn).toMatchObject({
      accessToken: expect.any(String),
      accessTokenExpiresAt: expect.any(String),
      user: {
        name: "users/owner",
        role: "ADMIN",
        username: "owner",
      },
    });

    const signInClaims = decodeJwtForTest(signIn.accessToken);
    expect(signInClaims.header).toEqual({
      alg: "HS256",
      kid: "v1",
      typ: "JWT",
    });
    expect(signInClaims.payload).toMatchObject({
      type: "access",
      role: "ADMIN",
      status: "NORMAL",
      username: "owner",
      iss: "memos",
      sub: "1",
      aud: ["user.access-token"],
    });
    const accessPayloadJson = new TextDecoder().decode(
      decodeBase64UrlForTest(signIn.accessToken.split(".")[1] ?? ""),
    );
    expect(accessPayloadJson).toMatch(
      /^\{"type":"access","role":"ADMIN","status":"NORMAL","username":"owner","iss":"memos","sub":"1","aud":\["user\.access-token"\],"exp":\d+,"iat":\d+\}$/,
    );

    const bearer = { authorization: `Bearer ${signIn.accessToken}` };
    const signInCookie = extractCookieHeader(signInResponse);
    const refreshWithoutCookie = await fetchCurrent(
      "http://flaremo.test/api/v1/auth/refresh",
      { method: "POST", headers: bearer },
      { authenticated: false },
    );
    expect(refreshWithoutCookie.status).toBe(401);

    const refreshWithUntrustedOrigin = await fetchCurrent(
      "http://flaremo.test/api/v1/auth/refresh",
      {
        method: "POST",
        headers: {
          ...bearer,
          cookie: signInCookie,
          origin: "https://untrusted.example",
        },
      },
      { authenticated: false },
    );
    expect(refreshWithUntrustedOrigin.status).toBe(403);

    const refreshResponse = await fetchCurrent(
      "http://flaremo.test/api/v1/auth/refresh",
      {
        method: "POST",
        headers: {
          ...bearer,
          cookie: signInCookie,
          origin: "http://flaremo.test",
        },
      },
      { authenticated: false },
    );
    expect(refreshResponse.status).toBe(200);
    expect(refreshResponse.headers.get("cache-control")).toBe("no-store");
    const refreshed = (await refreshResponse.json()) as {
      accessToken: string;
      expiresAt: string;
    };
    expect(refreshed.accessToken).toEqual(expect.any(String));
    expect(extractCookieHeader(refreshResponse)).not.toBe(signInCookie);
    expect(decodeJwtForTest(refreshed.accessToken).payload).toMatchObject({
      type: "access",
      sub: "1",
      aud: ["user.access-token"],
    });

    const oldRefreshCookieReuse = await fetchCurrent(
      "http://flaremo.test/api/v1/auth/refresh",
      {
        method: "POST",
        headers: {
          ...bearer,
          cookie: signInCookie,
          origin: "http://flaremo.test",
        },
      },
      { authenticated: false },
    );
    expect(oldRefreshCookieReuse.status).toBe(401);

    const meResponse = await fetchCurrent(
      "http://flaremo.test/api/v1/auth/me",
      { headers: bearer },
    );
    expect(meResponse.status).toBe(200);
    expect(await meResponse.json()).toMatchObject({
      user: { name: "users/owner", username: "owner" },
    });

    const createdResponse = await fetchCurrent(
      "http://flaremo.test/api/v1/memos",
      {
        method: "POST",
        headers: { ...bearer, "content-type": "application/json" },
        body: JSON.stringify({
          memo: {
            content: "current wire memo #current",
            visibility: "PUBLIC",
            property: { hasLink: true },
            location: { placeholder: "Shanghai" },
          },
        }),
      },
    );
    expect(createdResponse.status).toBe(200);
    const created = (await createdResponse.json()) as {
      name: string;
      state: string;
      visibility: string;
      createTime: string;
      updateTime: string;
      tags: string[];
      property: { hasLink: boolean };
      location: { placeholder: string };
    };
    expect(created).toMatchObject({
      name: expect.stringMatching(/^memos\//),
      state: "NORMAL",
      visibility: "PUBLIC",
      createTime: expect.any(String),
      updateTime: expect.any(String),
      tags: ["current"],
      property: { hasLink: true },
      location: { placeholder: "Shanghai" },
    });
    expect(created).not.toHaveProperty("create_time");

    const listed = (await (
      await fetchCurrent(
        "http://flaremo.test/api/v1/memos?pageSize=1&orderBy=create_time%20desc",
        { headers: bearer },
      )
    ).json()) as { memos: Array<Record<string, unknown>> };
    expect(listed.memos[0]).toMatchObject({
      name: created.name,
      visibility: "PUBLIC",
    });

    const updated = await fetchCurrent(
      `http://flaremo.test/api/v1/${created.name}?updateMask=pinned,visibility`,
      {
        method: "PATCH",
        headers: { ...bearer, "content-type": "application/json" },
        body: JSON.stringify({
          memo: {
            name: created.name,
            pinned: true,
            visibility: "PROTECTED",
          },
        }),
      },
    );
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      name: created.name,
      pinned: true,
      visibility: "PROTECTED",
    });

    const secondResponse = await fetchCurrent(
      "http://flaremo.test/api/v1/memos",
      {
        method: "POST",
        headers: { ...bearer, "content-type": "application/json" },
        body: JSON.stringify({ memo: { content: "related memo" } }),
      },
    );
    const second = (await secondResponse.json()) as { name: string };

    const attachmentResponse = await fetchCurrent(
      "http://flaremo.test/api/v1/attachments",
      {
        method: "POST",
        headers: { ...bearer, "content-type": "application/json" },
        body: JSON.stringify({
          attachment: {
            filename: "current.txt",
            content: "aGVsbG8=",
            type: "text/plain",
            memo: created.name,
          },
        }),
      },
    );
    expect(attachmentResponse.status).toBe(200);
    const attachment = (await attachmentResponse.json()) as {
      name: string;
      size: string;
      memo: string;
      type: string;
    };
    expect(attachment).toMatchObject({
      name: expect.stringMatching(/^attachments\//),
      size: "5",
      memo: created.name,
      type: "text/plain",
    });

    const attachmentList = await fetchCurrent(
      "http://flaremo.test/api/v1/attachments?pageSize=10",
      { headers: bearer },
    );
    expect(attachmentList.status).toBe(200);
    expect(await attachmentList.json()).toMatchObject({
      attachments: [expect.objectContaining({ name: attachment.name })],
    });

    const relationResponse = await fetchCurrent(
      `http://flaremo.test/api/v1/${created.name}/relations`,
      {
        method: "PATCH",
        headers: { ...bearer, "content-type": "application/json" },
        body: JSON.stringify({
          name: created.name,
          relations: [
            {
              memo: { name: created.name },
              relatedMemo: { name: second.name },
              type: "REFERENCE",
            },
          ],
        }),
      },
    );
    expect(relationResponse.status).toBe(200);
    const relations = await fetchCurrent(
      `http://flaremo.test/api/v1/${created.name}/relations`,
      { headers: bearer },
    );
    expect(await relations.json()).toMatchObject({
      relations: [
        {
          memo: { name: created.name },
          relatedMemo: { name: second.name },
          type: "REFERENCE",
        },
      ],
    });

    const shareResponse = await fetchCurrent(
      `http://flaremo.test/api/v1/${created.name}/shares`,
      {
        method: "POST",
        headers: { ...bearer, "content-type": "application/json" },
        body: JSON.stringify({
          parent: created.name,
          memoShare: {},
        }),
      },
    );
    expect(shareResponse.status).toBe(200);
    const share = (await shareResponse.json()) as { name: string };
    const shareToken = share.name.split("/").at(-1);
    expect(shareToken).toBeTruthy();
    const publicShare = await fetchCurrent(
      `http://flaremo.test/api/v1/shares/${shareToken}`,
      undefined,
      { authenticated: false },
    );
    expect(publicShare.status).toBe(200);
    expect(await publicShare.json()).toMatchObject({ name: created.name });

    const patCreate = await fetchCurrent(
      "http://flaremo.test/api/v1/users/owner/personalAccessTokens",
      {
        method: "POST",
        headers: { ...bearer, "content-type": "application/json" },
        body: JSON.stringify({
          description: "current test token",
          expiresInDays: 0,
        }),
      },
    );
    expect(patCreate.status).toBe(200);
    expect(patCreate.headers.get("cache-control")).toBe("no-store");
    const pat = (await patCreate.json()) as {
      personalAccessToken: { name: string };
      token: string;
    };
    expect(pat.personalAccessToken.name).toContain(
      "users/owner/personalAccessTokens/",
    );
    expect(pat.token).toMatch(/^memos_pat_/);

    const invalidPatSignout = await fetchCurrent(
      "http://flaremo.test/api/v1/auth/signout",
      {
        method: "POST",
        headers: { authorization: "Bearer memos_pat_not-a-real-key" },
      },
      { authenticated: false },
    );
    expect(invalidPatSignout.status).toBe(401);

    const validPatSignout = await fetchCurrent(
      "http://flaremo.test/api/v1/auth/signout",
      {
        method: "POST",
        headers: { authorization: `Bearer ${pat.token}` },
      },
      { authenticated: false },
    );
    expect(validPatSignout.status).toBe(200);

    const patList = await fetchCurrent(
      "http://flaremo.test/api/v1/users/owner/personalAccessTokens",
      { headers: bearer },
    );
    expect(patList.status).toBe(200);
    expect(await patList.json()).toMatchObject({
      personalAccessTokens: [
        expect.objectContaining({
          description: "current test token",
        }),
      ],
    });

    const patManagementWithPat = await fetchCurrent(
      "http://flaremo.test/api/v1/users/owner/personalAccessTokens",
      { headers: { authorization: `Bearer ${pat.token}` } },
      { authenticated: false },
    );
    expect(patManagementWithPat.status).toBe(401);

    const mcpHeaders = {
      authorization: `Bearer ${pat.token}`,
      "content-type": "application/json",
      accept: "application/json",
    };
    const initialize = await fetchCurrent("http://flaremo.test/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26" },
      }),
    });
    expect(initialize.status).toBe(200);
    expect(await initialize.json()).toMatchObject({
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
      },
    });

    const tools = await fetchCurrent("http://flaremo.test/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      }),
    });
    const toolNames = (
      (await tools.json()) as {
        result: { tools: Array<{ name: string }> };
      }
    ).result.tools.map((tool) => tool.name);
    expect(toolNames).toContain("memo_list_memos");
    expect(toolNames).not.toContain("list_memos");

    const toolCall = await fetchCurrent("http://flaremo.test/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "memo_create_memo",
          arguments: { body: { content: "created through current MCP" } },
        },
      }),
    });
    expect(toolCall.status).toBe(200);
    expect(await toolCall.json()).toMatchObject({
      result: {
        structuredContent: {
          content: "created through current MCP",
        },
      },
    });

    const commentCall = await fetchCurrent("http://flaremo.test/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "memo_create_memo_comment",
          arguments: { name: created.name, content: "MCP comment" },
        },
      }),
    });
    const commentBody = (await commentCall.json()) as {
      result: { structuredContent: { name: string; parent: string } };
    };
    expect(commentBody.result.structuredContent).toMatchObject({
      name: expect.stringMatching(/^memos\//),
      parent: created.name,
    });

    const commentsCall = await fetchCurrent("http://flaremo.test/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "memo_list_memo_comments",
          arguments: { name: created.name },
        },
      }),
    });
    expect(await commentsCall.json()).toMatchObject({
      result: {
        structuredContent: {
          memos: [expect.objectContaining({ content: "MCP comment" })],
        },
      },
    });

    const reactionCall = await fetchCurrent("http://flaremo.test/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name: "memo_upsert_memo_reaction",
          arguments: { name: created.name, reactionType: "👍" },
        },
      }),
    });
    const reactionBody = (await reactionCall.json()) as {
      result: { structuredContent: { name: string; reactionType: string } };
    };
    expect(reactionBody.result.structuredContent).toMatchObject({
      name: expect.stringContaining("/reactions/"),
      reactionType: "👍",
    });

    const reactionListCall = await fetchCurrent("http://flaremo.test/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: {
          name: "memo_list_memo_reactions",
          arguments: { name: created.name },
        },
      }),
    });
    expect(await reactionListCall.json()).toMatchObject({
      result: {
        structuredContent: {
          reactions: [expect.objectContaining({ reactionType: "👍" })],
        },
      },
    });

    const shortcutCall = await fetchCurrent("http://flaremo.test/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: {
          name: "shortcut_create_shortcut",
          arguments: {
            title: "MCP shortcut",
            filter: 'content.contains("MCP")',
          },
        },
      }),
    });
    const shortcutBody = (await shortcutCall.json()) as {
      result: { structuredContent: { name: string; title: string } };
    };
    expect(shortcutBody.result.structuredContent).toMatchObject({
      name: expect.stringMatching(/^users\/owner\/shortcuts\//),
      title: "MCP shortcut",
    });

    const shortcutName = shortcutBody.result.structuredContent.name;
    const shortcutUpdateCall = await fetchCurrent("http://flaremo.test/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: {
          name: "shortcut_update_shortcut",
          arguments: {
            name: shortcutName,
            title: "Updated MCP shortcut",
            updateMask: "title",
          },
        },
      }),
    });
    expect(await shortcutUpdateCall.json()).toMatchObject({
      result: {
        structuredContent: {
          name: shortcutName,
          title: "Updated MCP shortcut",
        },
      },
    });

    const shortcutGetCall = await fetchCurrent("http://flaremo.test/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: {
          name: "shortcut_get_shortcut",
          arguments: { name: shortcutName },
        },
      }),
    });
    expect(await shortcutGetCall.json()).toMatchObject({
      result: { structuredContent: { name: shortcutName } },
    });

    const shortcutDeleteCall = await fetchCurrent("http://flaremo.test/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: {
          name: "shortcut_delete_shortcut",
          arguments: { name: shortcutName },
        },
      }),
    });
    expect(await shortcutDeleteCall.json()).toMatchObject({
      result: { structuredContent: { ok: true } },
    });

    const reactionId = reactionBody.result.structuredContent.name
      .split("/")
      .at(-1);
    const reactionDeleteCall = await fetchCurrent("http://flaremo.test/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 13,
        method: "tools/call",
        params: {
          name: "memo_delete_memo_reaction",
          arguments: { name: created.name, reaction: reactionId },
        },
      }),
    });
    expect(await reactionDeleteCall.json()).toMatchObject({
      result: { structuredContent: { ok: true } },
    });

    const toolError = await fetchCurrent("http://flaremo.test/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "not_a_real_tool", arguments: {} },
      }),
    });
    expect(await toolError.json()).toMatchObject({
      result: {
        isError: true,
        content: [{ type: "text" }],
      },
    });

    const unauthenticated = await fetchCurrent(
      "http://flaremo.test/api/v1/memos",
      undefined,
      { authenticated: false },
    );
    expect(unauthenticated.status).toBe(200);
    expect(await unauthenticated.json()).toMatchObject({
      memos: expect.any(Array),
    });
  });

  it("clears the cookie session when current signout receives both credentials", async () => {
    const signInResponse = await fetchCurrent(
      "http://flaremo.test/api/v1/auth/signin",
      {
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
      },
      { authenticated: false },
    );
    const signIn = (await signInResponse.json()) as { accessToken: string };
    const cookie = extractCookieHeader(signInResponse);

    const signout = await fetchCurrent(
      "http://flaremo.test/api/v1/auth/signout",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${signIn.accessToken}`,
          cookie,
          origin: "http://flaremo.test",
        },
      },
      { authenticated: false },
    );
    expect(signout.status).toBe(200);

    const cookieOnly = await fetchCurrent(
      "http://flaremo.test/api/v1/auth/me",
      { headers: { cookie } },
      { authenticated: false },
    );
    expect(cookieOnly.status).toBe(401);
  });
});

function fetchApp(
  input: string,
  init?: RequestInit,
  options: { authenticated?: boolean } = {},
) {
  const headers = new Headers(init?.headers);
  const path = new URL(input).pathname;
  if (
    options.authenticated !== false &&
    (path.startsWith("/api/app/") || path.startsWith("/api/v1/"))
  ) {
    headers.set("cookie", sessionCookie);
    if (path.startsWith("/api/v1/") && !headers.has("x-flaremo-wire")) {
      headers.set("x-flaremo-wire", "legacy");
    }
    if (!headers.has("origin") && isUnsafeMethod(init?.method)) {
      headers.set("origin", "http://flaremo.test");
    }
  }
  return app.fetch(new Request(input, { ...init, headers }), env);
}

function fetchCurrent(
  input: string,
  init?: RequestInit,
  options: { authenticated?: boolean } = {},
) {
  const headers = new Headers(init?.headers);
  headers.set("x-flaremo-wire", "current");
  return fetchApp(input, { ...init, headers }, options);
}

function isUnsafeMethod(method: string | undefined) {
  return !["GET", "HEAD", "OPTIONS"].includes((method ?? "GET").toUpperCase());
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
  const setCookies = headers.getSetCookie?.() ?? [
    response.headers.get("set-cookie"),
  ];
  const cookies = setCookies
    .filter((value): value is string => Boolean(value))
    .map((value) => value.split(";", 1)[0] ?? "")
    .filter(Boolean);
  expect(cookies.length).toBeGreaterThan(0);
  return cookies.join("; ");
}

async function createMemo(content: string) {
  return json(
    await fetchApp("http://flaremo.test/api/v1/memos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    }),
    201,
  );
}

async function createMemoWith(input: {
  content: string;
  visibility: "private" | "protected" | "public";
}) {
  return json(
    await fetchApp("http://flaremo.test/api/v1/memos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
    201,
  );
}

async function listMemos(query: string) {
  return json<{
    memos: Array<Record<string, unknown>>;
    next_page_token?: string;
  }>(await fetchApp(`http://flaremo.test/api/v1/memos?${query}`));
}

async function json<T = Record<string, unknown>>(
  response: Response,
  status = 200,
) {
  expect(response.status).toBe(status);
  return response.json() as Promise<T>;
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

async function createTestRuntime(suffix: string) {
  const runtime = new Miniflare({
    script: "export default { fetch() { return new Response('ok') } }",
    modules: true,
    compatibilityDate: "2026-07-10",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: `flaremo-memos-compat-${suffix}` },
    r2Buckets: { ATTACHMENTS: `flaremo-memos-compat-attachments-${suffix}` },
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
    "0010_deep_gateway.sql",
  ]) {
    await applyMigration(
      db,
      await readFile(
        resolve(import.meta.dirname, `../../../migrations/${filename}`),
        "utf8",
      ),
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

function decodeJwtForTest(token: string) {
  const [encodedHeader, encodedPayload] = token.split(".");
  if (!encodedHeader || !encodedPayload) throw new Error("invalid test JWT");
  const decode = (value: string) =>
    JSON.parse(
      Buffer.from(
        value.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString("utf8"),
    ) as Record<string, unknown>;
  return { header: decode(encodedHeader), payload: decode(encodedPayload) };
}

function decodeBase64UrlForTest(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
