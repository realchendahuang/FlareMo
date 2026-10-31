import type {
  MemoryForgetReason,
  ResolveProposalInput,
} from "@flaremo/contracts";
import type { FlareMoDb, MemoryItemRow, UserRow } from "@flaremo/db";
import {
  memoryCompileArchives,
  memoryEvents,
  memoryEvidence,
  memoryItems,
  memoryRejections,
  memoryRelations,
  memoryResourceLinks,
  memoryRevisions,
} from "@flaremo/db";
import { and, eq, ne, or, sql } from "drizzle-orm";
import { insertEmbeddingTask } from "../embedding-outbox";
import { ConflictError, ForbiddenError, ValidationError } from "../errors";
import { createResourceId } from "../ids";
import { memoryToDto } from "./dto";
import {
  appendMemoryEvent,
  appendRevision,
  assertAgentCanMutate,
  assertMemoryContentLength,
  assertNoSecrets,
  computeFingerprint,
  type MemoryActor,
  normalizeMemoryContent,
  requireMemory,
} from "./shared";

export type ForgetMemoryInput = {
  reason: MemoryForgetReason;
};

/**
 * A uniqueness violation on the fact-key slot is the storage layer reporting a
 * lost race between the clash check and the write; translate it into a
 * caller-usable conflict instead of leaking raw SQLite text (same contract
 * write.ts upholds for create/update).
 */
function throwFactKeyConflict(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("memory_items_user_fact_key_active_idx")) {
    throw new ConflictError(
      "Another active memory already exists with this fact key.",
    );
  }
  throw error;
}

/**
 * The single definition of promoting a proposal into the fact-key slot.
 *
 * An inferred proposal never occupies the key (the partial unique index
 * excludes it), so the first human affirmation that makes it confirmed or
 * locked must retire the previously active version *in the same
 * transaction* — confirming alone would collide with
 * `memory_items_user_fact_key_active_idx` and surface a raw SQLite error.
 * Mirrors the matrix in write.ts createMemory (§VI.4).
 */
async function retireActiveFactForKey(
  db: FlareMoDb,
  user: UserRow,
  factKey: string,
  successorId: string,
  successorValidFrom: string | null,
  now: string,
) {
  // Only the non-inferred holder occupies the key slot (the partial unique
  // index excludes proposals) — a pending proposal must not be "retired"
  // here, which would remove it from the review inbox without a ruling.
  const activeConflict = await db
    .select()
    .from(memoryItems)
    .where(
      and(
        eq(memoryItems.userId, user.id),
        eq(memoryItems.factKey, factKey),
        eq(memoryItems.status, "active"),
        ne(memoryItems.verification, "inferred"),
        sql`${memoryItems.id} != ${successorId}`,
      ),
    )
    .get();
  if (!activeConflict) return null;

  await appendRevision(db, user, activeConflict, "user");
  const validTo = successorValidFrom ?? now;
  const retireStatement = db
    .update(memoryItems)
    .set({
      status: "superseded" as const,
      supersededById: successorId,
      supersededAt: now,
      validTo,
      updatedAt: now,
    })
    .where(eq(memoryItems.id, activeConflict.id));

  return {
    retireStatement,
    activeConflict,
    // A successor dated in the future leaves the retired version legitimately
    // effective until that date: its vector must stay searchable until then,
    // and the daily maintenance sweep reclaims it afterwards (§VI.4, §九.18).
    dropVector: validTo <= now,
  };
}

