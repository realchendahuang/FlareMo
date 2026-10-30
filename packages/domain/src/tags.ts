import type { MemoSpace } from "@flaremo/contracts";
import type { FlareMoDb, MemoPayload, MemoRow, UserRow } from "@flaremo/db";
import { memoRevisions, memos, memoTags } from "@flaremo/db";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { chunkForD1, d1IdsPerStatement } from "./d1-limits";
import { insertEmbeddingTask } from "./embedding-outbox";
import { NotFoundError, ValidationError } from "./errors";
import { createResourceId } from "./ids";
import { notComment } from "./memo-comment-filter";
import { insertMemosSseEvent } from "./memos-sse";
import { insertMemosWebhookEvent } from "./memos-webhooks";
import { scopedReadScope, type TeamViewer } from "./team-permissions";

// D1 batches stay well under the per-request statement budget, so a rename
// over hundreds of memos is split into memo-chunks instead of one unbounded
// batch. Each chunk is self-contained (tag-row delete first, then inserts),
// and the operations are idempotent: a retry simply finds fewer rows.
const TAG_MUTATION_MEMOS_PER_BATCH = 15;

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
 * Maximum tags accepted for a single memo. The write path inserts one row per
 * tag with four bound columns, and D1 rejects any statement past 100
 * parameters — so this ceiling is what keeps a single memo's tag insert
 * inside one statement. It also bounds what a client can make us write.
 */
export const MAX_MEMO_TAGS = 20;

/**
 * Normalize an array of raw tag values into a sorted, de-duplicated list of
 * canonical tag paths. Values that fail normalization are dropped.
 */
export function normalizeMemoTags(values: string[]) {
  const tags = new Set<string>();
  for (const value of values) {
    const tag = normalizeTag(value);
    if (tag) tags.add(tag);
    if (tags.size >= MAX_MEMO_TAGS) break;
  }
  return [...tags].sort((a, b) => a.localeCompare(b));
}

/**
 * Extract `#tag` tokens from memo content. Supports hierarchical tags using
 * `/` as the path separator (`#工作/项目A`). Stops at whitespace or
 * punctuation so `#tag，` still yields `tag`.
 *
 * Code is not prose: fenced code blocks and inline code spans are skipped, so
 * a `#comment` or `#include` inside a snippet never becomes a tag (issue #152).
 */
