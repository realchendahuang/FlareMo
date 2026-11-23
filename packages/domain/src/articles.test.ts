import type { UserRow } from "@flaremo/db";
import {
  applyFlaremoMigrations,
  articles,
  attachments,
  createDb,
} from "@flaremo/db";
import { eq } from "drizzle-orm";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createArticle,
  deleteArticle,
  getArticle,
  getPublicArticleAttachment,
  getPublicArticleBySlug,
  listArticles,
  listExpiredTrashedArticles,
  markArticleAttachmentsDeleting,
  publishArticle,
  purgeArticleRow,
  restoreArticle,
  unpublishArticle,
  updateArticle,
} from "./articles";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { createFlaremoMember, ensureSingleUser } from "./users";

let mf: Miniflare;
let db: ReturnType<typeof createDb>;
let user: UserRow;
let other: UserRow;

describe("articles domain services", () => {
  beforeEach(async () => {
    mf = new Miniflare({
      script: "export default { fetch() { return new Response('ok') } }",
      modules: true,
      compatibilityDate: "2026-07-10",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: { DB: "flaremo-articles-test" },
    });
    const database = await mf.getD1Database("DB");
    db = createDb(database);
    await applyFlaremoMigrations(database);
    user = await ensureSingleUser(db, {
      email: "owner@example.com",
      name: "Owner",
    });
    other = await createFlaremoMember(db, {
      email: "other@example.com",
      name: "Other",
    });
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("creates a draft with a CJK-pinyin slug derived from the title", async () => {
    const created = await createArticle(db, user, {
      title: "我的第一篇文章",
    });
    expect(created.status).toBe("draft");
    expect(created.slug).toBe("wo-de-di-yi-pian-wen-zhang");
    expect(created.published_at).toBeNull();
    expect(created.title).toBe("我的第一篇文章");
  });

  it("falls back to a random suffix for untransliterable titles", async () => {
    const created = await createArticle(db, user, { title: "" });
    expect(created.slug).toMatch(/^article-[0-9a-f]{8}$/);
  });

  it("keeps slugs unique across rows, drafts included", async () => {
    const first = await createArticle(db, user, { title: "Hello World" });
    expect(first.slug).toBe("hello-world");
    const second = await createArticle(db, user, { title: "Hello World" });
    expect(second.slug).not.toBe("hello-world");
    expect(second.slug.startsWith("hello-world-")).toBe(true);
  });

  it("derives a draft slug from renamed titles, freezes it once published", async () => {
    const created = await createArticle(db, user, {
      title: "Old Title",
      content: "正文",
    });
    expect(created.slug).toBe("old-title");
    const renamed = await updateArticle(db, user, created.id, {
      title: "New Title",
    });
    expect(renamed.slug).toBe("new-title");

    await publishArticle(db, user, created.id);
    const republished = await updateArticle(db, user, created.id, {
      title: "Frozen Title",
    });
    expect(republished.slug).toBe("new-title");
  });

  it("publishes only with title and content, honoring a requested slug", async () => {
    const created = await createArticle(db, user, { title: "T", content: "" });
    await expect(publishArticle(db, user, created.id)).rejects.toBeInstanceOf(
      ValidationError,
    );

    const filled = await updateArticle(db, user, created.id, {
      content: "正文",
    });
    expect(filled.status).toBe("draft");

    const published = await publishArticle(db, user, created.id, {
      slug: "my-custom-slug",
    });
    expect(published.status).toBe("published");
    expect(published.slug).toBe("my-custom-slug");
    expect(published.published_at).not.toBeNull();

    const second = await createArticle(db, user, { title: "S", content: "x" });
    await expect(
      publishArticle(db, user, second.id, { slug: "my-custom-slug" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("keeps the original publishedAt across unpublish/republish", async () => {
    const created = await createArticle(db, user, {
      title: "Cycle",
      content: "c",
    });
    const published = await publishArticle(db, user, created.id);
    const unpublished = await unpublishArticle(db, user, created.id);
    expect(unpublished.status).toBe("draft");
    const republished = await publishArticle(db, user, created.id);
    expect(republished.published_at).toBe(published.published_at);
  });

  it("isolates articles by owner", async () => {
    const created = await createArticle(db, user, { title: "Private" });
    await expect(getArticle(db, other, created.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(getArticle(db, user, created.id)).resolves.toMatchObject({
      title: "Private",
    });
  });

  it("lists summaries without content and filters by status", async () => {
    await createArticle(db, user, { title: "One", content: "body one" });
    await createArticle(db, user, { title: "Two", content: "body two" });
    const all = await listArticles(db, user);
    expect(all).toHaveLength(2);
    expect(all[0]).not.toHaveProperty("content");
    const drafts = await listArticles(db, user, { status: "draft" });
    expect(drafts).toHaveLength(2);
  });

  it("soft-deletes and restores, hiding deleted rows from live reads", async () => {
    const created = await createArticle(db, user, { title: "Trash me" });
    await deleteArticle(db, user, created.id);
    const hidden = await listArticles(db, user);
    expect(hidden).toHaveLength(0);
    const binned = await listArticles(db, user, { includeDeleted: true });
    expect(binned).toHaveLength(1);

    const cutoff = new Date(Date.now() + 1000).toISOString();
    const expired = await listExpiredTrashedArticles(db, cutoff);
    expect(expired).toHaveLength(1);
    expect(expired[0]).toMatchObject({ id: created.id });

    await restoreArticle(db, user, created.id);
    const restored = await listArticles(db, user);
    expect(restored).toHaveLength(1);
    expect(await listExpiredTrashedArticles(db, cutoff)).toHaveLength(0);
  });

  it("purges a purged row completely", async () => {
    const created = await createArticle(db, user, { title: "Gone" });
    await purgeArticleRow(db, created.id);
    const rows = await db
      .select()
      .from(articles)
      .where(eq(articles.id, created.id));
    expect(rows).toHaveLength(0);
  });

  it("claims pre-uploaded attachments when the article is created", async () => {
    // Composer → article: inline images were uploaded before the row existed,
    // so create must bind them in the same request (otherwise the orphan GC
    // collects them within its 7-day window).
    const now = new Date().toISOString();
    await db.insert(attachments).values({
      id: "attachments/att-claim",
      userId: user.id,
      r2Key: "att-claim",
      filename: "draft.png",
      contentType: "image/png",
      size: 10,
      state: "ready",
      createdAt: now,
      updatedAt: now,
    });

    const created = await createArticle(db, user, {
      content: "![draft](/file/attachments/att-claim/draft.png)",
      attachment_names: ["attachments/att-claim"],
    });

    const bound = await db
      .select()
      .from(attachments)
      .where(eq(attachments.id, "attachments/att-claim"));
    expect(bound[0]?.articleId).toBe(created.id);
  });

  it("claims the contract maximum of 100 attachments across D1 chunks", async () => {
    // 100 ids + userId/state predicates exceeds D1's 100 bound parameters in
    // one statement. The preflight and claim UPDATE must chunk independently.
    const now = new Date().toISOString();
    const attachmentIds = Array.from(
      { length: 100 },
      (_, index) => `attachments/max-claim-${index}`,
    );
    const raw = await mf.getD1Database("DB");
    await raw.batch(
      attachmentIds.map((id, index) =>
        raw
          .prepare(
            `INSERT INTO attachments
              (id, user_id, r2_key, filename, content_type, size, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            id,
            user.id,
            `max-claim-${index}`,
            `draft-${index}.png`,
            "image/png",
            10,
            now,
            now,
          ),
      ),
    );

    const created = await createArticle(db, user, {
      title: "Max attachments",
      attachment_names: attachmentIds,
    });
    const bound = await db
      .select()
      .from(attachments)
      .where(eq(attachments.articleId, created.id));
    expect(bound).toHaveLength(100);
    expect(new Set(bound.map((row) => row.id))).toEqual(new Set(attachmentIds));
  });

  it("rejects a foreign or missing attachment claim without creating a row", async () => {
    const now = new Date().toISOString();
    await db.insert(attachments).values({
      id: "attachments/att-other",
      userId: other.id,
      r2Key: "att-other",
      filename: "theirs.png",
      contentType: "image/png",
      size: 10,
      state: "ready",
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      createArticle(db, user, {
        title: "Nope",
        attachment_names: ["attachments/att-other"],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createArticle(db, user, {
        title: "Nope",
        attachment_names: ["attachments/does-not-exist"],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const rows = await db.select().from(articles);
    expect(rows).toHaveLength(0);
  });

  it("purges an article that still has bound attachments (NO ACTION FK)", async () => {
    // SQLite cannot stamp ON DELETE SET NULL on an ALTER TABLE-added column,
    // so migration 0029's FK is NO ACTION in every deployed database. The
    // purge must clear bindings itself or the delete trips the constraint.
    const created = await createArticle(db, user, {
      title: "Bound",
      content: "x",
    });
    const now = new Date().toISOString();
    await db.insert(attachments).values({
      id: "attachments/att-purge",
      userId: user.id,
      articleId: created.id,
      r2Key: "att-purge",
      filename: "a.bin",
      contentType: "application/octet-stream",
      size: 10,
      state: "deleting",
      createdAt: now,
      updatedAt: now,
    });

    await expect(purgeArticleRow(db, created.id)).resolves.toBeUndefined();

    const articleRows = await db
      .select()
      .from(articles)
      .where(eq(articles.id, created.id));
    expect(articleRows).toHaveLength(0);
    // The attachment row survives for the GC drain (its state is the marker),
    // now unbound so the FK no longer points at a missing article.
    const orphan = await db
      .select()
      .from(attachments)
      .where(eq(attachments.id, "attachments/att-purge"));
    expect(orphan).toHaveLength(1);
    expect(orphan[0]?.articleId).toBeNull();
  });

  it("accepts the article's own slug at publish without a conflict", async () => {
    // The publish dialog pre-fills the derived slug; submitting it unchanged
    // must not trip the uniqueness check against the article itself.
    const created = await createArticle(db, user, {
      title: "Self Slug",
      content: "c",
    });
    expect(created.slug).toBe("self-slug");
    const published = await publishArticle(db, user, created.id, {
      slug: created.slug,
    });
    expect(published.slug).toBe("self-slug");
  });

  it("freezes the slug across unpublish, republish, and renames", async () => {
    const created = await createArticle(db, user, {
      title: "Frozen",
      content: "c",
    });
    const published = await publishArticle(db, user, created.id);
    const unpublished = await unpublishArticle(db, user, created.id);
    expect(unpublished.status).toBe("draft");

    // Editing the title while unpublished must not re-derive the slug:
    // publishedAt survived, so the canonical URL is frozen.
    const renamed = await updateArticle(db, user, created.id, {
      title: "Renamed While Draft",
    });
    expect(renamed.slug).toBe(published.slug);
    const republished = await publishArticle(db, user, created.id);
    expect(republished.slug).toBe(published.slug);
  });

  it("validates the cover attachment is bound to the article", async () => {
    const created = await createArticle(db, user, { title: "C" });
    await expect(
      updateArticle(db, user, created.id, {
        cover_attachment_id: "attachments/no-such-cover",
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const now = new Date().toISOString();
    await db.insert(attachments).values({
      id: "attachments/att-cover",
      userId: user.id,
      articleId: created.id,
      r2Key: "att-cover",
      filename: "cover.png",
      contentType: "image/png",
      size: 10,
      state: "ready",
      createdAt: now,
      updatedAt: now,
    });
    const updated = await updateArticle(db, user, created.id, {
      cover_attachment_id: "attachments/att-cover",
    });
    expect(updated.cover_attachment_id).toBe("attachments/att-cover");
    // Clearing it stays legal.
    const cleared = await updateArticle(db, user, created.id, {
      cover_attachment_id: null,
    });
    expect(cleared.cover_attachment_id).toBeNull();
  });

  it("exposes published articles anonymously and hides drafts", async () => {
    const created = await createArticle(db, user, {
      title: "Public",
      content: "body",
    });
    await expect(
      getPublicArticleBySlug(db, created.slug),
    ).rejects.toBeInstanceOf(NotFoundError);
    const published = await publishArticle(db, user, created.id);
    const view = await getPublicArticleBySlug(db, published.slug);
    expect(view.article.id).toBe(created.id);
    expect(view.user.name).toBe("Owner");

    await unpublishArticle(db, user, created.id);
    await expect(
      getPublicArticleBySlug(db, published.slug),
    ).rejects.toBeInstanceOf(NotFoundError);
    const created2 = await createArticle(db, other, {
      title: "Other",
      content: "x",
    });
    expect(created2.user_id).toBe(other.id);
    await deleteArticle(db, user, created.id);
    await expect(
      getPublicArticleBySlug(db, published.slug),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("gates public attachment reads behind the published article", async () => {
    const created = await createArticle(db, user, {
      title: "With image",
      content: "![img](/file/attachments/att-1/photo.png)",
    });
    const now = new Date().toISOString();
    await db.insert(attachments).values({
      id: "attachments/att-1",
      userId: user.id,
      articleId: created.id,
      r2Key: "att-1",
      filename: "photo.png",
      contentType: "image/png",
      size: 10,
      state: "ready",
      createdAt: now,
      updatedAt: now,
    });
    const foreign = await createArticle(db, user, {
      title: "Other article",
      content: "x",
    });

    // Draft article: no public read, even for its own attachment.
    await expect(
      getPublicArticleAttachment(db, created.slug, "attachments/att-1"),
    ).rejects.toBeInstanceOf(NotFoundError);

    await publishArticle(db, user, created.id);
    const bound = await getPublicArticleAttachment(
      db,
      created.slug,
      "attachments/att-1",
    );
    expect(bound.attachment.id).toBe("attachments/att-1");

    // An attachment bound to a different article is not exposed here.
    await expect(
      getPublicArticleAttachment(db, foreign.slug, "attachments/att-1"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("marks article attachments deleting for the GC drain", async () => {
    const created = await createArticle(db, user, {
      title: "Sweep",
      content: "x",
    });
    const now = new Date().toISOString();
    await db.insert(attachments).values({
      id: "attachments/att-2",
      userId: user.id,
      articleId: created.id,
      r2Key: "att-2",
      filename: "a.bin",
      contentType: "application/octet-stream",
      size: 10,
      state: "ready",
      createdAt: now,
      updatedAt: now,
    });
    const marked = await markArticleAttachmentsDeleting(db, user, created.id);
    expect(marked).toHaveLength(1);
    const rows = await db
      .select()
      .from(attachments)
      .where(eq(attachments.id, "attachments/att-2"));
    expect(rows[0]?.state).toBe("deleting");
  });
});