async function setVerification(
  db: FlareMoDb,
  user: UserRow,
  actor: MemoryActor,
  id: string,
  verification: MemoryItemRow["verification"],
  reason?: string,
) {
  if (actor.type !== "user") {
    throw new ForbiddenError(
      "Only the user may change a memory's verification.",
    );
  }
  const existing = await requireMemory(db, user, id);
  await appendRevision(db, user, existing, "user");
  const now = new Date().toISOString();

  // Confirming never demotes an iron rule: a locked memory that re-entered
  // review (its evidence changed) is affirmed as still locked. Only an explicit
  // unlock may lower it.
  const nextVerification =
    verification === "confirmed" && existing.verification === "locked"
      ? "locked"
      : verification;

  const wasInferred = existing.verification === "inferred";
  const becomesHuman =
    verification === "confirmed" || verification === "locked";

  let retired: Awaited<ReturnType<typeof retireActiveFactForKey>> = null;
  const _supersededEvent: Promise<unknown> = Promise.resolve();
  if (wasInferred && becomesHuman && existing.factKey) {
    retired = await retireActiveFactForKey(
      db,
      user,
      existing.factKey,
      id,
      existing.validFrom,
      now,
    );
  }

  const confirmStatement = db
    .update(memoryItems)
    .set({
      verification: nextVerification,
      // An iron rule is also first in line at bootstrap; tier follows lock.
      ...(nextVerification === "locked" ? { tier: "core" as const } : {}),
      needsReview: false,
      reviewReason: reason ?? null,
      updatedAt: now,
    })
    .where(and(eq(memoryItems.id, id), eq(memoryItems.userId, user.id)));

  // Retirement and promotion are one unit of work: a crash between them must
  // not leave the key with two live versions or with none.
  try {
    if (retired) {
      await db.batch([retired.retireStatement, confirmStatement]);
    } else {
      await db.batch([confirmStatement]);
    }
  } catch (error) {
    throwFactKeyConflict(error);
  }
  if (retired) {
    if (retired.dropVector) {
      await insertEmbeddingTask(db, {
        userId: user.id,
        resourceType: "memory",
        resourceId: retired.activeConflict.id,
        operation: "delete",
        createdAt: now,
      });
    }
    await appendMemoryEvent(
      db,
      user.id,
      retired.activeConflict.id,
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
      relatedMemoryId: retired.activeConflict.id,
      type: "supersedes",
      createdAt: now,
    });
  }

  // Inferred proposals never enter the vector index at creation; the first
  // human affirmation is what makes their vector exist. Without this, a
  // confirmed proposal stays invisible to semantic recall forever.
  if (wasInferred && becomesHuman) {
    await insertEmbeddingTask(db, {
      userId: user.id,
      resourceType: "memory",
      resourceId: id,
      operation: "index",
      createdAt: now,
    });
  }

  await appendMemoryEvent(
    db,
    user.id,
    id,
    verification === "locked" ? "locked" : "confirmed",
    "user",
    null,
  );

  return memoryToDto(await requireMemory(db, user, id));
}

export function confirmMemory(
  db: FlareMoDb,
  user: UserRow,
  actor: MemoryActor,
  id: string,
) {
  return setVerification(db, user, actor, id, "confirmed");
}

export function lockMemory(
  db: FlareMoDb,
  user: UserRow,
  actor: MemoryActor,
  id: string,
) {
  return setVerification(db, user, actor, id, "locked");
}

export function pinMemory(
  db: FlareMoDb,
  user: UserRow,
  actor: MemoryActor,
  id: string,
) {
  return lockMemory(db, user, actor, id);
}

export async function unlockMemory(
  db: FlareMoDb,
  user: UserRow,
  actor: MemoryActor,
  id: string,
) {
  if (actor.type !== "user") {
    throw new ForbiddenError("Only the user may unpin a memory.");
  }
  const existing = await requireMemory(db, user, id);
  // Only an iron rule can be unpinned. Unlocking anything else used to
  // promote it straight to confirmed, which turned a pending proposal live
  // without retiring the fact it wanted to replace.
  if (existing.verification !== "locked") {
    return memoryToDto(existing);
  }
  await appendRevision(db, user, existing, "user");
  const now = new Date().toISOString();
  await db
    .update(memoryItems)
    .set({
      verification: "confirmed",
      tier: "normal",
      updatedAt: now,
    })
    .where(and(eq(memoryItems.id, id), eq(memoryItems.userId, user.id)));

  await appendMemoryEvent(db, user.id, id, "unlocked", "user", null);
  return memoryToDto(await requireMemory(db, user, id));
}

export function unpinMemory(
  db: FlareMoDb,
  user: UserRow,
  actor: MemoryActor,
  id: string,
) {
  return unlockMemory(db, user, actor, id);
}

export async function archiveMemory(
  db: FlareMoDb,
  user: UserRow,
  actor: MemoryActor,
  id: string,
) {
  if (actor.type !== "user") {
    throw new ForbiddenError("Only the user may archive a memory.");
  }
  const existing = await requireMemory(db, user, id);
  await appendRevision(db, user, existing, "user");
  const now = new Date().toISOString();
  // Archival does NOT mutate valid_from or valid_to (§VI.5)
  await db
    .update(memoryItems)
    .set({
      status: "archived",
      needsReview: false,
      reviewReason: null,
      updatedAt: now,
    })
    .where(and(eq(memoryItems.id, id), eq(memoryItems.userId, user.id)));

  await appendMemoryEvent(db, user.id, id, "archived", "user", null);

  await insertEmbeddingTask(db, {
    userId: user.id,
    resourceType: "memory",
    resourceId: id,
    operation: "delete",
    createdAt: now,
  });

  return memoryToDto(await requireMemory(db, user, id));
}

