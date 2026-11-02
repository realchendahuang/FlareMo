import type {
  ArticleDto,
  ArticleSummaryDto,
  CreateArticleInput,
  PublishArticleInput,
  UpdateArticleInput,
} from "@flaremo/contracts";
import type { ArticleRow, FlareMoDb, UserRow } from "@flaremo/db";
import { articles, attachments, users } from "@flaremo/db";
import { and, desc, eq, inArray, isNotNull, isNull, lt, ne } from "drizzle-orm";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { createResourceId, createToken, parseResourceName } from "./ids";

// ---------------------------------------------------------------------------
// DTO mapping
// ---------------------------------------------------------------------------

export function articleToDto(row: ArticleRow): ArticleDto {
  return {
    id: row.id,
    user_id: row.userId,
    slug: row.slug,
    title: row.title,
    description: row.description,
    content: row.content,
    status: row.status,
    cover_attachment_id: row.coverAttachmentId,
    lang: row.lang,
    published_at: row.publishedAt,
    deleted_at: row.deletedAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export function articleToSummaryDto(row: ArticleRow): ArticleSummaryDto {
  const dto = articleToDto(row);
  const { content: _content, ...summary } = dto;
  return summary;
}

// ---------------------------------------------------------------------------
// Slug generation. CJK titles transliterate to pinyin via the mature
// `transliteration` package (the de-facto CJK slug lib); untransliterable
// strings fall back to a random suffix. Slugs are unique across ALL rows
// (drafts included), so a published slug can never be colonized by a later
// draft.
// ---------------------------------------------------------------------------

const SLUG_MAX_LENGTH = 80;

/**
 * Loaded on first use rather than at module scope.
 *
 * `transliteration` carries the CJK transliteration tables — ~186 KiB of source —
 * and this file is reachable from the `@flaremo/domain` barrel, which the
 * Worker entry imports for half a dozen unrelated symbols. Because the barrel
 * re-exports runtime values, every consumer of it pulls this module in, so a
 * top-level import put the tables in every isolate's startup parse path
 * (issue #138) for a function that only runs when someone publishes an article.
 *
 * Breaking the barrel instead is the larger fix and the better one long term,
 * but it reaches every route module; deferring the leaf is contained and
 * verifiable. esbuild compiles `import()` to a lazy `__esm` block, so the
 * module genuinely does not execute until this function is called.
 */
async function baseSlugFromTitle(title: string): Promise<string> {
  const { slugify } = await import("transliteration");
  return slugify(title)
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/^-+|-+$/g, "");
}

function randomSlugSuffix() {
  return createToken(4); // 8 hex chars
}

async function slugExists(
  db: FlareMoDb,
  slug: string,
  ownSlug?: string,
): Promise<boolean> {
  const filters = [eq(articles.slug, slug)];
  if (ownSlug) filters.push(ne(articles.slug, ownSlug));
  const row = await db
    .select({ id: articles.id })
    .from(articles)
    .where(and(...filters))
    .get();
  return row !== undefined;
}

/**
 * Resolves the final slug for a new/updated article. A caller-provided slug
 * (publish dialog) must be free or the request fails; the auto-generated
 * path retries with fresh random suffixes instead. `ownSlug` is excluded
 * from the collision check — an article re-resolving its own slug (publish,
 * title rename) must keep it.
 */
export async function resolveArticleSlug(
  db: FlareMoDb,
  title: string,
  requested?: string,
  ownSlug?: string,
): Promise<string> {
  if (requested) {
    if (await slugExists(db, requested, ownSlug)) {
      throw new ConflictError(`Article slug already taken: ${requested}`);
    }
    return requested;
  }
  const base = await baseSlugFromTitle(title);
  if (!base) return ownSlug ?? `article-${randomSlugSuffix()}`;
  if (!(await slugExists(db, base, ownSlug))) return base;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `${base.slice(0, SLUG_MAX_LENGTH - 9)}-${randomSlugSuffix()}`;
    if (!(await slugExists(db, candidate, ownSlug))) return candidate;
  }
  throw new ConflictError("Could not allocate a unique article slug.");
}

// ---------------------------------------------------------------------------
// Ownership / permission
// ---------------------------------------------------------------------------

/**
 * Resolve one of the caller's articles. First-release articles are personal
 * (teamId reserved for P2), so ownership is a plain user match — the same
 * contract requireProject uses. Live reads exclude recycle-bin rows.
 */
