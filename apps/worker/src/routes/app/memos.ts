import {
  createMemoCommentSchema,
  createMemoryFromMemoSchema,
  createMemoSchema,
  listMemosQuerySchema,
  listNotificationsQuerySchema,
  memoSpaceSchema,
  memoStatsQuerySchema,
  renameTagRequestSchema,
  updateMemoSchema,
  updateNotificationSchema,
} from "@flaremo/contracts";
import {
  countMemoComments,
  createMemo,
  createMemoComment,
  createMemoryFromMemo,
  createMemoryFromMemoInputToWrite,
  deleteTag,
  getFlaremoUserNames,
  getMemoById,
  getMemoStats,
  listAttachmentsForMemos,
  listMemoComments,
  listMemos,
  listMentionableTeamMembers,
  listTagHierarchy,
  listUserNotifications,
  moveMemoToTrash,
  NotFoundError,
  renameTag,
  type UserNotificationDto,
  updateMemo,
  updateUserNotification,
} from "@flaremo/domain";
import { memosToListResponse, memoToDto } from "@flaremo/memos";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import { z } from "zod";
import { getRequestContext, type HonoBindings } from "../../context";
import { jsonError } from "../../http";
import { buildMemoContext } from "../../memo-context";
import { hardDeleteMemoWithAttachments } from "../../memo-hard-delete";

function appNotificationToDto(notification: UserNotificationDto) {
  return {
    name: notification.name,
    type: notification.type,
    status: notification.status,
    memo: notification.memo,
    // The memo a comment or a comment mention belongs under.
    related_memo: notification.relatedMemo ?? null,
    // Who acted: the commenter or the person who mentioned you.
    sender_name: notification.senderUser.name,
    memo_snippet: notification.memoSnippet,
    create_time: notification.createTime,
  };
}

export function registerMemoListRoutes(app: Hono<HonoBindings>) {
  app.get("/memos", zValidator("query", listMemosQuerySchema), async (c) => {
    try {
      const { db, user, memoFilterScanLimit } = await getRequestContext(c);
      const result = await listMemos(db, user, c.req.valid("query"), {
        celScanLimit: memoFilterScanLimit,
      });
      const [creatorNames, attachments, commentCounts] = await Promise.all([
        getFlaremoUserNames(
          db,
          result.memos.map((memo) => memo.userId),
        ),
        listAttachmentsForMemos(
          db,
          user,
          result.memos.map((memo) => memo.id),
        ),
        countMemoComments(
          db,
          user,
          result.memos.map((memo) => memo.id),
        ),
      ]);
      const attachmentsByMemo = new Map<
        string,
        (typeof attachments)[number][]
      >();
      for (const attachment of attachments) {
        if (!attachment.memoId) continue;
        const current = attachmentsByMemo.get(attachment.memoId) ?? [];
        current.push(attachment);
        attachmentsByMemo.set(attachment.memoId, current);
      }
      const response = memosToListResponse({
        ...result,
        attachmentsByMemo,
        creatorNames,
        user,
      });
      return c.json({
        ...response,
        memos: response.memos.map((memo) => ({
          ...memo,
          comment_count: commentCounts.get(memo.name) ?? 0,
        })),
      });
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/stats", zValidator("query", memoStatsQuerySchema), async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      const { space, ...query } = c.req.valid("query");
      return c.json(
        await getMemoStats(db, user, query, {
          // `all` is the workspace's "no space filter" selection, and the memo
          // list and the tag hierarchy both already normalize it away. Leaving
          // it set here made this one endpoint widen the corpus to every memo
          // the viewer could read, so the sidebar's stats, tags, and list each
          // described a different set — and it bypassed the per-author activity
          // counter, which only covers the viewer's own memos.
          space: space === "all" ? undefined : space,
        }),
      );
    } catch (error) {
      return jsonError(c, error);
    }
  });
}