export async function restoreMemory(
  db: FlareMoDb,
  user: UserRow,
  actor: MemoryActor,
  id: string,
) {
  if (actor.type !== "user") {
    throw new ForbiddenError("Only the user may restore a memory.");
  }
  const existing = await requireMemory(db, user, id);
  if (existing.status !== "archived") {
    return memoryToDto(existing);
  }

  // Double-active check (§IV.3): If item has fact_key, ensure no active conflict exists.
  // Only a restored non-inferred row can collide, and only with a non-inferred
  // holder — pending proposals share the key freely under the partial index.
  if (existing.factKey && existing.verification !== "inferred") {
    const activeConflict = await db
      .select()
      .from(memoryItems)
      .where(
        and(
          eq(memoryItems.userId, user.id),
          eq(memoryItems.factKey, existing.factKey),
          eq(memoryItems.status, "active"),
          ne(memoryItems.verification, "inferred"),
          sql`${memoryItems.id} != ${id}`,
        ),
      )
      .get();
    if (activeConflict) {
      throw new ConflictError(
        "Cannot restore: another memory with the same fact key is currently active.",
      );
    }
  }

  const now = new Date().toISOString();
  await appendRevision(db, user, existing, "user");
  // A restored conjecture goes back to the review inbox rather than sitting
  // active-but-unreviewable: rejected/untouched proposals must stay awaiting
  // a human decision until someone confirms them.
  const restoredNeedsReview = existing.verification === "inferred";
  try {
    await db
      .update(memoryItems)
      .set({
        status: "active",
        needsReview: restoredNeedsReview,
        reviewReason: restoredNeedsReview ? "inferred" : null,
        updatedAt: now,
      })
      .where(and(eq(memoryItems.id, id), eq(memoryItems.userId, user.id)));
  } catch (error) {
    throwFactKeyConflict(error);
  }

  await appendMemoryEvent(db, user.id, id, "restored", "user", null);

  await insertEmbeddingTask(db, {
    userId: user.id,
    resourceType: "memory",
    resourceId: id,
    operation: "index",
    createdAt: now,
  });

  return memoryToDto(await requireMemory(db, user, id));
}

export async function hardDeleteMemory(
  db: FlareMoDb,
  user: UserRow,
  actor: MemoryActor,
  id: string,
) {
  if (actor.type !== "user") {
    throw new ForbiddenError("Only the user may hard-delete a memory.");
  }
  const existing = await requireMemory(db, user, id);

  // Cascade deletions (§VI.9): evidence, revisions, events, relations, links.
  // Negative-sample rows carry the rejected text verbatim, so erasure must
  // sweep them too — "任何可查询面不得残留正文" (§VI.3 invariant 6).
  await db.delete(memoryEvidence).where(eq(memoryEvidence.memoryId, id));
  await db.delete(memoryEvents).where(eq(memoryEvents.memoryId, id));
  await db.delete(memoryRevisions).where(eq(memoryRevisions.memoryId, id));
  await db
    .delete(memoryResourceLinks)
    .where(eq(memoryResourceLinks.memoryId, id));
  await db
    .delete(memoryRelations)
    .where(
      or(
        eq(memoryRelations.memoryId, id),
        eq(memoryRelations.relatedMemoryId, id),
      ),
    );
  if (existing.fingerprint) {
    await db
      .delete(memoryRejections)
      .where(
        and(
          eq(memoryRejections.userId, user.id),
          eq(memoryRejections.fingerprint, existing.fingerprint),
        ),
      );
  }

  // Injection archives must not leak erased content either: payloads that
  // carried this item keep their structure but the text becomes an "[erased]"
  // placeholder (§VI.9 — the archive still shows *that something was injected*,
  // not what).
  const archives = await db
    .select()
    .from(memoryCompileArchives)
    .where(eq(memoryCompileArchives.userId, user.id));
  for (const archive of archives) {
    if (!archive.payload.includes(existing.content)) continue;
    const scrubbed = archive.payload
      .split(existing.content)
      .join("[已抹除 / erased]");
    await db
      .update(memoryCompileArchives)
      .set({ payload: scrubbed })
      .where(eq(memoryCompileArchives.id, archive.id));
  }

  await db
    .delete(memoryItems)
    .where(and(eq(memoryItems.id, id), eq(memoryItems.userId, user.id)));

  await insertEmbeddingTask(db, {
    userId: user.id,
    resourceType: "memory",
    resourceId: id,
    operation: "delete",
    createdAt: new Date().toISOString(),
  });

  return { ok: true };
}