export function extractTags(content: string) {
  const tags = new Set<string>();
  for (const { text, literal } of splitMarkdownLiteralSegments(content)) {
    if (literal) continue;
    for (const match of text.matchAll(
      /(^|[^\p{L}\p{N}_\-/])#([\p{L}\p{N}_\-/]+)/gu,
    )) {
      const raw = match[2];
      if (!raw) continue;
      const tag = normalizeTag(raw);
      if (tag) tags.add(tag);
    }
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
 * Build a hierarchical tag tree from the memo tags the viewer can read. Every
 * memo tag contributes to its leaf path's count; intermediate nodes aggregate
 * counts from their descendants so `工作` reports the combined count of `工作`,
 * `工作/项目A`, etc. The returned tree is sorted by path. Without a space the
 * tree keeps the historical own-corpus semantics.
 */
export async function listTagHierarchy(
  db: FlareMoDb,
  user: TeamViewer,
  options: { space?: MemoSpace } = {},
): Promise<TagHierarchyNode[]> {
  const scope = options.space
    ? and(
        scopedReadScope(user, options.space),
        inArray(memos.status, ["normal", "archived"]),
        notComment(),
      )
    : and(
        eq(memoTags.userId, user.id),
        inArray(memos.status, ["normal", "archived"]),
        // A tag inside a comment does not file the comment as a note.
        notComment(),
      );

  // Leaf counts come from one aggregation: D1 reads the covering index
  // (`user_id, tag, memo_id`) and returns one row per distinct tag instead of
  // one row per (memo, tag) pair — a 50k-memo corpus used to ship ~150k rows
  // to the Worker on every sidebar refresh.
  const grouped = await db
    .select({
      tag: memoTags.tag,
      count: sql<number>`count(distinct ${memoTags.memoId})`.mapWith(Number),
    })
    .from(memoTags)
    .innerJoin(memos, eq(memoTags.memoId, memos.id))
    .where(scope)
    .groupBy(memoTags.tag);

  // Only hierarchy nodes need per-memo identity: a memo carrying both `工作`
  // and `工作/项目A` must count once for `工作`. Any tag containing a `/` and
  // all of its ancestors are the only nodes whose count is not simply their
  // own aggregated count, so the second read is scoped to those.
  const hierarchical = new Set<string>();
  for (const row of grouped) {
    if (!row.tag.includes("/")) continue;
    let path = "";
    for (const segment of row.tag.split("/")) {
      path = path ? `${path}/${segment}` : segment;
      hierarchical.add(path);
    }
  }

  const memoEdges: TagCount[] = [];
  if (hierarchical.size > 0) {
    const tags = [...hierarchical];
    // `scopedReadScope` adds several bindings of its own in team space, so the
    // default reserve is the safe size here.
    for (const tagChunk of chunkForD1(tags, d1IdsPerStatement())) {
      memoEdges.push(
        ...(await db
          .select({ memoId: memoTags.memoId, name: memoTags.tag })
          .from(memoTags)
          .innerJoin(memos, eq(memoTags.memoId, memos.id))
          .where(and(scope, inArray(memoTags.tag, tagChunk)))),
      );
    }
  }

  return buildTagTree(grouped, memoEdges, hierarchical);
}

type TagCount = { memoId: string; name: string };

/**
 * Build a hierarchical tag tree with de-duplicated memo counts. Every memo
 * contributes once to each tag path it carries and once to every ancestor of
 * that path, so `工作` reports the number of distinct memos tagged `工作` or
 * any descendant (`工作/项目A`, `工作/项目A/子项`, ...) without double counting
 * a memo that carries both `工作` and `工作/项目A`.
 *
 * `aggregated` carries one exact distinct-memo count per leaf tag (from SQL);
 * `memoEdges` carries per-memo memberships for hierarchy nodes only, which is
 * what the ancestor de-duplication needs.
 */
function buildTagTree(
  aggregated: ReadonlyArray<{ tag: string; count: number }>,
  memoEdges: readonly TagCount[],
  hierarchical: ReadonlySet<string>,
): TagHierarchyNode[] {
  const root: MutableTagNode = {
    name: "",
    count: 0,
    children: [],
    map: new Map(),
    memos: new Set(),
  };

  const ensureNode = (segments: readonly string[]) => {
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
      cursor = child;
    }
    return cursor;
  };

  for (const row of aggregated) {
    const node = ensureNode(row.tag.split("/"));
    if (!hierarchical.has(row.tag)) node.count = row.count;
  }

  for (const { memoId, name } of memoEdges) {
    let cursor = root;
    let path = "";
    for (const segment of name.split("/")) {
      path = path ? `${path}/${segment}` : segment;
      const child = cursor.map.get(segment);
      if (!child) continue;
      child.memos.add(memoId);
      cursor = child;
    }
  }

  // Convert memo sets to counts after the tree is fully populated so each
  // memo is counted once per node across all of its tag paths and ancestors.
  const toCounted = (node: MutableTagNode): void => {
    if (hierarchical.has(node.name)) node.count = node.memos.size;
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
  // A popular tag can cover thousands of memos, and this lookup binds one
  // parameter per id — chunk it or the rename fails before touching anything.
  const memosToUpdate: MemoRow[] = [];
  for (const idChunk of chunkForD1(memoIds, d1IdsPerStatement())) {
    memosToUpdate.push(
      ...(await db
        .select()
        .from(memos)
        .where(inArray(memos.id, idChunk))
        .all()),
    );
  }

  const now = new Date().toISOString();
  for (
    let offset = 0;
    offset < memosToUpdate.length;
    offset += TAG_MUTATION_MEMOS_PER_BATCH
  ) {
    const chunkMemos = memosToUpdate.slice(
      offset,
      offset + TAG_MUTATION_MEMOS_PER_BATCH,
    );
    const chunkIds = chunkMemos.map((memo) => memo.id);
    const chunkIdSet = new Set(chunkIds);
    const chunkRows = rows.filter((row) => chunkIdSet.has(row.memoId));
    // Delete-first per chunk avoids primary-key collisions when a memo
    // already carries the destination path.
    const chunkStatements: unknown[] = [
      db
        .delete(memoTags)
        .where(
          and(
            eq(memoTags.userId, user.id),
            or(
              eq(memoTags.tag, from),
              sql`${memoTags.tag} LIKE ${`${from}/%`}`,
            ),
            inArray(memoTags.memoId, chunkIds),
          ),
        ),
    ];
    for (const memo of chunkMemos) {
      chunkStatements.push(
        ...tagMemoUpdateStatements(db, user, memo, now, (memo) => {
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
          return { content, payload };
        }),
      );
    }
    for (const row of chunkRows) {
      chunkStatements.push(
        db.insert(memoTags).values({
          memoId: row.memoId,
          userId: user.id,
          tag: `${to}${row.tag.slice(from.length)}`,
          createdAt: row.createdAt,
        }),
      );
    }
    await db.batch(
      chunkStatements as unknown as Parameters<FlareMoDb["batch"]>[0],
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
  const memosToUpdate: MemoRow[] = [];
  for (const idChunk of chunkForD1(memoIds, d1IdsPerStatement())) {
    memosToUpdate.push(
      ...(await db
        .select()
        .from(memos)
        .where(inArray(memos.id, idChunk))
        .all()),
    );
  }

  const now = new Date().toISOString();
  for (
    let offset = 0;
    offset < memosToUpdate.length;
    offset += TAG_MUTATION_MEMOS_PER_BATCH
  ) {
    const chunkMemos = memosToUpdate.slice(
      offset,
      offset + TAG_MUTATION_MEMOS_PER_BATCH,
    );
    const chunkIds = chunkMemos.map((memo) => memo.id);
    const statements: unknown[] = [
      db
        .delete(memoTags)
        .where(
          and(
            eq(memoTags.userId, user.id),
            eq(memoTags.tag, tag),
            inArray(memoTags.memoId, chunkIds),
          ),
        ),
    ];
    for (const memo of chunkMemos) {
      statements.push(
        ...tagMemoUpdateStatements(db, user, memo, now, (current) => {
          const content = removeTagFromContent(current.content, tag);
          const payload = memoPayloadWithTags(current, (tags) =>
            tags.filter((candidate) => candidate !== tag),
          );
          return { content, payload };
        }),
      );
    }
    await db.batch(statements as unknown as Parameters<FlareMoDb["batch"]>[0]);
  }

  return { removed: memosToUpdate.length };
}

/**
 * Per-memo statement bundle for a tag mutation: the memo row update (content,
 * payload, `updatedAt`), a revision snapshot of the previous state, an
 * embedding reindex task, and the SSE + webhook events — every side effect a
 * plain content edit would produce, so tag mutations stay consistent with the
 * rest of the write paths.
 */
function tagMemoUpdateStatements(
  db: FlareMoDb,
  user: UserRow,
  memo: MemoRow,
  now: string,
  transform: (memo: MemoRow) => { content: string; payload: MemoPayload },
): unknown[] {
  const { content, payload } = transform(memo);
  const revisedMemo: MemoRow = { ...memo, content, payload, updatedAt: now };
  return [
    db
      .update(memos)
      .set({ content, payload, updatedAt: now })
      .where(eq(memos.id, memo.id)),
    db.insert(memoRevisions).values({
      id: createResourceId("revisions"),
      memoId: memo.id,
      userId: memo.userId,
      content: memo.content,
      visibility: memo.visibility,
      payload: memo.payload,
      createdAt: now,
    }),
    insertEmbeddingTask(db, {
      userId: memo.userId,
      resourceType: "memo",
      resourceId: memo.id,
      operation: "reindex",
      createdAt: now,
    }),
    insertMemosSseEvent(db, {
      type: "memo.updated",
      name: memo.id,
      visibility: revisedMemo.visibility,
      teamId: revisedMemo.teamId,
      creatorId: revisedMemo.userId,
      createdAt: now,
    }),
    insertMemosWebhookEvent(db, {
      receiverId: memo.userId,
      activityType: "memos.memo.updated",
      creator: user,
      memo: revisedMemo,
      createdAt: now,
    }),
  ];
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
 * share a prefix (`#工作者`, `#工作-1`) are left untouched. Fenced code
 * blocks, inline code spans, and URLs are never rewritten, so code samples
 * and link fragments survive a rename intact.
 */
export function rewriteTagInContent(content: string, from: string, to: string) {
  const escaped = escapeRegExp(from);
  return rewriteOutsideLiteralSegments(content, (segment) =>
    segment.replace(
      new RegExp(
        `(^|[^\\p{L}\\p{N}_\\-/])#${escaped}(?![\\p{L}\\p{N}_\\-])`,
        "giu",
      ),
      (_match, boundary: string) => `${boundary}#${to}`,
    ),
  );
}

/**
 * Remove `#tag` tokens from content, including the trailing separator guard.
 * Same safety rules as the rename: code spans, fenced blocks, and URLs are
 * preserved.
 */
export function removeTagFromContent(content: string, tag: string) {
  const escaped = escapeRegExp(tag);
  return rewriteOutsideLiteralSegments(content, (segment) =>
    segment.replace(
      new RegExp(
        `(^|[^\\p{L}\\p{N}_\\-/])#${escaped}(?![\\p{L}\\p{N}_\\-/])`,
        "giu",
      ),
      (_match, boundary: string) => (boundary === "" ? "" : boundary),
    ),
  );
}

/**
 * Split content into segments, marking fenced code blocks, inline code spans,
 * and URLs as literal (untouched). Returns the pieces in order.
 *
 * Fence bookkeeping: prose before the opening fence stays ordinary so tags
 * sitting right before a code block remain rewritable; the opening fence line,
 * the code body, and the closing fence are all literal so samples are never
 * rewritten or mined for tags. An unclosed fence runs literal to the end.
 */
function splitMarkdownLiteralSegments(
  content: string,
): { text: string; literal: boolean }[] {
  const pieces: { text: string; literal: boolean }[] = [];
  const push = (text: string, literal: boolean) => {
    if (text) pieces.push({ text, literal });
  };
  const lines = content.split(/(?<=\n)/);
  let inFence = false;
  let fenceChar = "";
  let fenceLength = 0;
  let code = "";
  let plain = "";
  for (const line of lines) {
    if (inFence) {
      code += line;
      // Closing fence: same character, at least as long, nothing after it.
      const marker = line.trimEnd().match(/^[ \t]*(~{3,}|`{3,})[ \t]*$/)?.[1];
      if (marker && marker[0] === fenceChar && marker.length >= fenceLength) {
        // The whole block — body, closing fence included — is literal.
        push(code, true);
        code = "";
        inFence = false;
        fenceChar = "";
        fenceLength = 0;
      }
      continue;
    }
    const opening = line.match(/^[ \t]*(~{3,}|`{3,})/)?.[1];
    if (opening) {
      // Flush prose collected before the fence as ordinary text, then mark
      // only the fence line itself (and everything after it) literal.
      push(plain, false);
      plain = "";
      push(line, true);
      inFence = true;
      fenceChar = opening[0] ?? "";
      fenceLength = opening.length;
      continue;
    }
    // Split inline code spans and URLs out of ordinary lines.
    let cursor = 0;
    let index = 0;
    while (index < line.length) {
      const character = line[index];
      if (character === "`") {
        let run = 0;
        while (line[index + run] === "`") run += 1;
        const close = line.indexOf("`".repeat(run), index + run);
        if (close !== -1) {
          // Flush the prose before the span first: pieces are concatenated in
          // order, so a buffered `plain` must not overtake this literal.
          plain += line.slice(cursor, index);
          push(plain, false);
          plain = "";
          pieces.push({
            text: line.slice(index, close + run),
            literal: true,
          });
          cursor = close + run;
          index = cursor;
          continue;
        }
        index += run;
        continue;
      }
      if (
        (character === "h" && line.startsWith("https://", index)) ||
        (character === "h" && line.startsWith("http://", index))
      ) {
        let end = index;
        while (end < line.length && !/\s/.test(line[end] as string)) end += 1;
        plain += line.slice(cursor, index);
        push(plain, false);
        plain = "";
        pieces.push({ text: line.slice(index, end), literal: true });
        cursor = end;
        index = end;
        continue;
      }
      index += 1;
    }
    plain += line.slice(cursor);
  }
  if (inFence) {
    // An unclosed fence swallows everything up to the end of the content.
    push(code, true);
  } else {
    push(plain, false);
  }
  return pieces;
}

function rewriteOutsideLiteralSegments(
  content: string,
  transform: (segment: string) => string,
) {
  return splitMarkdownLiteralSegments(content)
    .map(({ text, literal }) => (literal ? text : transform(text)))
    .join("");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
