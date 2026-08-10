import type { FlareMoDb, MemoPayload, MemoRow, UserRow } from "@flaremo/db";
import { memos, memoTags } from "@flaremo/db";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { NotFoundError, ValidationError } from "./errors";

/**
 * Normalize one raw tag value into a canonical tag path.
 *
 * Rules:
 * - Strip a single leading `#`.
 * - Lowercase for consistent matching.
 * - Trim each path segment so `父/ 子` becomes `父/子`.
 * - Collapse duplicate separators and drop trailing separators.
 * - Reject empty results and values longer than 100 chars.
 */
export function normalizeTag(value: string): string | undefined {
  const raw = value.trim().replace(/^#/, "");
  const segments = raw
    .split("/")
    .map((segment) => segment.trim().toLocaleLowerCase())
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) return undefined;
  const tag = segments.join("/");
  if (tag.length > 100) return undefined;
  return tag;
}

/**
 * Normalize an array of raw tag values into a sorted, de-duplicated list of
 * canonical tag paths. Values that fail normalization are dropped.
 */
export function normalizeMemoTags(values: string[]) {
  const tags = new Set<string>();
  for (const value of values) {
    const tag = normalizeTag(value);
    if (tag) tags.add(tag);
  }
  return [...tags].sort((a, b) => a.localeCompare(b));
}

/**
 * Extract `#tag` tokens from memo content. Supports hierarchical tags using
 * `/` as the path separator (`#工作/项目A`). Stops at whitespace or
 * punctuation so `#tag，` still yields `tag`.
 */
export function extractTags(content: string) {
  const tags = new Set<string>();
  for (const match of content.matchAll(
    /(^|[^\p{L}\p{N}_\-/])#([\p{L}\p{N}_\-/]+)/gu,
  )) {
    const raw = match[2];
    if (!raw) continue;
    const tag = normalizeTag(raw);
    if (tag) tags.add(tag);
  }
  return [...tags];
}

/**
 * True when `candidate` is `needle` or a descendant of `needle` in the tag
 * hierarchy. `工作` matches `工作` and `工作/项目A`; `工作/项目A` only
 * matches itself and deeper children.
 */
export function tagPrefixMatches(needle: string, candidate: string) {
  return candidate === needle || candidate.startsWith(`${needle}/`);
}

export type TagHierarchyNode = {
  name: string;
  count: number;
  children: TagHierarchyNode[];
};

type MutableTagNode = Omit<TagHierarchyNode, "children" | "count"> & {
  children: MutableTagNode[];
  count: number;
  map: Map<string, MutableTagNode>;
  memos: Set<string>;
};

/**
 * Build a hierarchical tag tree from the user's memo tags. Every memo tag
 * contributes to its leaf path's count; intermediate nodes aggregate counts
 * from their descendants so `工作` reports the combined count of `工作`,
 * `工作/项目A`, etc. The returned tree is sorted by path.
 */
export async function listTagHierarchy(
  db: FlareMoDb,
  user: UserRow,
): Promise<TagHierarchyNode[]> {
  const rows = await db
    .select({
      memoId: memoTags.memoId,
      name: memoTags.tag,
    })
    .from(memoTags)
    .innerJoin(memos, eq(memoTags.memoId, memos.id))
    .where(
      and(
        eq(memoTags.userId, user.id),
        inArray(memos.status, ["normal", "archived"]),
      ),
    )
    .orderBy(asc(memoTags.tag));
  return buildTagTree(
    rows.map((row) => ({ memoId: row.memoId, name: row.name })),
  );
}

type TagCount = { memoId: string; name: string };

/**
 * Build a hierarchical tag tree with de-duplicated memo counts. Every memo
 * contributes once to each tag path it carries and once to every ancestor of
 * that path, so `工作` reports the number of distinct memos tagged `工作` or
 * any descendant (`工作/项目A`, `工作/项目A/子项`, ...) without double counting
 * a memo that carries both `工作` and `工作/项目A`.
 */