export async function requireArticle(
  db: FlareMoDb,
  user: UserRow,
  id: string,
  options: { includeDeleted?: boolean } = {},
): Promise<ArticleRow> {
  const filters = [eq(articles.id, id), eq(articles.userId, user.id)];
  if (!options.includeDeleted) filters.push(isNull(articles.deletedAt));
  const row = await db
    .select()
    .from(articles)
    .where(and(...filters))
    .get();
  if (!row) throw new NotFoundError(`Article not found: ${id}`);
  return row;
}

// ---------------------------------------------------------------------------
// Create / read / update
// ---------------------------------------------------------------------------

export async function createArticle(
  db: FlareMoDb,
  user: UserRow,
  input: CreateArticleInput,
): Promise<ArticleDto> {
  const title = (input.title ?? "").trim().slice(0, 200);
  const content = input.content ?? "";
  const now = new Date().toISOString();
  const attachmentIds = (input.attachment_names ?? []).map((name) =>
    parseResourceName(name, "attachments"),
  );
  // The claim preflight runs before the insert so a bad id cannot leave a
  // half-created article behind (same checks bindMemoAttachments applies).
  if (attachmentIds.length > 0) {
    const claimable = await db
      .select({ id: attachments.id })
      .from(attachments)
      .where(
        and(
          eq(attachments.userId, user.id),
          inArray(attachments.id, attachmentIds),
          isNull(attachments.deletedAt),
          eq(attachments.state, "ready"),
        ),
      );
    const claimableIds = new Set(claimable.map((row) => row.id));
    const missing = attachmentIds.find((id) => !claimableIds.has(id));
    if (missing) {
      throw new NotFoundError(`Attachment not found: ${missing}`);
    }
  }
  const slug = await resolveArticleSlug(db, title);
  const row = await db
    .insert(articles)
    .values({
      id: createResourceId("articles"),
      userId: user.id,
      slug,
      title,
      description: input.description?.trim() || null,
      content,
      status: "draft",
      lang: input.lang?.trim() || null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  if (attachmentIds.length > 0) {
    await db
      .update(attachments)
      .set({ articleId: row.id, updatedAt: now })
      .where(
        and(
          eq(attachments.userId, user.id),
          inArray(attachments.id, attachmentIds),
        ),
      );
  }
  return articleToDto(row);
}

export async function getArticle(
  db: FlareMoDb,
  user: UserRow,
  id: string,
): Promise<ArticleDto> {
  return articleToDto(await requireArticle(db, user, id));
}

export async function updateArticle(
  db: FlareMoDb,
  user: UserRow,
  id: string,
  input: UpdateArticleInput,
): Promise<ArticleDto> {
  const article = await requireArticle(db, user, id);
  const now = new Date().toISOString();
  const patch: Partial<ArticleRow> = { updatedAt: now };
  if (input.title !== undefined) patch.title = input.title.trim().slice(0, 200);
  if (input.description !== undefined) {
    patch.description = input.description?.trim() || null;
  }
  if (input.content !== undefined) patch.content = input.content;
  if (input.cover_attachment_id !== undefined) {
    const coverId = input.cover_attachment_id
      ? parseResourceName(input.cover_attachment_id, "attachments")
      : null;
    if (coverId) {
      // The cover drives og:image on the public page, so it must be an
      // attachment actually bound to this article — a foreign or unrelated
      // id would only ever render as a dead URL.
      const cover = await db.query.attachments.findFirst({
        where: and(
          eq(attachments.id, coverId),
          eq(attachments.articleId, article.id),
          isNull(attachments.deletedAt),
          eq(attachments.state, "ready"),
        ),
      });
      if (!cover) {
        throw new ValidationError(
          "Cover attachment must be a ready attachment bound to this article.",
        );
      }
    }
    patch.coverAttachmentId = coverId;
  }
  if (input.lang !== undefined) patch.lang = input.lang?.trim() || null;
  // Live articles carry the slug they will publish under. A never-published
  // draft may still re-derive a nicer slug from its (possibly renamed) title;
  // once the article has been published the slug is frozen — including across
  // an unpublish/republish cycle, where a canonical change would be an SEO
  // incident (publishedAt survives unpublish, so it is the right key here).
  if (article.status === "draft" && !article.publishedAt) {
    const nextTitle = patch.title ?? article.title;
    const desired = await resolveArticleSlug(
      db,
      nextTitle,
      undefined,
      article.slug,
    );
    if (desired !== article.slug) {
      patch.slug = desired;
    }
  }
  const row = await db
    .update(articles)
    .set(patch)
    .where(eq(articles.id, article.id))
    .returning()
    .get();
  return articleToDto(row);
}

export async function listArticles(
  db: FlareMoDb,
  user: UserRow,
  input: { status?: ArticleRow["status"]; includeDeleted?: boolean } = {},
): Promise<ArticleSummaryDto[]> {
  const filters = [eq(articles.userId, user.id)];
  if (!input.includeDeleted) filters.push(isNull(articles.deletedAt));
  if (input.status) filters.push(eq(articles.status, input.status));
  // Summary rows never carry `content`, but `select()` read it anyway — up to
  // 200 KB per article, then discarded by articleToSummaryDto. Naming the
  // columns keeps the list endpoint proportional to metadata size.
  const rows = await db
    .select({
      id: articles.id,
      userId: articles.userId,
      slug: articles.slug,
      title: articles.title,
      description: articles.description,
      status: articles.status,
      coverAttachmentId: articles.coverAttachmentId,
      lang: articles.lang,
      publishedAt: articles.publishedAt,
      deletedAt: articles.deletedAt,
      createdAt: articles.createdAt,
      updatedAt: articles.updatedAt,
    })
    .from(articles)
    .where(and(...filters))
    .orderBy(desc(articles.updatedAt), desc(articles.id));
  return rows.map((row) => ({
    id: row.id,
    user_id: row.userId,
    slug: row.slug,
    title: row.title,
    description: row.description,
    status: row.status,
    cover_attachment_id: row.coverAttachmentId,
    lang: row.lang,
    published_at: row.publishedAt,
    deleted_at: row.deletedAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }));
}

// ---------------------------------------------------------------------------
// Publish / unpublish
// ---------------------------------------------------------------------------

export async function publishArticle(
  db: FlareMoDb,
  user: UserRow,
  id: string,
  input: PublishArticleInput = {},
): Promise<ArticleDto> {
  const article = await requireArticle(db, user, id);
  if (!article.title.trim()) {
    throw new ValidationError("Article title is required to publish.");
  }
  if (!article.content.trim()) {
    throw new ValidationError("Article content is required to publish.");
  }
  // A requested slug renames the article's URL one time, at the publish
  // boundary; after the first publish the slug is frozen. The article's own
  // current slug is excluded from the collision check, so re-submitting the
  // dialog with the slug the draft already carries is a no-op rather than a
  // conflict. Requesting a *different* slug for a previously published piece
  // is refused loudly — silently publishing under the old slug would hide the
  // author's intent.
  if (article.publishedAt && input.slug && input.slug !== article.slug) {
    throw new ValidationError(
      "The slug of a published article is frozen and cannot be changed.",
    );
  }
  const slug = article.publishedAt
    ? article.slug
    : await resolveArticleSlug(
        db,
        article.title,
        input.slug ?? undefined,
        article.slug,
      );
  const now = new Date().toISOString();
  const row = await db
    .update(articles)
    .set({
      status: "published",
      slug,
      publishedAt: article.publishedAt ?? now,
      updatedAt: now,
    })
    .where(eq(articles.id, article.id))
    .returning()
    .get();
  return articleToDto(row);
}

export async function unpublishArticle(
  db: FlareMoDb,
  user: UserRow,
  id: string,
): Promise<ArticleDto> {
  const article = await requireArticle(db, user, id);
  const now = new Date().toISOString();
  const row = await db
    .update(articles)
    .set({ status: "draft", updatedAt: now })
    .where(eq(articles.id, article.id))
    .returning()
    .get();
  return articleToDto(row);
}

// ---------------------------------------------------------------------------
// Recycle bin
// ---------------------------------------------------------------------------

export async function deleteArticle(
  db: FlareMoDb,
  user: UserRow,
  id: string,
): Promise<ArticleDto> {
  const article = await requireArticle(db, user, id);
  const now = new Date().toISOString();
  const row = await db
    .update(articles)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(articles.id, article.id))
    .returning()
    .get();
  return articleToDto(row);
}

export async function restoreArticle(
  db: FlareMoDb,
  user: UserRow,
  id: string,
): Promise<ArticleDto> {
  const article = await requireArticle(db, user, id, { includeDeleted: true });
  if (!article.deletedAt) return articleToDto(article);
  const now = new Date().toISOString();
  const row = await db
    .update(articles)
    .set({ deletedAt: null, updatedAt: now })
    .where(eq(articles.id, article.id))
    .returning()
    .get();
  return articleToDto(row);
}

/**
 * Hard-delete one article row. Attachments are the caller's concern (the
 * worker's purge path marks them deleting and clears the R2 binaries first,
 * mirroring the memo hard-delete flow).
 */
export async function purgeArticleRow(
  db: FlareMoDb,
  id: string,
): Promise<void> {
  // SQLite cannot attach ON DELETE SET NULL to a column added with ALTER
  // TABLE (migration 0029), so this FK is NO ACTION in every deployed
  // database. Clear the bindings before dropping the row, or the delete
  // trips the constraint whenever the article still has attachments. The
  // rows themselves stay behind for the daily GC (state = 'deleting').
  await db
    .update(attachments)
    .set({ articleId: null, updatedAt: new Date().toISOString() })
    .where(eq(attachments.articleId, id));
  await db.delete(articles).where(eq(articles.id, id));
}

/**
 * Recycle-bin TTL sweep candidates: soft-deleted articles past the retention
 * cutoff, regardless of their last status (published articles can be deleted
 * too).
 */
export async function listExpiredTrashedArticles(
  db: FlareMoDb,
  cutoff: string,
  limit = 200,
) {
  return db
    .select({ id: articles.id, userId: articles.userId })
    .from(articles)
    .where(and(isNotNull(articles.deletedAt), lt(articles.deletedAt, cutoff)))
    .limit(limit);
}

/**
 * Marks every article-bound attachment `deleting` so the daily GC drains the
 * R2 binaries; called by the worker right before a hard purge.
 */
export async function markArticleAttachmentsDeleting(
  db: FlareMoDb,
  user: UserRow,
  articleId: string,
) {
  const rows = await db
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.articleId, articleId),
        eq(attachments.userId, user.id),
      ),
    );
  if (rows.length === 0) return rows.filter((row) => row.state !== "missing");
  const now = new Date().toISOString();
  await db
    .update(attachments)
    .set({ state: "deleting", updatedAt: now })
    .where(
      and(
        eq(attachments.articleId, articleId),
        eq(attachments.userId, user.id),
      ),
    );
  return rows.filter((row) => row.state !== "missing");
}

