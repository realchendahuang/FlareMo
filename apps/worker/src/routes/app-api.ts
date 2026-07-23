import {
  createMemoSchema,
  FLAREMO_API_VERSION,
  listMemosQuerySchema,
  memoStatsQuerySchema,
  updateMemoSchema,
} from "@flaremo/contracts";
import {
  createMemo,
  getMemoStats,
  hardDeleteMemo,
  listAttachmentsForMemos,
  listMemos,
  markMemoAttachmentsDeleting,
  moveMemoToTrash,
  updateMemo,
} from "@flaremo/domain";
import { memosToListResponse, memoToDto } from "@flaremo/memos";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { getRequestContext, type HonoBindings } from "../context";
import { jsonError } from "../http";
import { buildMemoContext } from "../memo-context";

export const appApi = new Hono<HonoBindings>();

const FLAREMO_RELEASES_URL =
  "https://github.com/realchendahuang/FlareMo/releases";
const FLAREMO_UPDATE_GUIDE_URL =
  "https://github.com/realchendahuang/FlareMo/blob/main/docs/update.md";

appApi.get("/health", (c) => {
  const repository = normalizeGitHubRepository(c.env.FLAREMO_DEPLOY_REPOSITORY);
  return c.json({
    ok: true,
    product: "FlareMo",
    version: FLAREMO_API_VERSION,
    update_repository: repository,
    update_workflow_url: repository
      ? `https://github.com/${repository}/actions/workflows/flaremo-update.yml`
      : null,
    releases_url: FLAREMO_RELEASES_URL,
    update_guide_url: FLAREMO_UPDATE_GUIDE_URL,
  });
});

appApi.get("/memos", zValidator("query", listMemosQuerySchema), async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const result = await listMemos(db, user, c.req.valid("query"));
    const attachments = await listAttachmentsForMemos(
      db,
      user,
      result.memos.map((memo) => memo.id),
    );
    const attachmentsByMemo = new Map<string, (typeof attachments)[number][]>();
    for (const attachment of attachments) {
      if (!attachment.memoId) continue;
      const current = attachmentsByMemo.get(attachment.memoId) ?? [];
      current.push(attachment);
      attachmentsByMemo.set(attachment.memoId, current);
    }
    return c.json(memosToListResponse({ ...result, attachmentsByMemo, user }));
  } catch (error) {
    return jsonError(c, error);
  }
});

appApi.get("/stats", zValidator("query", memoStatsQuerySchema), async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    return c.json(await getMemoStats(db, user, c.req.valid("query")));
  } catch (error) {
    return jsonError(c, error);
  }
});

appApi.get("/memos/:id", async (c) => {
  try {
    const context = await getRequestContext(c);
    return c.json(
      await buildMemoContext(context, `memos/${c.req.param("id")}`),
    );
  } catch (error) {
    return jsonError(c, error);
  }
});

appApi.post("/memos", zValidator("json", createMemoSchema), async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const memo = await createMemo(db, user, c.req.valid("json"));
    return c.json(memoToDto(memo, user), 201);
  } catch (error) {
    return jsonError(c, error);
  }
});

appApi.patch("/memos/:id", zValidator("json", updateMemoSchema), async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const memo = await updateMemo(
      db,
      user,
      `memos/${c.req.param("id")}`,
      c.req.valid("json"),
    );
    return c.json(memoToDto(memo, user));
  } catch (error) {
    return jsonError(c, error);
  }
});

appApi.delete("/memos/:id", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const id = `memos/${c.req.param("id")}`;
    if (c.req.query("hard") === "true") {
      const attachments = await markMemoAttachmentsDeleting(db, user, id);
      const objectKeys = attachments
        .filter((attachment) => attachment.state !== "missing")
        .map((attachment) => attachment.r2Key);
      if (objectKeys.length > 0) {
        await c.env.ATTACHMENTS.delete(objectKeys);
      }
      await hardDeleteMemo(db, user, id);
      return c.json({ ok: true });
    }
    const memo = await moveMemoToTrash(db, user, id);
    return c.json(memoToDto(memo, user));
  } catch (error) {
    return jsonError(c, error);
  }
});

function normalizeGitHubRepository(value: string): string | null {
  const repository = value.trim();
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)
    ? repository
    : null;
}