export async function forgetMemory(
  db: FlareMoDb,
  user: UserRow,
  actor: MemoryActor,
  id: string,
  input: ForgetMemoryInput,
) {
  const existing = await requireMemory(db, user, id);
  assertAgentCanMutate(actor, existing);
  const now = new Date().toISOString();
  await appendRevision(
    db,
    user,
    existing,
    actor.type === "user" ? "user" : "agent",
    actor.type === "agent" ? actor.name : null,
  );
  const status: MemoryItemRow["status"] =
    input.reason === "superseded" ? "superseded" : "archived";
  await db
    .update(memoryItems)
    .set({ status, updatedAt: now })
    .where(and(eq(memoryItems.id, id), eq(memoryItems.userId, user.id)));

  await appendMemoryEvent(
    db,
    user.id,
    id,
    status === "superseded" ? "superseded" : "archived",
    actor.type,
    actor.type === "agent" ? actor.name : null,
  );

  await insertEmbeddingTask(db, {
    userId: user.id,
    resourceType: "memory",
    resourceId: existing.id,
    operation: "delete",
    createdAt: now,
  });
  return memoryToDto(await requireMemory(db, user, id));
}

export async function resolveProposal(
  db: FlareMoDb,
  user: UserRow,
  actor: MemoryActor,
  proposalId: string,
  input: ResolveProposalInput,
) {
  if (actor.type !== "user") {
    throw new ForbiddenError("Only the user can resolve proposals.");
  }
  const proposal = await requireMemory(db, user, proposalId);
  const now = new Date().toISOString();

  // The user adjudicates AI assets: anything still awaiting review, plus
  // AI-tier items the user wants to dismiss outright ("this observation is
  // wrong, stop repeating it" — which is also what feeds the negative-feedback
  // guard). A human-owned item is not adjudicable, and a row that was already
  // resolved cannot be resolved again — that is what stops a dismissed card
  // from being resurrected by a second click.
  const adjudicableTier =
    proposal.verification === "observed" ||
    proposal.verification === "inferred";
  const isPending =
    proposal.status === "active" &&
    !proposal.rejectedAt &&
    (proposal.needsReview || adjudicableTier);
  if (!isPending) {
    throw new ConflictError(
      "This proposal has already been resolved and cannot be adjudicated again.",
    );
  }

  if (input.action === "reject") {
    await appendRevision(db, user, proposal, "user");
    // Archival and the negative-sample record are one unit of work: the guard
    // against re-proposing must not depend on the archive step succeeding.
    await db.batch([
      db
        .update(memoryItems)
        .set({
          status: "archived",
          needsReview: false,
          reviewReason: "rejected",
          rejectedAt: now,
          updatedAt: now,
        })
        .where(eq(memoryItems.id, proposalId)),
      db.insert(memoryRejections).values({
        id: createResourceId("memories"),
        userId: user.id,
        scopeType: proposal.scopeType,
        scopeKey: proposal.scopeKey,
        factKey: proposal.factKey,
        rejectedContent: proposal.content,
        fingerprint: proposal.fingerprint,
        reason: input.rejection_reason ?? null,
        createdAt: now,
      }),
    ]);

    await appendMemoryEvent(db, user.id, proposalId, "archived", "user", null, {
      rejection_reason: input.rejection_reason,
    });

    return {
      resolved: true,
      action: "rejected" as const,
      memory: memoryToDto(await requireMemory(db, user, proposalId)),
    };
  }

  // Action is accept or modify
  let content = proposal.content;
  let fingerprint = proposal.fingerprint;
  if (input.action === "modify" && input.modified_content) {
    content = normalizeMemoryContent(input.modified_content);
    if (!content) {
      throw new ValidationError("Memory content cannot be empty.");
    }
    // The modified text is a fresh write: it passes the same gates as every
    // other content path, not only the ones create/update guard.
    assertMemoryContentLength(content);
    assertNoSecrets(content);
    fingerprint = await computeFingerprint(
      user,
      content,
      proposal.type,
      proposal.kind,
      proposal.scopeType,
      proposal.scopeKey,
    );
  }

  // Snapshot the proposal before its content is overwritten by the ruling.
  await appendRevision(db, user, proposal, "user");

  // Supersede previous active fact if proposal has fact_key (§VI.4 matrix).
  // Only the non-inferred holder may be retired — picking a sibling pending
  // proposal would discard it without a ruling and then collide with the real
  // holder's unique index below.
  try {
    if (proposal.factKey) {
      const existingActive = await db
        .select()
        .from(memoryItems)
        .where(
          and(
            eq(memoryItems.userId, user.id),
            eq(memoryItems.factKey, proposal.factKey),
            eq(memoryItems.status, "active"),
            ne(memoryItems.verification, "inferred"),
            sql`${memoryItems.id} != ${proposalId}`,
          ),
        )
        .get();

      if (existingActive) {
        await appendRevision(db, user, existingActive, "user");
        // valid_to = proposal.valid_from
        const newValidFrom = proposal.validFrom ?? now;

        // Retirement of the old version and confirmation of the new one are one
        // transaction: a crash between the two must not leave the key with two
        // live versions (or none). Same contract createMemory already upholds.
        await db.batch([
          db
            .update(memoryItems)
            .set({
              status: "superseded",
              supersededById: proposalId,
              supersededAt: now,
              validTo: newValidFrom,
              updatedAt: now,
            })
            .where(eq(memoryItems.id, existingActive.id)),
          db
            .update(memoryItems)
            .set({
              content,
              fingerprint,
              verification: "confirmed",
              needsReview: false,
              reviewReason: null,
              updatedAt: now,
            })
            .where(eq(memoryItems.id, proposalId)),
        ]);

        await appendMemoryEvent(
          db,
          user.id,
          existingActive.id,
          "superseded",
          "user",
          null,
          { superseded_by_id: proposalId },
        );

        // Link supersedes relation
        await db.insert(memoryRelations).values({
          id: createResourceId("memories"),
          userId: user.id,
          memoryId: proposalId,
          relatedMemoryId: existingActive.id,
          type: "supersedes",
          createdAt: now,
        });

        // The retired version stays searchable until its validity window has
        // actually ended: a future-dated proposal keeps the current rule live
        // until that date (§VI.4, §九.18). The maintenance sweep reclaims the
        // vector once valid_to arrives.
        if (newValidFrom <= now) {
          await insertEmbeddingTask(db, {
            userId: user.id,
            resourceType: "memory",
            resourceId: existingActive.id,
            operation: "delete",
            createdAt: now,
          });
        }
      } else {
        await db
          .update(memoryItems)
          .set({
            content,
            fingerprint,
            verification: "confirmed",
            needsReview: false,
            reviewReason: null,
            updatedAt: now,
          })
          .where(eq(memoryItems.id, proposalId));
      }
    } else {
      // Upgrade proposal to confirmed
      await db
        .update(memoryItems)
        .set({
          content,
          fingerprint,
          verification: "confirmed",
          needsReview: false,
          reviewReason: null,
          updatedAt: now,
        })
        .where(eq(memoryItems.id, proposalId));
    }
  } catch (error) {
    throwFactKeyConflict(error);
  }

  await appendMemoryEvent(db, user.id, proposalId, "confirmed", "user", null);

  // Now index vector since it's confirmed
  await insertEmbeddingTask(db, {
    userId: user.id,
    resourceType: "memory",
    resourceId: proposalId,
    operation: "index",
    createdAt: now,
  });

  return {
    resolved: true,
    action:
      input.action === "modify" ? ("modified" as const) : ("accepted" as const),
    memory: memoryToDto(await requireMemory(db, user, proposalId)),
  };
}

