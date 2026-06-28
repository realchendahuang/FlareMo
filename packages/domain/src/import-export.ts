import type { ImportBundle } from "@flaremo/contracts";
import type { FlareMoDb, MemoPayload, UserRow } from "@flaremo/db";
import { attachments, memoRelations, memos, shares } from "@flaremo/db";
import { eq } from "drizzle-orm";
import { createResourceId, parseResourceName } from "./ids";

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
    version: 1,
    exported_at: new Date().toISOString(),
    memos: memoRows.map((memo) => ({
      name: memo.id,
      content: memo.content,
      visibility: memo.visibility,
      state: memo.status,
      pinned: memo.pinned,
      payload: memo.payload ?? {},
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
        payload: attachment.payload ?? {},
        create_time: attachment.createdAt,
        update_time: attachment.updatedAt,
      })),
    relations: relationRows
      .filter((relation) => memoIds.has(relation.memoId))
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
    })),
  };
}

export async function importData(
  db: FlareMoDb,
  user: UserRow,
  bundle: ImportBundle,
  options: { attachmentR2Keys?: Map<string, string> } = {},
) {
  const now = new Date().toISOString();
  const memoIdMap = new Map<string, string>();
  let importedMemos = 0;
  let importedAttachments = 0;
  let importedRelations = 0;
  let importedShares = 0;

  for (const memo of bundle.memos) {
    const importedId = createResourceId("memos");
    memoIdMap.set(memo.name, importedId);
    await db.insert(memos).values({
      id: importedId,
      userId: user.id,
      content: memo.content,
      visibility: memo.visibility,
      status: memo.state,
      pinned: memo.pinned,
      source: "import",
      payload: normalizeMemoPayload(memo.payload),
      createdAt: now,
      updatedAt: now,
      deletedAt:
        memo.state === "deleted" || memo.state === "trashed" ? now : null,
    });
    importedMemos += 1;
  }

  for (const attachment of bundle.attachments) {
    const mappedMemoId = attachment.memo
      ? (memoIdMap.get(attachment.memo) ?? null)
      : null;
    const payload = {
      ...(attachment.payload ?? {}),
      ...(attachment.data_base64 ? {} : { imported_without_binary: true }),
    };
    await db.insert(attachments).values({
      id: createResourceId("attachments"),
      userId: user.id,
      memoId: mappedMemoId,
      r2Key:
        options.attachmentR2Keys?.get(attachment.name) ??
        `imports/${user.id}/missing/${crypto.randomUUID()}`,
      filename: attachment.filename,
      contentType: attachment.content_type,
      size: attachment.size,
      payload,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    importedAttachments += 1;
  }

  for (const relation of bundle.relations) {
    const memoId = memoIdMap.get(relation.memo);
    const relatedMemoId = memoIdMap.get(relation.related_memo);
    if (!memoId || !relatedMemoId) {
      continue;
    }
    await db
      .insert(memoRelations)
      .values({
        memoId,
        relatedMemoId,
        type: relation.type,
        createdAt: now,
      })
      .onConflictDoNothing();
    importedRelations += 1;
  }

  for (const share of bundle.shares) {
    const memoId = memoIdMap.get(share.memo);
    if (!memoId) {
      continue;
    }
    await db.insert(shares).values({
      id: createResourceId("shares"),
      memoId,
      userId: user.id,
      token: `${share.token}-import-${crypto.randomUUID()}`,
      expiresAt: share.expires_at,
      createdAt: now,
    });
    importedShares += 1;
  }

  return {
    imported_memos: importedMemos,
    imported_attachments: importedAttachments,
    imported_relations: importedRelations,
    imported_shares: importedShares,
  };
}

export function mapImportedMemoName(name: string) {
  return parseResourceName(name, "memos");
}

function normalizeMemoPayload(payload: unknown): MemoPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  return payload as MemoPayload;
}
