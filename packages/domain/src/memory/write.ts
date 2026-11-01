import type { UpdateMemoryInput } from "@flaremo/contracts";
import type { FlareMoDb, MemoryItemRow, UserRow } from "@flaremo/db";
import { memoryItems, memoryRelations } from "@flaremo/db";
import { and, eq, ne, sql } from "drizzle-orm";
import { insertEmbeddingTask } from "../embedding-outbox";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { createResourceId } from "../ids";
import { assertMemoryCountQuota, type QuotaScope } from "../quotas";
import { memoryToDto } from "./dto";
import { confirmMemory, lockMemory } from "./lifecycle";
import {
  appendMemoryEvent,
  appendRevision,
  assertAgentCanMutate,
  assertMemoryContentLength,
  assertNoSecrets,
  computeFingerprint,
  insertMemoryEvidence,
  type MemoryActor,
  type MemoryWriteInput,
  normalizeFactKey,
  normalizeMemoryContent,
  requireMemory,
  resolveConfidenceForActor,
  resolveVerificationForActor,
  suggestFactKey,
} from "./shared";

export async function createMemory(
  db: FlareMoDb,
  user: UserRow,
  actor: MemoryActor,
  input: MemoryWriteInput,
  scope?: QuotaScope,
) {
  await assertMemoryCountQuota(db, scope?.userLimits, user.id);
  const content = normalizeMemoryContent(input.content);
  if (!content) throw new ValidationError("Memory content cannot be empty.");
  assertMemoryContentLength(content);
  assertNoSecrets(content);

  // A retried write must return the first result, not create a twin. This check
  // is a fast path only; the partial unique index on (user_id, idempotency_key)
  // is the real boundary and is handled after the insert below.
  if (input.idempotencyKey) {
    const prior = await db
      .select()
      .from(memoryItems)
      .where(
        and(
          eq(memoryItems.userId, user.id),
          eq(memoryItems.idempotencyKey, input.idempotencyKey),
        ),
      )
      .get();
    if (prior) {
      return { duplicate: true as const, memory: memoryToDto(prior) };
    }
  }

  const requestedVerification = resolveVerificationForActor(actor, input);
  const fingerprint = await computeFingerprint(
    user,
    content,
    input.type,
    input.kind,
    input.scopeType,
    input.scopeKey,
  );

  // Dedupe against live facts only. Archived or rejected rows hold stale
  // judgments: re-writing the same content after a rejection must be able to
  // become the active fact again, not bounce off a tombstone.
  const existing = await db
    .select()
    .from(memoryItems)
    .where(
      and(
        eq(memoryItems.userId, user.id),
        eq(memoryItems.fingerprint, fingerprint),
        eq(memoryItems.status, "active"),
      ),
    )
    .get();
  if (existing) {
    // A user re-submitting the same sentence is affirming the pending
    // proposal, not asking for a copy. Returning the inferred row untouched
    // used to swallow the confirmation. Only the user may promote it; agents
    // still receive the plain duplicate.
    if (actor.type === "user" && existing.verification === "inferred") {
      const promoted =
        requestedVerification === "locked"
          ? await lockMemory(db, user, actor, existing.id)
          : await confirmMemory(db, user, actor, existing.id);
      return { duplicate: true as const, memory: promoted };
    }
    return { duplicate: true as const, memory: memoryToDto(existing) };
  }

  const now = new Date().toISOString();
  const validFrom = input.validFrom ?? now;
  const newId = createResourceId("memories");

  // Key governance (§VI.3): caller-supplied keys are normalized so
  // `Project.Database` and `project.database` cannot fork a version chain;
  // absent keys reuse an established same-family key instead of coining one.
  const normalizedKey = input.factKey ? normalizeFactKey(input.factKey) : "";
  const factKey =
    normalizedKey ||
    (await suggestFactKey(db, user, {
      scopeType: input.scopeType,
      scopeKey: input.scopeKey,
      tags: input.tags,
      type: input.type,
    }));

  let targetVerification = requestedVerification;
  let reviewReason: string | null = null;
  let supersededExistingId: string | null = null;

  // Fact key & Supersession Matrix (Design §VI.4)
  if (factKey) {
    // The key slot is defined by the partial unique index: only a non-inferred
    // active row occupies it. Pending proposals under the same key must not be
    // picked here — mistaking one for the holder would auto-supersede it and
    // then collide with the real holder's unique index instead of producing a
    // second proposal.
    const existingFact = await db
      .select()
      .from(memoryItems)
      .where(
        and(
          eq(memoryItems.userId, user.id),
          eq(memoryItems.factKey, factKey),
          eq(memoryItems.status, "active"),
          ne(memoryItems.verification, "inferred"),
        ),
      )
      .get();

    if (existingFact) {
      const isHumanAsset =
        existingFact.verification === "confirmed" ||
        existingFact.verification === "locked";

      if (isHumanAsset && actor.type === "agent") {
        // AI CANNOT auto-supersede human assets (📌/✅).
        // Must degrade into an inferred proposal in review inbox.
        targetVerification = "inferred";
        reviewReason = "supersede_proposal";
      } else {
        // Auto-supersede: Either AI-to-AI or human edit.
        supersededExistingId = existingFact.id;
      }
    }
  }

  const needsReview =
    targetVerification === "inferred" || reviewReason !== null;

  // Retirement of the previous version and insertion of its successor are one
  // unit of work: the partial unique index on (user_id, fact_key) only tolerates
  // one active row, so a crash between the two steps would leave the fact with
  // no live version at all. `db.batch` runs them in a single D1 transaction.
  let oldRowToSupersede: MemoryItemRow | null = null;
  if (supersededExistingId) {
    oldRowToSupersede =
      (await db
        .select()
        .from(memoryItems)
        .where(eq(memoryItems.id, supersededExistingId))
        .get()) ?? null;

    if (oldRowToSupersede) {
      await appendRevision(
        db,
        user,
        oldRowToSupersede,
        actor.type === "user" ? "user" : "agent",
        actor.type === "agent" ? actor.name : null,
      );
    }
  }

  const insertStatement = db.insert(memoryItems).values({
    id: newId,
    userId: user.id,
    content,
    type: input.type,
    kind: input.kind,
    scopeType: input.scopeType,
    scopeKey: input.scopeKey,
    factKey: factKey ?? null,
    tags: input.tags ?? [],
    tier: input.tier,
    verification: targetVerification,
    status: "active",
    importance: input.importance,
    confidence: resolveConfidenceForActor(actor, input),
    needsReview,
    reviewReason: reviewReason ?? (needsReview ? "inferred" : null),
    createdByType: actor.type === "user" ? "user" : "agent",
    sourceAgent: actor.type === "agent" ? actor.name : input.sourceAgent,
    sourceSession: input.sourceSession,
    sourceRef: input.sourceRef,
    validFrom,
    validTo: input.validTo ?? null,
    observedAt: input.observedAt ?? now,
    expiresAt: input.expiresAt ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    fingerprint,
    createdAt: now,
    updatedAt: now,
  });

  // Bi-temporal rule: the old version's valid_to is the new version's
  // valid_from (never "now"), so a backdated successor cannot produce
  // overlapping validity windows (§VI.5).
  const retireStatement = oldRowToSupersede
    ? db
        .update(memoryItems)
        .set({
          status: "superseded" as const,
          supersededById: newId,
          supersededAt: now,
          validTo: validFrom,
          updatedAt: now,
        })
        .where(eq(memoryItems.id, oldRowToSupersede.id))
    : null;

  // `db.batch` gives the transaction; D1 returns per-statement results rather
  // than rows, so the written row is read back by its id afterwards. That second
  // read is what makes the insert statement's own RETURNING unnecessary here.
  try {
    if (retireStatement) {
      await db.batch([retireStatement, insertStatement]);
    } else {
      await db.batch([insertStatement]);
    }
  } catch (error) {
    // Two writers raced on the same fact_key or idempotency key. The indexes are
    // the boundary; translate the storage error into a caller-usable answer
    // instead of leaking a raw SQLite constraint message.
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("memory_items_user_idempotency_idx")) {
      // A retry that raced its own first attempt should still see that first
      // result rather than an error, so honour the idempotency contract here too.
      if (input.idempotencyKey) {
        const winner = await db
          .select()
          .from(memoryItems)
          .where(
            and(
              eq(memoryItems.userId, user.id),
              eq(memoryItems.idempotencyKey, input.idempotencyKey),
            ),
          )
          .get();
        if (winner) {
          return { duplicate: true as const, memory: memoryToDto(winner) };
        }
      }
      throw new ConflictError(
        "This write was already applied under the same idempotency key.",
      );
    }
    if (message.includes("memory_items_user_fact_key_active_idx")) {
      throw new ConflictError(
        "Another active memory already exists with this fact key.",
      );
    }
    throw error;
  }

  const row = await db
    .select()
    .from(memoryItems)
    .where(and(eq(memoryItems.id, newId), eq(memoryItems.userId, user.id)))
    .get();
  if (!row) {
    throw new NotFoundError(`Memory was not persisted: ${newId}`);
  }

  // If superseded existing fact, log events, relations, and cleanup vector
  if (oldRowToSupersede && supersededExistingId) {
    await appendMemoryEvent(
      db,
      user.id,
      supersededExistingId,
      "superseded",
      actor.type,
      actor.type === "agent" ? actor.name : null,
      { superseded_by_id: newId },
    );

    // Link supersedes relation
    await db.insert(memoryRelations).values({
      id: createResourceId("memories"),
      userId: user.id,
      memoryId: newId,
      relatedMemoryId: supersededExistingId,
      type: "supersedes",
      createdAt: now,
    });

    // Drop the retired version's vector only once its validity has actually
    // ended. A successor dated in the future leaves the current version
    // legitimately effective until that date, so its vector must stay
    // searchable; recall's bi-temporal filter is what keeps it out of results
    // after expiry, and the daily maintenance sweep drops it then (§VI.5).
    if (validFrom <= now) {
      await insertEmbeddingTask(db, {
        userId: user.id,
        resourceType: "memory",
        resourceId: supersededExistingId,
        operation: "delete",
        createdAt: now,
      });
    }
  } else if (reviewReason === "supersede_proposal" && factKey) {
    // When proposal is created against human asset, link relation as contradicts/proposed.
    // Same key-slot filter as above: only the non-inferred holder may be the
    // challenged fact (otherwise the proposal could link back to itself).
    const existingFact = await db
      .select()
      .from(memoryItems)
      .where(
        and(
          eq(memoryItems.userId, user.id),
          eq(memoryItems.factKey, factKey),
          eq(memoryItems.status, "active"),
          ne(memoryItems.verification, "inferred"),
        ),
      )
      .get();

    if (existingFact) {
      await db.insert(memoryRelations).values({
        id: createResourceId("memories"),
        userId: user.id,
        memoryId: newId,
        relatedMemoryId: existingFact.id,
        type: "contradicts",
        createdAt: now,
      });

      await appendMemoryEvent(
        db,
        user.id,
        existingFact.id,
        "challenged",
        "agent",
        actor.type === "agent" ? actor.name : null,
        { proposal_id: newId },
      );
    }
  }

  // Insert evidence items if provided
  if (input.evidence && input.evidence.length > 0) {
    for (const ev of input.evidence) {
      await insertMemoryEvidence(db, user.id, row.id, ev);
    }
  }

  // Log creation event
  await appendMemoryEvent(
    db,
    user.id,
    row.id,
    targetVerification === "locked"
      ? "locked"
      : targetVerification === "confirmed"
        ? "confirmed"
        : "created",
    actor.type,
    actor.type === "agent" ? actor.name : null,
    { fact_key: factKey ?? null },
  );

  // Inferred proposals do not enter vector index until confirmed (§VI.8)
  if (targetVerification !== "inferred") {
    await insertEmbeddingTask(db, {
      userId: user.id,
      resourceType: "memory",
      resourceId: row.id,
      operation: "index",
      createdAt: now,
    });
  }

  return { duplicate: false as const, memory: memoryToDto(row) };
}