// ---------------------------------------------------------------------------
// Public (anonymous) reads — the SSR article page contract
// ---------------------------------------------------------------------------

export type PublicArticle = Awaited<ReturnType<typeof getPublicArticleBySlug>>;

/**
 * Anonymous read for the published SSR page: published, not deleted. Returns
 * the article-bound attachments so the renderer can resolve image
 * dimensions, mirrors getPublicShareByToken.
 */
export async function getPublicArticleBySlug(db: FlareMoDb, slug: string) {
  const article = await db.query.articles.findFirst({
    where: and(
      eq(articles.slug, slug),
      eq(articles.status, "published"),
      isNull(articles.deletedAt),
    ),
  });
  if (!article) throw new NotFoundError("Article not found");

  const [user, attachmentRows] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, article.userId) }),
    db
      .select()
      .from(attachments)
      .where(
        and(
          eq(attachments.articleId, article.id),
          isNull(attachments.deletedAt),
          eq(attachments.state, "ready"),
        ),
      ),
  ]);
  if (!user) throw new NotFoundError("Article not found");
  return { article, user, attachments: attachmentRows };
}

/**
 * Anonymous attachment read for the public blob route. Binding to the
 * published article is the access check — nothing else is exposed.
 */
export async function getPublicArticleAttachment(
  db: FlareMoDb,
  slug: string,
  attachmentId: string,
) {
  const { article } = await getPublicArticleBySlug(db, slug);
  const normalized = parseResourceName(attachmentId, "attachments");
  const attachment = await db.query.attachments.findFirst({
    where: and(
      eq(attachments.id, normalized),
      eq(attachments.articleId, article.id),
      isNull(attachments.deletedAt),
      eq(attachments.state, "ready"),
    ),
  });
  if (!attachment) throw new NotFoundError("Attachment not found");
  return { article, attachment };
}

/** Published, not deleted: the one visibility rule shared by page/sitemap/feed. */
function publishedArticlesFilter() {
  return and(
    eq(articles.status, "published"),
    isNull(articles.deletedAt),
    isNotNull(articles.publishedAt),
  );
}

/**
 * Enumerable article surface for the sitemap. Route code used to hand-write
 * the published filter, which meant a future visibility change had to be
 * mirrored in three places.
 */
export async function listPublishedArticlesForSitemap(
  db: FlareMoDb,
  limit = 2000,
) {
  return db
    .select({ slug: articles.slug, updatedAt: articles.updatedAt })
    .from(articles)
    .where(publishedArticlesFilter())
    .orderBy(desc(articles.publishedAt))
    .limit(limit);
}

/** Published articles with their author name, for the RSS feed. */
export async function listPublishedArticlesForFeed(
  db: FlareMoDb,
  limit: number,
) {
  return db
    .select({ article: articles, authorName: users.name })
    .from(articles)
    .innerJoin(users, eq(articles.userId, users.id))
    .where(publishedArticlesFilter())
    .orderBy(desc(articles.publishedAt))
    .limit(limit);
}
