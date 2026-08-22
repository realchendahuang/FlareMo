import {
  createMemoryFromMemoSchema,
  createMemoSchema,
  dailyReviewQuerySchema,
  FLAREMO_API_VERSION,
  listMemosQuerySchema,
  listNotificationsQuerySchema,
  memoStatsQuerySchema,
  randomMemoQuerySchema,
  relatedMemosQuerySchema,
  renameTagRequestSchema,
  updateMemoSchema,
  updateNotificationSchema,
  walkNextQuerySchema,
} from "@flaremo/contracts";
import type { FlareMoDb, MemoRow, UserRow } from "@flaremo/db";
import {
  createMemo,
  createMemoryFromMemo,
  createMemoryFromMemoInputToWrite,
  deleteTag,
  getMemoById,
  getMemoStats,
  getRandomMemo,
  getWalkNextMemo,
  hardDeleteMemo,
  listAttachmentsForMemos,
  listDailyReviewMemos,
  listMemos,
  listRelatedMemos,
  listTagHierarchy,
  listUserNotifications,
  markMemoAttachmentsDeleting,
  moveMemoToTrash,
  NotFoundError,
  renameTag,
  type UserNotificationDto,
  updateMemo,
  updateUserNotification,
} from "@flaremo/domain";
import {
  memosToListResponse,
  memoToDto,
  parseMemosResourceName,
} from "@flaremo/memos";
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

appApi.get("/health", async (c) => {
  try {
    await getRequestContext(c);
    const repository = normalizeGitHubRepository(
      c.env.FLAREMO_DEPLOY_REPOSITORY,
    );
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
  } catch (error) {
    return jsonError(c, error);
  }
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

appApi.get(
  "/review/daily",
  zValidator("query", dailyReviewQuerySchema),
  async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      const rows = await listDailyReviewMemos(db, user, c.req.valid("query"));
      return c.json({
        memos: await serializeMemosWithAttachments(db, user, rows),
      });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

appApi.get(
  "/review/random",
  zValidator("query", randomMemoQuerySchema),
  async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      const memo = await getRandomMemo(
        db,
        user,
        parseExcludeParam(c.req.valid("query").exclude),
      );
      const [serialized] = memo
        ? await serializeMemosWithAttachments(db, user, [memo])
        : [null];
      return c.json({ memo: serialized ?? null });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

appApi.get(
  "/review/walk",
  zValidator("query", walkNextQuerySchema),
  async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      const query = c.req.valid("query");
      const { memo, via } = await getWalkNextMemo(
        db,
        user,
        query.memoId,
        parseExcludeParam(query.exclude),
      );
      const [serialized] = memo
        ? await serializeMemosWithAttachments(db, user, [memo])
        : [null];
      return c.json({ memo: serialized ?? null, via: memo ? via : null });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

appApi.get(
  "/memos/:id/related",
  zValidator("query", relatedMemosQuerySchema),
  async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      const related = await listRelatedMemos(
        db,
        user,
        `memos/${c.req.param("id")}`,
        c.req.valid("query"),
      );
      const serialized = await serializeMemosWithAttachments(
        db,
        user,
        related.map((entry) => entry.memo),
      );
      const byId = new Map(serialized.map((memo) => [memo.name, memo]));
      return c.json({
        memos: related.flatMap((entry) => {
          const memo = byId.get(entry.memo.id);
          return memo
            ? [
                {
                  ...memo,
                  shared_tags: entry.sharedTags,
                  via_relation: entry.viaRelation,
                },
              ]
            : [];
        }),
      });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

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

appApi.post(
  "/memos/:id/memory",
  zValidator("json", createMemoryFromMemoSchema),
  async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      const memoId = `memos/${c.req.param("id")}`;
      const memo = await getMemoById(db, user, memoId);
      if (!memo) throw new NotFoundError("Memo not found");
      const result = await createMemoryFromMemo(
        db,
        user,
        { type: "user" },
        createMemoryFromMemoInputToWrite(c.req.valid("json"), memo.content),
        memoId,
      );
      return c.json(result, result.duplicate ? 200 : 201);
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

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

appApi.get("/tags", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    return c.json({ tags: await listTagHierarchy(db, user) });
  } catch (error) {
    return jsonError(c, error);
  }
});

appApi.get(
  "/notifications",
  zValidator("query", listNotificationsQuerySchema),
  async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      const query = c.req.valid("query");
      const result = await listUserNotifications(db, user, {
        pageSize: query.page_size,
        pageToken: query.page_token,
      });
      return c.json({
        notifications: result.notifications.map(appNotificationToDto),
        ...(result.nextPageToken
          ? { next_page_token: result.nextPageToken }
          : {}),
      });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

appApi.patch(
  "/notifications/:id",
  zValidator("json", updateNotificationSchema),
  async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      const { status } = c.req.valid("json");
      const updated = await updateUserNotification(
        db,
        user,
        `${user.id}/notifications/${c.req.param("id")}`,
        status,
        ["status"],
      );
      return c.json(appNotificationToDto(updated));
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

appApi.patch("/tags", zValidator("json", renameTagRequestSchema), async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    return c.json(await renameTag(db, user, c.req.valid("json")));
  } catch (error) {
    return jsonError(c, error);
  }
});

appApi.delete("/tags", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const tag = c.req.query("tag") ?? "";
    return c.json(await deleteTag(db, user, { tag }));
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

function appNotificationToDto(notification: UserNotificationDto) {
  return {
    name: notification.name,
    type: notification.type,
    status: notification.status,
    memo: notification.memo,
    memo_snippet: notification.memoSnippet,
    create_time: notification.createTime,
  };
}

async function serializeMemosWithAttachments(
  db: FlareMoDb,
  user: UserRow,
  rows: MemoRow[],
) {
  if (rows.length === 0) return [];
  const attachments = await listAttachmentsForMemos(
    db,
    user,
    rows.map((row) => row.id),
  );
  const attachmentsByMemo = new Map<string, (typeof attachments)[number][]>();
  for (const attachment of attachments) {
    if (!attachment.memoId) continue;
    const current = attachmentsByMemo.get(attachment.memoId) ?? [];
    current.push(attachment);
    attachmentsByMemo.set(attachment.memoId, current);
  }
  return memosToListResponse({ memos: rows, attachmentsByMemo, user }).memos;
}

function parseExcludeParam(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 500)
    .map((entry) => parseMemosResourceName(entry));
}
