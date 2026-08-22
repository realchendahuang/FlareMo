import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { UserRow } from "@flaremo/db";
import {
  createDb,
  memoryItems,
  memoryRelations,
  memoryResourceLinks,
  memoryRevisions,
} from "@flaremo/db";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportData, importData } from "./import-export";
import {
  archiveMemory,
  bootstrapMemory,
  checkpointMemory,
  confirmMemory,
  createMemory,
  createMemoryFromMemo,
  forgetMemory,
  hardDeleteMemory,
  linkMemory,
  listMemories,
  listMemoriesForMemo,
  listMemoryReview,
  listMemoryRevisions,
  lockMemory,
  type MemoryActor,
  promoteMemoryToMemo,
  recallMemories,
  unlockMemory,
  updateMemory,
} from "./memory";
import { createMemo } from "./memos";
import { ensureSingleUser } from "./users";

let mf: Miniflare;
let db: ReturnType<typeof createDb>;
let user: UserRow;

const USER: MemoryActor = { type: "user" };
const AGENT: MemoryActor = { type: "agent", name: "codex" };

async function applyMigration(
  database: Awaited<ReturnType<Miniflare["getD1Database"]>>,
  sql: string,
) {
  const statements = sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await database.prepare(statement).run();
  }
}

describe("memory domain services", () => {
  beforeEach(async () => {
    mf = new Miniflare({
      script: "export default { fetch() { return new Response('ok') } }",
      modules: true,
      compatibilityDate: "2026-07-10",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: { DB: "flaremo-memory-test" },
    });
    const database = await mf.getD1Database("DB");
    db = createDb(database);
    const migrationNames = [
      "0000_illegal_inhumans.sql",
      "0001_familiar_morph.sql",
      "0002_wooden_professor_monster.sql",
      "0003_equal_maximus.sql",
      "0004_complex_the_enforcers.sql",
      "0005_confused_masque.sql",
      "0007_flat_phil_sheldon.sql",
      "0008_legal_scarecrow.sql",
      "0009_neat_iron_fist.sql",
      "0010_deep_gateway.sql",
      "0011_daffy_ultron.sql",
    ];
    for (const name of migrationNames) {
      const sql = await readFile(
        resolve(import.meta.dirname, `../../../migrations/${name}`),
        "utf8",
      );
      await applyMigration(database, sql);
    }
    user = await ensureSingleUser(db, {
      email: "owner@example.com",
      name: "Owner",
    });
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("creates a user memory as confirmed and an agent memory as observed", async () => {
    const userCreated = await createMemory(db, user, USER, {
      content: "FlareMo 使用 D1 作为事实源",
      type: "semantic",
      kind: "fact",
      scopeType: "global",
      scopeKey: null,
      tier: "core",
      importance: 90,
      confidence: 100,
    });
    expect(userCreated.duplicate).toBe(false);
    expect(userCreated.memory.verification).toBe("confirmed");
    expect(userCreated.memory.created_by_type).toBe("user");

    const agentCreated = await createMemory(db, user, AGENT, {
      content: "用户默认使用 pnpm",
      type: "semantic",
      kind: "preference",
      scopeType: "global",
      scopeKey: null,
      tier: "normal",
      importance: 60,
      confidence: 70,
    });
    expect(agentCreated.duplicate).toBe(false);
    expect(agentCreated.memory.verification).toBe("observed");
    expect(agentCreated.memory.created_by_type).toBe("agent");
    expect(agentCreated.memory.source_agent).toBe("codex");
  });

  it("rejects exact duplicates and credential material", async () => {
    const first = await createMemory(db, user, AGENT, {
      content: "FlareMo 部署在 Cloudflare Workers",
      type: "semantic",
      kind: "fact",
      scopeType: "global",
      scopeKey: null,
      tier: "normal",
      importance: 50,
      confidence: 50,
    });
    expect(first.duplicate).toBe(false);

    const dup = await createMemory(db, user, AGENT, {
      content: "FlareMo 部署在 Cloudflare Workers",
      type: "semantic",
      kind: "fact",
      scopeType: "global",
      scopeKey: null,
      tier: "normal",
      importance: 50,
      confidence: 50,
    });
    expect(dup.duplicate).toBe(true);
    expect(dup.memory.id).toBe(first.memory.id);

    await expect(
      createMemory(db, user, AGENT, {
        content: "token: memos_pat_abc123",
        type: "semantic",
        kind: "fact",
        scopeType: "global",
        scopeKey: null,
        tier: "normal",
        importance: 50,
        confidence: 50,
      }),
    ).rejects.toThrow(/MEMORY_SECRET_REJECTED/);
  });

  it("forbids agents from locking, and from mutating confirmed or locked memories", async () => {
    const created = await createMemory(db, user, USER, {
      content: "发布前必须执行 pnpm verify",
      type: "procedural",
      kind: "procedure",
      scopeType: "project",
      scopeKey: "github:realchendahuang/FlareMo",
      tier: "core",
      importance: 90,
      confidence: 100,
    });
    const id = created.memory.id;

    await expect(
      createMemory(db, user, AGENT, {
        content: "x",
        type: "semantic",
        kind: "fact",
        scopeType: "global",
        scopeKey: null,
        tier: "normal",
        importance: 50,
        confidence: 50,
        verification: "locked",
      }),
    ).rejects.toThrow(/cannot lock/i);

    await expect(
      updateMemory(db, user, AGENT, id, { content: "agent override" }),
    ).rejects.toThrow(/confirmed/i);

    await lockMemory(db, user, USER, id);
    await expect(
      updateMemory(db, user, AGENT, id, { content: "agent override" }),
    ).rejects.toThrow(/locked/i);
  });

  it("upgrades an agent memory to confirmed on user edit and records revisions", async () => {
    const created = await createMemory(db, user, AGENT, {
      content: "用户似乎偏好 Cloudflare",
      type: "semantic",
      kind: "preference",
      scopeType: "global",
      scopeKey: null,
      tier: "normal",
      importance: 50,
      confidence: 50,
      verification: "inferred",
    });
    expect(created.memory.verification).toBe("inferred");
    expect(created.memory.needs_review).toBe(true);

    const updated = await updateMemory(db, user, USER, created.memory.id, {
      content: "用户明确偏好 Cloudflare",
    });
    expect(updated.verification).toBe("confirmed");
    expect(updated.needs_review).toBe(false);

    const revisions = await listMemoryRevisions(db, user, created.memory.id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.content).toBe("用户似乎偏好 Cloudflare");
  });

  it("scopes recall to global plus the requested project only", async () => {
    await createMemory(db, user, AGENT, {
      content: "全局偏好：使用 TypeScript",
      type: "semantic",
      kind: "preference",
      scopeType: "global",
      scopeKey: null,
      tier: "core",
      importance: 80,
      confidence: 90,
    });
    await createMemory(db, user, AGENT, {
      content: "FlareMo 项目使用 pnpm",
      type: "semantic",
      kind: "fact",
      scopeType: "project",
      scopeKey: "github:realchendahuang/FlareMo",
      tier: "normal",
      importance: 60,
      confidence: 80,
    });
    await createMemory(db, user, AGENT, {
      content: "signal-loom 项目使用 bun",
      type: "semantic",
      kind: "fact",
      scopeType: "project",
      scopeKey: "github:realchendahuang/signal-loom",
      tier: "normal",
      importance: 60,
      confidence: 80,
    });

    const results = await recallMemories(db, user, {
      query: "使用",
      agent: "codex",
      projectKey: "github:realchendahuang/FlareMo",
      limit: 8,
    });
    const contents = results.map((row) => row.content);
    expect(contents).toContain("FlareMo 项目使用 pnpm");
    expect(contents).toContain("全局偏好：使用 TypeScript");
    expect(contents).not.toContain("signal-loom 项目使用 bun");
  });

  it("bootstraps core and confirmed constraints within the char budget", async () => {
    await createMemory(db, user, USER, {
      content: "FlareMo 必须保持 Cloudflare Native",
      type: "semantic",
      kind: "constraint",
      scopeType: "project",
      scopeKey: "github:realchendahuang/FlareMo",
      tier: "core",
      importance: 90,
      confidence: 100,
    });
    await createMemory(db, user, AGENT, {
      content: "某个无关的普通记忆",
      type: "episodic",
      kind: "event",
      scopeType: "global",
      scopeKey: null,
      tier: "normal",
      importance: 30,
      confidence: 30,
    });

    const boot = await bootstrapMemory(db, user, {
      agent: "claude-code",
      projectKey: "github:realchendahuang/FlareMo",
    });
    expect(
      boot.items.some(
        (item) => item.content === "FlareMo 必须保持 Cloudflare Native",
      ),
    ).toBe(true);
    const totalChars = boot.items.reduce(
      (sum, item) => sum + item.content.length,
      0,
    );
    expect(totalChars).toBeLessThanOrEqual(6_000);
  });

  it("checkpoint creates an episode plus atomic items linked together", async () => {
    const result = await checkpointMemory(db, user, AGENT, {
      agent: "codex",
      project_key: "github:realchendahuang/FlareMo",
      scope_type: "project",
      scope_key: "github:realchendahuang/FlareMo",
      summary: "完成 Agent Memory V1 架构设计",
      items: [
        {
          content: "Memory 使用独立 /memory/mcp",
          type: "semantic",
          kind: "decision",
          importance: 80,
        },
        {
          content: "Embedding 不能成为 Memory 硬依赖",
          type: "semantic",
          kind: "constraint",
          importance: 85,
        },
      ],
    });
    expect(result.episode.type).toBe("episodic");
    expect(result.items).toHaveLength(2);

    const listed = await listMemories(db, user, {
      scopeKey: "github:realchendahuang/FlareMo",
    });
    expect(listed).toHaveLength(3);
  });

  it("link supersedes retires the old memory and forget archives without hard delete", async () => {
    const old = await createMemory(db, user, AGENT, {
      content: "FlareMo 考虑使用 Supabase",
      type: "semantic",
      kind: "decision",
      scopeType: "project",
      scopeKey: "github:realchendahuang/FlareMo",
      tier: "normal",
      importance: 50,
      confidence: 50,
    });
    const fresh = await createMemory(db, user, AGENT, {
      content: "FlareMo 最终使用 D1",
      type: "semantic",
      kind: "decision",
      scopeType: "project",
      scopeKey: "github:realchendahuang/FlareMo",
      tier: "normal",
      importance: 80,
      confidence: 90,
    });

    await linkMemory(db, user, AGENT, {
      memoryId: fresh.memory.id,
      relatedMemoryId: old.memory.id,
      relationType: "supersedes",
      resourceRelationType: "references",
    });

    const archived = await forgetMemory(db, user, AGENT, old.memory.id, {
      reason: "superseded",
    });
    expect(archived.status).toBe("superseded");

    const review = await listMemoryReview(db, user);
    expect(review).toHaveLength(0);

    await expect(
      hardDeleteMemory(db, user, AGENT, fresh.memory.id),
    ).rejects.toThrow(/only the user/i);
  });

  it("confirm, lock, unlock, and archive are user-only and idempotent", async () => {
    const created = await createMemory(db, user, AGENT, {
      content: "部署流程 verify → dry-run → deploy",
      type: "procedural",
      kind: "procedure",
      scopeType: "global",
      scopeKey: null,
      tier: "normal",
      importance: 60,
      confidence: 70,
    });
    const id = created.memory.id;

    await expect(confirmMemory(db, user, AGENT, id)).rejects.toThrow(
      /only the user/i,
    );
    await confirmMemory(db, user, USER, id);
    await lockMemory(db, user, USER, id);
    expect(
      (await listMemories(db, user, {})).find((m) => m.id === id)?.verification,
    ).toBe("locked");
    await unlockMemory(db, user, USER, id);
    await archiveMemory(db, user, USER, id);
    expect(await listMemories(db, user, { status: "archived" })).toHaveLength(
      1,
    );
  });

  it("links a memo to a memory and promotes a memory back to a memo", async () => {
    const memo = await createMemo(db, user, {
      content: "FlareMo 使用 D1 作为事实源",
      visibility: "private",
      source: "test",
    });

    const created = await createMemoryFromMemo(
      db,
      user,
      USER,
      {
        content: "FlareMo 使用 D1 作为事实源",
        type: "semantic",
        kind: "decision",
        scopeType: "project",
        scopeKey: "github:realchendahuang/FlareMo",
        tier: "normal",
        importance: 80,
        confidence: 100,
        verification: "confirmed",
      },
      memo.id,
    );
    expect(created.duplicate).toBe(false);

    const linked = await listMemoriesForMemo(db, user, memo.id);
    expect(linked.map((memory) => memory.id)).toContain(created.memory.id);

    const promoted = await promoteMemoryToMemo(
      db,
      user,
      USER,
      created.memory.id,
    );
    expect(promoted.memo).toMatch(/^memos\//);

    // The promoted memo references the same conclusion back to the memory.
    const linksAfterPromote = await listMemoriesForMemo(db, user, memo.id);
    expect(linksAfterPromote.map((memory) => memory.id)).toContain(
      created.memory.id,
    );
  });

  it("round-trips memories through export and import", async () => {
    const created = await createMemory(db, user, USER, {
      content: "FlareMo 必须保持 Cloudflare Native",
      type: "semantic",
      kind: "constraint",
      scopeType: "project",
      scopeKey: "github:realchendahuang/FlareMo",
      tier: "core",
      importance: 90,
      confidence: 100,
    });

    const bundle = await exportData(db, user);
    expect(bundle.version).toBe(3);
    expect(bundle.memories).toHaveLength(1);
    expect(bundle.memories[0]?.name).toBe(created.memory.id);

    // Wipe the memory tables, then re-import and verify the record survives
    // with the same namespaced id and content.
    await db.delete(memoryRelations).all();
    await db.delete(memoryResourceLinks).all();
    await db.delete(memoryRevisions).all();
    await db.delete(memoryItems).all();

    const result = await importData(db, user, bundle);
    expect(result.imported_memories).toBe(1);

    const restored = await listMemories(db, user, {});
    expect(restored).toHaveLength(1);
    expect(restored[0]?.id).toBe(created.memory.id);
    expect(restored[0]?.content).toBe("FlareMo 必须保持 Cloudflare Native");
    expect(restored[0]?.verification).toBe("confirmed");
  });
});