export function registerMemoCrudRoutes(app: Hono<HonoBindings>) {
  // Who can be @mentioned: active team members, without emails.
  app.get("/team/members", async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      return c.json({ members: await listMentionableTeamMembers(db, user) });
    } catch (error) {
      return jsonError(c, error);
    }
  });
  // Comments, oldest first: a thread reads top to bottom. Each comment is a
  // memo linked to its parent; the timeline never lists them on their own.
  app.get("/memos/:id/comments", async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      const memoName = `memos/${c.req.param("id")}`;
      const result = await listMemoComments(db, user, {
        memoName,
        pageSize: 200,
        orderBy: "create_time asc",
      });
      const creatorNames = await getFlaremoUserNames(
        db,
        result.memos.map((memo) => memo.userId),
      );
      return c.json({
        comments: memosToListResponse({
          memos: result.memos,
          creatorNames,
          user,
        }).memos,
      });
    } catch (error) {
      return jsonError(c, error);
    }
  });
  app.post(
    "/memos/:id/comments",
    zValidator("json", createMemoCommentSchema),
    async (c) => {
      try {
        const { db, user, userLimits } = await getRequestContext(c);
        const { content, client_id } = c.req.valid("json");
        const comment = await createMemoComment(
          db,
          user,
          `memos/${c.req.param("id")}`,
          { content, payload: client_id ? { client_id } : {} },
          { userLimits, userId: user.id },
        );
        const creatorNames = await getFlaremoUserNames(db, [comment.userId]);
        return c.json(
          memosToListResponse({ memos: [comment], creatorNames, user })
            .memos[0],
          201,
        );
      } catch (error) {
        return jsonError(c, error);
      }
    },
  );
  app.get("/memos/:id", async (c) => {
    try {
      const context = await getRequestContext(c);
      return c.json(
        await buildMemoContext(context, `memos/${c.req.param("id")}`),
      );
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/memos", zValidator("json", createMemoSchema), async (c) => {
    try {
      const { db, user, userLimits } = await getRequestContext(c);
      const memo = await createMemo(db, user, c.req.valid("json"), {
        userLimits,
        userId: user.id,
      });
      return c.json(memoToDto(memo, user), 201);
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.patch("/memos/:id", zValidator("json", updateMemoSchema), async (c) => {
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

  app.post(
    "/memos/:id/memory",
    zValidator("json", createMemoryFromMemoSchema),
    async (c) => {
      try {
        const { db, user, userLimits } = await getRequestContext(c);
        const memoId = `memos/${c.req.param("id")}`;
        const memo = await getMemoById(db, user, memoId);
        if (!memo) throw new NotFoundError("Memo not found");
        const result = await createMemoryFromMemo(
          db,
          user,
          { type: "user" },
          createMemoryFromMemoInputToWrite(c.req.valid("json"), memo.content),
          memoId,
          { userLimits, userId: user.id },
        );
        return c.json(result, result.duplicate ? 200 : 201);
      } catch (error) {
        return jsonError(c, error);
      }
    },
  );

  app.delete("/memos/:id", async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      const id = `memos/${c.req.param("id")}`;
      if (c.req.query("hard") === "true") {
        await hardDeleteMemoWithAttachments(c.env, db, user, id);
        return c.json({ ok: true });
      }
      const memo = await moveMemoToTrash(db, user, id);
      return c.json(memoToDto(memo, user));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get(
    "/tags",
    zValidator("query", z.object({ space: memoSpaceSchema.optional() })),
    async (c) => {
      try {
        const { db, user } = await getRequestContext(c);
        return c.json({
          tags: await listTagHierarchy(db, user, {
            space: c.req.valid("query").space,
          }),
        });
      } catch (error) {
        return jsonError(c, error);
      }
    },
  );

  app.get(
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

  app.patch(
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

  app.patch("/tags", zValidator("json", renameTagRequestSchema), async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      return c.json(await renameTag(db, user, c.req.valid("json")));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.delete("/tags", async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      const tag = c.req.query("tag") ?? "";
      return c.json(await deleteTag(db, user, { tag }));
    } catch (error) {
      return jsonError(c, error);
    }
  });
}
