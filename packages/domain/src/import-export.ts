import type { ImportBundle, ImportOptions } from "@flaremo/contracts";
import type { FlareMoDb, UserRow } from "@flaremo/db";
import {
  attachments,
  memoRelations,
  memos,
  memoTags,
  shares,
} from "@flaremo/db";
import { and, eq } from "drizzle-orm";
import { createResourceId, createToken, parseResourceName } from "./ids";
import {
  normalizeMemoClientId,
  normalizeMemoPayload,
  normalizeMemoTags,
  updateMemo,
} from "./memos";

export async function exportData(
  db: FlareMoDb,
  user: UserRow,
): Promise<ImportBundle> {
  const [memoRows, attachmentRows, relationRows, shareRows] = await Promise.all(
    [
      db.select().from(memos).where(eq(memos.userId, user.id)),
      db.select().from(attachments).where(eq(attachments.userId, user.id)),
      db.select().from(memoRelations),
      db.select().from(shares).where(eq(shares.userId, user.id)),
    ],
  );

  const memoIds = new Set(memoRows.map((memo) => memo.id));
  return {
    version: 2,
    exported_at: new Date().toISOString(),
    memos: memoRows.map((memo) => ({
      name: memo.id,
      content: memo.content,
      visibility: memo.visibility,
      state: memo.status,
      pinned: memo.pinned,
      payload: memo.payload ?? {},
      source: memo.source,
      create_time: memo.createdAt,
      update_time: memo.updatedAt,
      display_time: memo.createdAt,
    })),
    attachments: attachmentRows
      .filter((attachment) => !attachment.deletedAt)
      .map((attachment) => ({
        name: attachment.id,
        id: attachment.id.replace(/^attachments\//, ""),
        memo: attachment.memoId,
        filename: attachment.filename,
        content_type: attachment.contentType,
        size: attachment.size,
        state: attachment.state,
        etag: attachment.etag,
        payload: attachment.payload ?? {},
        create_time: attachment.createdAt,
        update_time: attachment.updatedAt,
      })),
    relations: relationRows
      .filter(
        (relation) =>
          memoIds.has(relation.memoId) && memoIds.has(relation.relatedMemoId),
      )
      .map((relation) => ({
        memo: relation.memoId,
        related_memo: relation.relatedMemoId,
        type: relation.type,
        create_time: relation.createdAt,
      })),
    shares: shareRows.map((share) => ({
      name: share.id,
      id: share.id.replace(/^shares\//, ""),
      memo: share.memoId,
      token: share.token,
      expires_at: share.expiresAt,
      create_time: share.createdAt,
      update_time: share.updatedAt,
      revoked_at: share.revokedAt,
    })),
  };
}

export async function importData(
  db: FlareMoDb,
  user: UserRow,
  bundle: ImportBundle,
  options: {
    attachmentR2Keys?: Map<string, string>;
    attachmentEtags?: Map<string, string | null>;
    conflict?: ImportOptions["conflict"];
  } = {},
) {
  const now = new Date().toISOString();
  const conflict = options.conflict ?? "duplicate";
  const memoIdMap = new Map<string, string>();
  let importedMemos = 0;
  let skippedMemos = 0;
  let overwrittenMemos = 0;
  let importedAttachments = 0;
  let importedRelations = 0;
  let importedShares = 0;
  const cleanupR2Keys: string[] = [];

  for (const memo of bundle.memos) {
    const sourceId = parseResourceName(memo.name, "memos");
    const payload = normalizeMemoPayload(memo.payload);
    const requestedClientId = normalizeMemoClientId(payload.client_id);
    if (requestedClientId) payload.client_id = requestedClientId;

    const existingById = await db
      .select({ id: memos.id })
      .from(memos)
      .where(and(eq(memos.id, sourceId), eq(memos.userId, user.id)))
      .get();
    const existingByClientId = requestedClientId
      ? await db
          .select({ id: memos.id })
          .from(memos)
          .where(
            and(
              eq(memos.userId, user.id),
              eq(memos.clientId, requestedClientId),
            ),
          )
          .get()
      : undefined;
    const existing = existingById ?? existingByClientId;

    if (existing && conflict === "skip") {
      memoIdMap.set(memo.name, existing.id);
      skippedMemos += 1;
      continue;
    }

    if (existing && conflict === "overwrite") {
      // `client_id` is a stable creation id, not imported memo content. The
      // target row keeps its canonical value (or gains it only on insert).
      delete payload.client_id;
      await updateMemo(db, user, existing.id, {
        content: memo.content,
        visibility: memo.visibility,
        status: memo.state,
        pinned: memo.pinned,
        payload,
      });
      await db
        .update(memos)
        .set({
          source: memo.source ?? "import",
          createdAt: memo.create_time ?? now,
          updatedAt: memo.update_time ?? memo.create_time ?? now,
        })
        .where(and(eq(memos.id, existing.id), eq(memos.userId, user.id)));
      memoIdMap.set(memo.name, existing.id);
      overwrittenMemos += 1;
      continue;
    }

    const importedId = existingById ? createResourceId("memos") : sourceId;
    memoIdMap.set(memo.name, importedId);
    // A duplicate import is intentionally a new memo. It cannot reuse the
    // original request's idempotency key when that key already identifies a
    // memo in this account.
    const clientId = existingByClientId ? undefined : requestedClientId;
    if (clientId) {
      payload.client_id = clientId;
    } else if (existingByClientId) {
      delete payload.client_id;
    }
    const tags = normalizeMemoTags(payload.tags ?? extractTags(memo.content));
    payload.tags = tags;
    const createdAt = memo.create_time ?? now;
    const updatedAt = memo.update_time ?? createdAt;
    const insertMemo = db.insert(memos).values({
      id: importedId,
      userId: user.id,
      content: memo.content,
      visibility: memo.visibility,
      status: memo.state,
      pinned: memo.pinned,
      source: memo.source ?? "import",
      clientId,
      payload,
      createdAt,
      updatedAt,
      deletedAt:
        memo.state === "deleted" || memo.state === "trashed" ? updatedAt : null,
    });
    if (tags.length > 0) {
      await db.batch([
        insertMemo,
        db.insert(memoTags).values(
          tags.map((tag) => ({
            memoId: importedId,
            userId: user.id,
            tag,
            createdAt,
          })),
        ),
      ]);
    } else {
      await insertMemo;
    }
    importedMemos += 1;
  }

  for (const attachment of bundle.attachments) {
    const mappedMemoId = attachment.memo
      ? (memoIdMap.get(attachment.memo) ?? null)
      : null;
    const objectKey = options.attachmentR2Keys?.get(attachment.name);
    const payload = {
      ...(attachment.payload ?? {}),
      ...(objectKey ? {} : { imported_without_binary: true }),
    };
    const sourceId = parseResourceName(attachment.name, "attachments");
    const existing = await db
      .select({
        id: attachments.id,
        r2Key: attachments.r2Key,
        state: attachments.state,
      })
      .from(attachments)
      .where(and(eq(attachments.id, sourceId), eq(attachments.userId, user.id)))
      .get();
    if (existing && conflict === "skip") {
      if (objectKey) cleanupR2Keys.push(objectKey);
      continue;
    }
    const importedId = existing ? createResourceId("attachments") : sourceId;
    const createdAt = attachment.create_time || now;
    const updatedAt = attachment.update_time || createdAt;
    const attachmentValues = {
      id: importedId,
      userId: user.id,
      memoId: mappedMemoId,
      r2Key:
        objectKey ??
        existing?.r2Key ??
        `imports/${user.id}/missing/${crypto.randomUUID()}`,
      filename: attachment.filename,
      contentType: attachment.content_type,
      size: attachment.size,
      state: objectKey ? ("ready" as const) : (existing?.state ?? "missing"),
      etag:
        options.attachmentEtags?.get(attachment.name) ??
        attachment.etag ??
        null,
      payload,
      createdAt,
      updatedAt,
      deletedAt: null,
    };
    if (existing && conflict === "overwrite") {
      await db
        .update(attachments)
        .set({ ...attachmentValues, id: existing.id })
        .where(
          and(eq(attachments.id, existing.id), eq(attachments.userId, user.id)),
        );
      if (objectKey && objectKey !== existing.r2Key) {
        cleanupR2Keys.push(existing.r2Key);
      }
    } else {
      await db.insert(attachments).values(attachmentValues);
    }
    importedAttachments += 1;
  }

  for (const relation of bundle.relations) {
    const memoId = memoIdMap.get(relation.memo);
    const relatedMemoId = memoIdMap.get(relation.related_memo);
    if (!memoId || !relatedMemoId) continue;
    const result = await db
      .insert(memoRelations)
      .values({
        memoId,
        relatedMemoId,
        type: relation.type,
        createdAt: relation.create_time || now,
      })
      .onConflictDoNothing();
    if (result.meta.changes > 0) importedRelations += 1;
  }

  for (const share of bundle.shares) {
    const memoId = memoIdMap.get(share.memo);
    if (!memoId) continue;
    const createdAt = share.create_time || now;
    await db.insert(shares).values({
      id: createResourceId("shares"),
      memoId,
      userId: user.id,
      token: createToken(),
      expiresAt: share.expires_at,
      createdAt,
      updatedAt: share.update_time ?? createdAt,
      revokedAt: share.revoked_at ?? null,
    });
    importedShares += 1;
  }

  return {
    imported_memos: importedMemos,
    skipped_memos: skippedMemos,
    overwritten_memos: overwrittenMemos,
    imported_attachments: importedAttachments,
    imported_relations: importedRelations,
    imported_shares: importedShares,
    cleanupR2Keys,
  };
}

export function mapImportedMemoName(name: string) {
  return parseResourceName(name, "memos");
}

function extractTags(content: string) {
  return [...content.matchAll(/(^|\s)#([\p{L}\p{N}_-]+)/gu)].flatMap((match) =>
    match[2] ? [match[2]] : [],
  );
}