export async function updateMemory(
  db: FlareMoDb,
  user: UserRow,
  actor: MemoryActor,
  id: string,
  input: UpdateMemoryInput,
) {
  const existing = await requireMemory(db, user, id);
  assertAgentCanMutate(actor, existing);
  if (existing.status === "deleted") {
    throw new NotFoundError(`Memory not found: ${id}`);
  }

  // A user edit is an affirmation: it upgrades observed/inferred to confirmed,
  // while a locked memory stays locked (§IV.2). Computed up front because the
  // fact-key clash check below depends on whether this row will occupy the
  // key slot after the edit.
  const userAffirms =
    actor.type === "user" && existing.verification !== "locked";

  const next = { ...existing };
  if (input.content !== undefined) {
    next.content = normalizeMemoryContent(input.content);
    if (!next.content)
      throw new ValidationError("Memory content cannot be empty.");
    assertMemoryContentLength(next.content);
    assertNoSecrets(next.content);
  }
  if (input.type !== undefined) next.type = input.type;
  if (input.kind !== undefined) next.kind = input.kind;
  if (input.scope_type !== undefined) next.scopeType = input.scope_type;
  if (input.scope_key !== undefined) next.scopeKey = input.scope_key ?? null;
  if (input.tier !== undefined) next.tier = input.tier;
  if (input.importance !== undefined) next.importance = input.importance;

  if (input.fact_key !== undefined) {
    if (input.fact_key !== existing.factKey && input.fact_key !== null) {
      // Keys are stored canonical: an edit to `Project.Database` must land on
      // the same slot as `project.database` (§VI.3 key governance).
      const normalizedKey = normalizeFactKey(input.fact_key) || null;
      input.fact_key = normalizedKey;
      // Check collision. Two subtleties: only a non-inferred active row can
      // hold the slot (pending proposals are outside the unique index), and an
      // inferred row being edited doesn't hold a slot yet — when the edit
      // affirms it, the retirement below supersedes the current holder instead
      // of erroring here.
      const clash =
        normalizedKey && existing.verification !== "inferred"
          ? await db
              .select()
              .from(memoryItems)
              .where(
                and(
                  eq(memoryItems.userId, user.id),
                  eq(memoryItems.factKey, normalizedKey),
                  eq(memoryItems.status, "active"),
                  ne(memoryItems.verification, "inferred"),
                  sql`${memoryItems.id} != ${id}`,
                ),
              )
              .get()
          : undefined;
      if (clash) {
        throw new ConflictError(
          "Another active memory already exists with this fact key.",
        );
      }
    }
    next.factKey = input.fact_key ?? null;
  }
  if (input.tags !== undefined) next.tags = input.tags;
  if (input.valid_from !== undefined) next.validFrom = input.valid_from ?? null;
  if (input.valid_to !== undefined) next.validTo = input.valid_to ?? null;
  if (input.expires_at !== undefined) next.expiresAt = input.expires_at ?? null;

  next.fingerprint = await computeFingerprint(
    user,
    next.content,
    next.type,
    next.kind,
    next.scopeType,
    next.scopeKey,
  );

  const duplicate = await db
    .select()
    .from(memoryItems)
    .where(
      and(
        eq(memoryItems.userId, user.id),
        eq(memoryItems.fingerprint, next.fingerprint),
        sql`${memoryItems.id} != ${id}`,
        sql`${memoryItems.status} != 'deleted'`,
      ),
    )
    .get();
  if (duplicate) {
    throw new ConflictError("This memory already exists.");
  }

  const now = new Date().toISOString();
  if (userAffirms) {
    next.verification = "confirmed";
    next.needsReview = false;
    next.reviewReason = null;
  }

  await appendRevision(
    db,
    user,
    existing,
    actor.type === "user" ? "user" : "agent",
    actor.type === "agent" ? actor.name : null,
  );

  const statements: Array<Parameters<FlareMoDb["batch"]>[0][number]> = [];

  // Promoting an inferred proposal out of the key slot must retire the active
  // version under the same key in the same transaction — otherwise the update
  // collides with memory_items_user_fact_key_active_idx (§VI.4 matrix).
  if (userAffirms && existing.verification === "inferred" && next.factKey) {
    // Only the non-inferred holder may be retired here — picking a pending
    // proposal instead would let it vanish from the review inbox without a
    // human ruling, and the promoted row would then collide with the real
    // holder's unique index.
    const activeConflict = await db
      .select()
      .from(memoryItems)
      .where(
        and(
          eq(memoryItems.userId, user.id),
          eq(memoryItems.factKey, next.factKey),
          eq(memoryItems.status, "active"),
          ne(memoryItems.verification, "inferred"),
          sql`${memoryItems.id} != ${id}`,
        ),
      )
      .get();
    if (activeConflict) {
      await appendRevision(db, user, activeConflict, "user");
      const validTo = next.validFrom ?? activeConflict.validFrom ?? now;
      statements.push(
        db
          .update(memoryItems)
          .set({
            status: "superseded" as const,
            supersededById: id,
            supersededAt: now,
            validTo,
            updatedAt: now,
          })
          .where(eq(memoryItems.id, activeConflict.id)),
      );
    }
  }

  statements.push(
    db
      .update(memoryItems)
      .set({
        content: next.content,
        type: next.type,
        kind: next.kind,
        scopeType: next.scopeType,
        scopeKey: next.scopeKey,
        factKey: next.factKey,
        tags: next.tags,
        tier: next.tier,
        verification: next.verification,
        importance: next.importance,
        needsReview: next.needsReview,
        reviewReason: next.reviewReason,
        validFrom: next.validFrom,
        validTo: next.validTo,
        expiresAt: next.expiresAt,
        fingerprint: next.fingerprint,
        updatedAt: now,
      })
      .where(and(eq(memoryItems.id, id), eq(memoryItems.userId, user.id))),
  );

  try {
    await db.batch(statements as never);
  } catch (error) {
    // A concurrent writer may have claimed the same active fact key between
    // the clash check and this write; translate the storage error instead of
    // surfacing raw SQLite text.
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("memory_items_user_fact_key_active_idx")) {
      throw new ConflictError(
        "Another active memory already exists with this fact key.",
      );
    }
    throw error;
  }

  // An edited conjecture's affirmation retires a competing fact: record the
  // chain and drop the retired version's vector once its window has closed.
  if (userAffirms && existing.verification === "inferred" && next.factKey) {
    const retired = await db
      .select()
      .from(memoryItems)
      .where(
        and(
          eq(memoryItems.userId, user.id),
          eq(memoryItems.factKey, next.factKey),
          eq(memoryItems.status, "superseded"),
          eq(memoryItems.supersededById, id),
        ),
      )
      .get();
    if (retired) {
      await appendMemoryEvent(
        db,
        user.id,
        retired.id,
        "superseded",
        "user",
        null,
        {
          superseded_by_id: id,
        },
      );
      await db.insert(memoryRelations).values({
        id: createResourceId("memories"),
        userId: user.id,
        memoryId: id,
        relatedMemoryId: retired.id,
        type: "supersedes",
        createdAt: now,
      });
      if (retired.validTo && retired.validTo <= now) {
        await insertEmbeddingTask(db, {
          userId: user.id,
          resourceType: "memory",
          resourceId: retired.id,
          operation: "delete",
          createdAt: now,
        });
      }
    }
  }

  if (
    actor.type === "user" &&
    existing.verification !== "confirmed" &&
    existing.verification !== "locked"
  ) {
    await appendMemoryEvent(db, user.id, id, "confirmed", "user", null);
  }

  // An inferred proposal has no vector; the edit that affirms it is what
  // makes it enter semantic recall. A content edit already queued a reindex,
  // so only the metadata-only edit path needs the explicit index task.
  if (
    actor.type === "user" &&
    existing.verification === "inferred" &&
    input.content === undefined
  ) {
    await insertEmbeddingTask(db, {
      userId: user.id,
      resourceType: "memory",
      resourceId: existing.id,
      operation: "index",
      createdAt: now,
    });
  }

  if (input.content !== undefined) {
    await insertEmbeddingTask(db, {
      userId: user.id,
      resourceType: "memory",
      resourceId: existing.id,
      operation: "reindex",
      createdAt: now,
    });
  }

  const updated = await requireMemory(db, user, id);
  return memoryToDto(updated);
}
