import type { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAppTestHarness,
  jsonWithStatus as json,
} from "../test-support/app";
import { createTestRuntime } from "../test-support/runtime";
import { bootstrapAndSignIn } from "../test-support/sign-in";

let mf: Miniflare;
let env: Env;
let sessionCookie: string;

const { fetchApp } = createAppTestHarness(() => ({ env, sessionCookie }));

describe("Memos-compatible export and import roundtrip", () => {
  beforeEach(async () => {
    ({ runtime: mf, env } = await createTestRuntime({
      name: "flaremo-memos-compat",
      suffix: "source",
    }));
    sessionCookie = await bootstrapAndSignIn(env);
  });

  afterEach(async () => {
    await mf.dispose();
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
    ({ runtime: mf, env } = await createTestRuntime({
      name: "flaremo-memos-compat",
      suffix: "restored",
    }));
    sessionCookie = await bootstrapAndSignIn(env);

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
    expect(
      restoredMemos.memos
        .map((item: { content: string }) => item.content)
        .toSorted(),
    ).toEqual(["exportable memo #bundle", "related memo #bundle"]);
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
});

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

async function listMemos(query: string) {
  return json<{
    memos: Array<Record<string, unknown>>;
    next_page_token?: string;
  }>(await fetchApp(`http://flaremo.test/api/v1/memos?${query}`));
}