function buildTagTree(tags: TagCount[]): TagHierarchyNode[] {
  const root: MutableTagNode = {
    name: "",
    count: 0,
    children: [],
    map: new Map(),
    memos: new Set(),
  };

  for (const { memoId, name } of tags) {
    const segments = name.split("/");
    let cursor = root;
    let path = "";
    for (const segment of segments) {
      path = path ? `${path}/${segment}` : segment;
      let child = cursor.map.get(segment);
      if (!child) {
        child = {
          name: path,
          count: 0,
          children: [],
          map: new Map(),
          memos: new Set(),
        };
        cursor.map.set(segment, child);
        cursor.children.push(child);
      }
      child.memos.add(memoId);
      cursor = child;
    }
  }

  // Convert memo sets to counts after the tree is fully populated so each
  // memo is counted once per node across all of its tag paths and ancestors.
  const toCounted = (node: MutableTagNode): void => {
    node.count = node.memos.size;
    node.children.forEach(toCounted);
  };
  toCounted(root);

  const strip = (node: MutableTagNode): TagHierarchyNode => ({
    name: node.name,
    count: node.count,
    children: node.children
      .map(strip)
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
  return root.children.map(strip).sort((a, b) => a.name.localeCompare(b.name));
}

export type RenameTagInput = {
  /** Canonical tag path to rename, e.g. `工作`. */
  from: string;
  /** Canonical destination tag path, e.g. `知识/工作` or `工作`. */
  to: string;
};

export type RenameTagResult = {
  renamed: number;
};

/**
 * Rename (or move) a tag subtree across every memo that uses it. The tag is
 * updated in `memo_tags`, in each affected memo's `payload.tags`, and in memo
 * content by rewriting the `#tag` token. Renaming `工作` to `知识/工作` moves
 * the tag and its descendants, so exact child tags such as `工作/项目A` keep
 * their path shape as `知识/工作/项目A`.
 */
export async function renameTag(
  db: FlareMoDb,
  user: UserRow,
  input: RenameTagInput,
): Promise<RenameTagResult> {
  const from = normalizeTag(input.from);
  const to = normalizeTag(input.to);
  if (!from) throw new ValidationError("source tag is invalid");
  if (!to) throw new ValidationError("destination tag is invalid");
  if (from === to) return { renamed: 0 };

  const rows = await db
    .select({
      memoId: memoTags.memoId,
      tag: memoTags.tag,
      createdAt: memoTags.createdAt,
    })
    .from(memoTags)
    .where(
      and(
        eq(memoTags.userId, user.id),
        or(eq(memoTags.tag, from), sql`${memoTags.tag} LIKE ${`${from}/%`}`),
      ),
    )
    .all();
  if (rows.length === 0) {
    throw new NotFoundError(`Tag not found: #${from}`);
  }

  const memoIds = [...new Set(rows.map((row) => row.memoId))];
  const memosToUpdate = await db
    .select()
    .from(memos)
    .where(inArray(memos.id, memoIds))
    .all();

  // Rewrite payload.tags and content for every affected memo, moving the
  // tag subtree: `工作` and `工作/项目A` become `知识/工作` and
  // `知识/工作/项目A`.
  const payloadStatements: unknown[] = [];
  for (const memo of memosToUpdate) {
    const content = rewriteTagInContent(memo.content, from, to);
    const payload = memoPayloadWithTags(memo, (tags) =>
      tags
        .map((tag) =>
          tag === from || tag.startsWith(`${from}/`)
            ? `${to}${tag.slice(from.length)}`
            : tag,
        )
        .filter((tag, index, all) => all.indexOf(tag) === index)
        .sort((a, b) => a.localeCompare(b)),
    );
    payloadStatements.push(
      db.update(memos).set({ content, payload }).where(eq(memos.id, memo.id)),
    );
  }

  // Move the tag rows. Delete first (within the same batch) to avoid
  // primary-key collisions when a memo already carries a destination path,
  // then re-insert with the new path and the original timestamps. Keeping
  // every statement in one D1 batch keeps the move atomic.
  const deleteStatement = db
    .delete(memoTags)
    .where(
      and(
        eq(memoTags.userId, user.id),
        or(eq(memoTags.tag, from), sql`${memoTags.tag} LIKE ${`${from}/%`}`),
      ),
    );
  const insertStatements: unknown[] = rows.map((row) =>
    db.insert(memoTags).values({
      memoId: row.memoId,
      userId: user.id,
      tag: `${to}${row.tag.slice(from.length)}`,
      createdAt: row.createdAt,
    }),
  );

  const allStatements = [
    deleteStatement,
    ...payloadStatements,
    ...insertStatements,
  ];
  if (allStatements.length > 1) {
    await db.batch(
      allStatements as unknown as Parameters<FlareMoDb["batch"]>[0],
    );
  }

  return { renamed: memosToUpdate.length };
}

export type DeleteTagInput = {
  /** Canonical tag path to delete, e.g. `工作/项目A`. */
  tag: string;
};

export type DeleteTagResult = {
  removed: number;
};

/**
 * Delete a tag from every memo that uses it. The tag is removed from
 * `memo_tags`, from `payload.tags`, and from memo content. Only the exact tag
 * path is removed; child tags (`工作/项目A`) and unrelated tags are kept.
 */
export async function deleteTag(
  db: FlareMoDb,
  user: UserRow,
  input: DeleteTagInput,
): Promise<DeleteTagResult> {
  const tag = normalizeTag(input.tag);
  if (!tag) throw new ValidationError("tag is invalid");

  const rows = await db
    .select({ memoId: memoTags.memoId })
    .from(memoTags)
    .where(and(eq(memoTags.userId, user.id), eq(memoTags.tag, tag)))
    .all();
  if (rows.length === 0) {
    throw new NotFoundError(`Tag not found: #${tag}`);
  }

  const memoIds = rows.map((row) => row.memoId);
  const memosToUpdate = await db
    .select()
    .from(memos)
    .where(inArray(memos.id, memoIds))
    .all();

  const statements: unknown[] = [];
  for (const memo of memosToUpdate) {
    const content = removeTagFromContent(memo.content, tag);
    const payload = memoPayloadWithTags(memo, (tags) =>
      tags.filter((candidate) => candidate !== tag),
    );
    statements.push(
      db.update(memos).set({ content, payload }).where(eq(memos.id, memo.id)),
    );
  }

  const deleteStatement = db
    .delete(memoTags)
    .where(
      and(
        eq(memoTags.userId, user.id),
        eq(memoTags.tag, tag),
        inArray(memoTags.memoId, memoIds),
      ),
    );

  if (statements.length > 0) {
    await db.batch([deleteStatement, ...statements] as unknown as Parameters<
      FlareMoDb["batch"]
    >[0]);
  } else {
    await deleteStatement;
  }

  return { removed: memosToUpdate.length };
}

/**
 * Return the memo payload with `payload.tags` transformed by `update`. The
 * payload keeps its other fields intact.
 */
function memoPayloadWithTags(
  memo: MemoRow,
  update: (tags: string[]) => string[],
): MemoPayload {
  const payload: MemoPayload =
    memo.payload && typeof memo.payload === "object" ? { ...memo.payload } : {};
  const currentTags = Array.isArray(payload.tags)
    ? payload.tags.filter((tag): tag is string => typeof tag === "string")
    : [];
  return { ...payload, tags: update(currentTags) };
}

/**
 * Rewrite `#from` tag tokens in content to `#to`, moving the tag subtree.
 * `#工作` becomes `#知识/工作`, and `#工作/项目A` becomes
 * `#知识/工作/项目A` (the descendant suffix is preserved). Tags that merely
 * share a prefix (`#工作者`, `#工作-1`) are left untouched.
 */
export function rewriteTagInContent(content: string, from: string, to: string) {
  const escaped = escapeRegExp(from);
  return content.replace(
    new RegExp(
      `(^|[^\\p{L}\\p{N}_\\-/])#${escaped}(?![\\p{L}\\p{N}_\\-])`,
      "giu",
    ),
    (_match, boundary: string) => `${boundary}#${to}`,
  );
}

/**
 * Remove `#tag` tokens from content, including the trailing separator guard.
 */
export function removeTagFromContent(content: string, tag: string) {
  const escaped = escapeRegExp(tag);
  return content.replace(
    new RegExp(
      `(^|[^\\p{L}\\p{N}_\\-/])#${escaped}(?![\\p{L}\\p{N}_\\-/])`,
      "giu",
    ),
    (_match, boundary: string) => (boundary === "" ? "" : boundary),
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