export async function splitMemoryKey(
  db: FlareMoDb,
  user: UserRow,
  actor: MemoryActor,
  id: string,
  newFactKey: string | null,
) {
  if (actor.type !== "user") {
    throw new ForbiddenError("Only the user can split fact keys.");
  }
  const memory = await requireMemory(db, user, id);
  // The clash check mirrors the partial unique index: an inferred proposal
  // holds no slot, and only a non-inferred holder can block a new occupant.
  if (newFactKey && memory.verification !== "inferred") {
    const clash = await db
      .select()
      .from(memoryItems)
      .where(
        and(
          eq(memoryItems.userId, user.id),
          eq(memoryItems.factKey, newFactKey),
          eq(memoryItems.status, "active"),
          ne(memoryItems.verification, "inferred"),
          sql`${memoryItems.id} != ${id}`,
        ),
      )
      .get();
    if (clash) {
      throw new ConflictError(
        "Another memory is already active with that fact key.",
      );
    }
  }

  const now = new Date().toISOString();
  await appendRevision(db, user, memory, "user");
  try {
    await db
      .update(memoryItems)
      .set({
        factKey: newFactKey,
        updatedAt: now,
      })
      .where(eq(memoryItems.id, id));
  } catch (error) {
    throwFactKeyConflict(error);
  }

  return memoryToDto(await requireMemory(db, user, id));
}
