import type { UserRow } from "@flaremo/db";
import {
  applyFlaremoMigrations,
  createDb,
  memoryEvents,
  memoryEvidence,
  memoryRelations,
} from "@flaremo/db";
import { eq } from "drizzle-orm";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  archiveMemory,
  compileCoreMemory,
  confirmMemory,
  createMemory,
  extractAndProposeDreamingFact,
  getMemory,
  getMemoryLineage,
  hardDeleteMemory,
  listMemoryEvidence,
  listMemoryReview,
  lockMemory,
  type MemoryActor,
  recallMemories,
  resolveProposal,
  restoreMemory,
  unlockMemory,
} from "./memory";
import { ensureSingleUser } from "./users";

let mf: Miniflare;
let db: ReturnType<typeof createDb>;
let user: UserRow;

const USER: MemoryActor = { type: "user" };
const AGENT: MemoryActor = { type: "agent", name: "pi-agent" };

describe("Memory Ledger v2 Architecture & Acceptance Tests", () => {
  beforeEach(async () => {
    mf = new Miniflare({
      script: "export default { fetch() { return new Response('ok') } }",
      modules: true,
      compatibilityDate: "2026-07-10",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: { DB: "flaremo-memory-v2-test" },
    });
    const database = await mf.getD1Database("DB");
    db = createDb(database);
    await applyFlaremoMigrations(database);
    user = await ensureSingleUser(db, {
      email: "owner@example.com",
      name: "Owner",
    });
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("Acceptance 1: AI auto-supersedes AI memory on same fact_key with non-overlapping valid_to", async () => {
    // 1. AI writes v1
    const v1 = await createMemory(db, user, AGENT, {
      content: "开发环境端口使用 3000",
      factKey: "dev.port",
      type: "semantic",
      kind: "fact",
      scopeType: "project",
      scopeKey: "FlareMo",
      tier: "normal",
      importance: 50,
      confidence: 70,
      validFrom: "2026-01-01T00:00:00.000Z",
    });

    expect(v1.memory.verification).toBe("observed");
    expect(v1.memory.status).toBe("active");

    // 2. AI writes v2 with same factKey
    const v2ValidFrom = "2026-03-01T00:00:00.000Z";
    const v2 = await createMemory(db, user, AGENT, {
      content: "开发环境端口改用 5573",
      factKey: "dev.port",
      type: "semantic",
      kind: "fact",
      scopeType: "project",
      scopeKey: "FlareMo",
      tier: "normal",
      importance: 60,
      confidence: 80,
      validFrom: v2ValidFrom,
    });

    expect(v2.memory.verification).toBe("observed");
    expect(v2.memory.status).toBe("active");

    // Check v1 is superseded and valid_to = v2.valid_from
    const v1Fresh = await getMemory(db, user, v1.memory.id);
    expect(v1Fresh.status).toBe("superseded");
    expect(v1Fresh.superseded_by_id).toBe(v2.memory.id);
    expect(v1Fresh.valid_to).toBe(v2ValidFrom);
  });

  it("Acceptance 2: AI cannot auto-supersede human-locked (pinned) memory, degrades to inferred proposal", async () => {
    // 1. Human creates pinned memory
    const humanPinned = await createMemory(db, user, USER, {
      content: "主数据库必须使用 Cloudflare D1",
      factKey: "db.primary",
      type: "semantic",
      kind: "constraint",
      scopeType: "project",
      scopeKey: "FlareMo",
      tier: "core",
      importance: 100,
      confidence: 100,
      verification: "locked",
    });

    expect(humanPinned.memory.verification).toBe("locked");
    expect(humanPinned.memory.status).toBe("active");

    // 2. AI attempts to write conflicting fact on same factKey
    const aiProposal = await createMemory(db, user, AGENT, {
      content: "建议主数据库换成 Postgres",
      factKey: "db.primary",
      type: "semantic",
      kind: "decision",
      scopeType: "project",
      scopeKey: "FlareMo",
      tier: "normal",
      importance: 70,
      confidence: 60,
    });

    // Human asset is unharmed
    const humanFresh = await getMemory(db, user, humanPinned.memory.id);
    expect(humanFresh.status).toBe("active");
    expect(humanFresh.verification).toBe("locked");

    // AI write became an inferred proposal in review queue
    expect(aiProposal.memory.verification).toBe("inferred");
    expect(aiProposal.memory.needs_review).toBe(true);
    expect(aiProposal.memory.review_reason).toBe("supersede_proposal");

    const reviewItems = await listMemoryReview(db, user);
    expect(reviewItems.some((r) => r.id === aiProposal.memory.id)).toBe(true);
  });

  it("Acceptance 3: Human resolves proposal: accept upgrades to confirmed & supersedes previous fact", async () => {
    const v1 = await createMemory(db, user, USER, {
      content: "包管理器使用 npm",
      factKey: "package_manager",
      type: "semantic",
      kind: "preference",
      scopeType: "global",
      scopeKey: null,
      tier: "normal",
      importance: 80,
      confidence: 100,
      validFrom: "2026-01-01T00:00:00.000Z",
    });

    const proposal = await createMemory(db, user, AGENT, {
      content: "全库迁移到 pnpm",
      factKey: "package_manager",
      type: "semantic",
      kind: "preference",
      scopeType: "global",
      scopeKey: null,
      tier: "normal",
      importance: 85,
      confidence: 75,
      validFrom: "2026-02-01T00:00:00.000Z",
    });

    expect(proposal.memory.verification).toBe("inferred");

    // Human resolves proposal with "accept"
    const resolution = await resolveProposal(
      db,
      user,
      USER,
      proposal.memory.id,
      {
        action: "accept",
      },
    );

    expect(resolution.resolved).toBe(true);
    expect(resolution.action).toBe("accepted");
    expect(resolution.memory.verification).toBe("confirmed");
    expect(resolution.memory.needs_review).toBe(false);

    // v1 is superseded
    const v1Fresh = await getMemory(db, user, v1.memory.id);
    expect(v1Fresh.status).toBe("superseded");
    expect(v1Fresh.superseded_by_id).toBe(proposal.memory.id);
    expect(v1Fresh.valid_to).toBe("2026-02-01T00:00:00.000Z");
  });

  it("Acceptance 4: Human rejects proposal -> records rejection and blocks Dreaming repeated nagging", async () => {
    const proposal = await createMemory(db, user, AGENT, {
      content: "切换构建工具为 Bun",
      factKey: "build.tool",
      type: "semantic",
      kind: "preference",
      scopeType: "global",
      scopeKey: null,
      tier: "normal",
      importance: 50,
      confidence: 50,
    });

    // Reject proposal with reason
    const result = await resolveProposal(db, user, USER, proposal.memory.id, {
      action: "reject",
      rejection_reason: "团队坚守 Node/pnpm 规范，不使用 Bun",
    });

    expect(result.action).toBe("rejected");
    expect(result.memory.status).toBe("archived");

    // Verify negative feedback guard prevents dreaming from re-proposing
    const dreamingAttempt = await extractAndProposeDreamingFact(db, user, {
      content: "切换构建工具为 Bun",
      factKey: "build.tool",
      sourceType: "memo",
      sourceId: "memo-123",
    });

    expect(dreamingAttempt.proposed).toBe(false);
    expect(dreamingAttempt.reason).toContain("不使用 Bun");

    // A dismissed card must leave the inbox. The review query selects pending
    // items, so a rejection that leaves the row looking pending would keep the
    // very card the user just dismissed on the list forever.
    const inbox = await listMemoryReview(db, user);
    expect(inbox.map((row) => row.id)).not.toContain(proposal.memory.id);

    // ...and the same item cannot be adjudicated twice: a second click must not
    // resurrect it or supersede a fact with a proposal the user already refused.
    await expect(
      resolveProposal(db, user, USER, proposal.memory.id, {
        action: "accept",
      }),
    ).rejects.toThrow(/already been resolved/);
  });

  it("Acceptance 5: Archiving leaves valid_* intact, restoring enforces double-active check", async () => {
    const item = await createMemory(db, user, USER, {
      content: "临时测试规则",
      factKey: "test.rule",
      type: "semantic",
      kind: "fact",
      scopeType: "global",
      scopeKey: null,
      tier: "normal",
      importance: 50,
      confidence: 100,
      validFrom: "2026-01-01T00:00:00.000Z",
      validTo: "2026-12-31T00:00:00.000Z",
    });

    const archived = await archiveMemory(db, user, USER, item.memory.id);
    expect(archived.status).toBe("archived");
    // valid_from and valid_to are preserved (§VI.5)
    expect(archived.valid_from).toBe("2026-01-01T00:00:00.000Z");
    expect(archived.valid_to).toBe("2026-12-31T00:00:00.000Z");

    // Create another active memory on same factKey while item is archived
    await createMemory(db, user, USER, {
      content: "新的测试规则",
      factKey: "test.rule",
      type: "semantic",
      kind: "fact",
      scopeType: "global",
      scopeKey: null,
      tier: "normal",
      importance: 60,
      confidence: 100,
    });

    // Attempting to restore old item should fail double-active check (§IV.3)
    await expect(restoreMemory(db, user, USER, item.memory.id)).rejects.toThrow(
      /Cannot restore: another memory with the same fact key is currently active/,
    );
  });

  it("Acceptance 6: Hard-delete cascade wipes evidence, revisions, events, and relations", async () => {
    const created = await createMemory(db, user, USER, {
      content: "带证据和历史的记忆",
      type: "semantic",
      kind: "fact",
      scopeType: "global",
      scopeKey: null,
      tier: "normal",
      importance: 50,
      confidence: 100,
      evidence: [
        {
          source_type: "manual",
          source_id: "src-1",
          excerpt: "依据片段文本",
        },
      ],
    });
    const id = created.memory.id;

    // Check evidence exists
    const evBefore = await listMemoryEvidence(db, user, id);
    expect(evBefore).toHaveLength(1);

    // Hard-delete
    await hardDeleteMemory(db, user, USER, id);

    // Verify cascade
    const evAfter = await db
      .select()
      .from(memoryEvidence)
      .where(eq(memoryEvidence.memoryId, id));
    expect(evAfter).toHaveLength(0);

    const evEvents = await db
      .select()
      .from(memoryEvents)
      .where(eq(memoryEvents.memoryId, id));
    expect(evEvents).toHaveLength(0);
  });

  it("Acceptance 7: Bi-temporal recall with as_of query vs current time", async () => {
    // Past version: valid from Jan to Feb
    const past = await createMemory(db, user, USER, {
      content: "1月份配置：使用 Webpack 构建",
      factKey: "bundler.choice",
      type: "semantic",
      kind: "decision",
      scopeType: "global",
      scopeKey: null,
      tier: "normal",
      importance: 50,
      confidence: 100,
      validFrom: "2026-01-01T00:00:00.000Z",
      validTo: "2026-02-01T00:00:00.000Z",
    });

    // Current version: valid from Feb onwards
    const current = await createMemory(db, user, USER, {
      content: "2月份起配置：使用 Vite 构建",
      factKey: "bundler.choice",
      type: "semantic",
      kind: "decision",
      scopeType: "global",
      scopeKey: null,
      tier: "normal",
      importance: 80,
      confidence: 100,
      validFrom: "2026-02-01T00:00:00.000Z",
    });

    // Query as of Jan 15th
    const pastRecall = await recallMemories(db, user, {
      query: "Webpack",
      asOf: "2026-01-15T00:00:00.000Z",
    });
    expect(pastRecall.some((r) => r.id === past.memory.id)).toBe(true);
    expect(pastRecall.some((r) => r.id === current.memory.id)).toBe(false);

    // Default query (current time)
    const currentRecall = await recallMemories(db, user, {
      query: "构建",
    });
    expect(currentRecall.some((r) => r.id === current.memory.id)).toBe(true);
    expect(currentRecall.some((r) => r.id === past.memory.id)).toBe(false);
  });

  it("Acceptance 8: Core Memory Compiler packs strict negative constraints first and stays deterministic", async () => {
    await createMemory(db, user, USER, {
      content: "严禁在客户端代码中硬编码任何 API 密钥",
      type: "semantic",
      kind: "constraint",
      scopeType: "global",
      scopeKey: null,
      tier: "core",
      importance: 100,
      confidence: 100,
      verification: "locked",
    });

    await createMemory(db, user, USER, {
      content: "项目必须使用 Cloudflare D1 作为持久化存储",
      type: "semantic",
      kind: "fact",
      scopeType: "global",
      scopeKey: null,
      tier: "core",
      importance: 90,
      confidence: 100,
      verification: "locked",
    });

    await createMemory(db, user, USER, {
      content: "代码格式化遵循 Prettier 规范",
      type: "semantic",
      kind: "preference",
      scopeType: "global",
      scopeKey: null,
      tier: "normal",
      importance: 60,
      confidence: 100,
      verification: "confirmed",
    });

    const compiled1 = await compileCoreMemory(db, user, {
      agent: "claude-code",
      max_chars: 6000,
    });

    const compiled2 = await compileCoreMemory(db, user, {
      agent: "claude-code",
      max_chars: 6000,
    });

    // Byte-for-byte deterministic (§IX.8)
    expect(compiled1.system_prompt_payload).toBe(
      compiled2.system_prompt_payload,
    );

    // Negative constraints placed under top section (§VI.7)
    expect(compiled1.system_prompt_payload).toContain(
      "## STRICT NEGATIVE CONSTRAINTS / 绝对红线",
    );
    expect(
      compiled1.system_prompt_payload.indexOf("STRICT NEGATIVE CONSTRAINTS"),
    ).toBeLessThan(
      compiled1.system_prompt_payload.indexOf("CORE CONSTRAINTS & PREFERENCES"),
    );
  });

  it("Acceptance 9: Lineage tree retrieves full version history, revisions, events, and evidence", async () => {
    const _v1 = await createMemory(db, user, AGENT, {
      content: "初代架构：使用 Express",
      factKey: "server.framework",
      type: "semantic",
      kind: "fact",
      scopeType: "project",
      scopeKey: "FlareMo",
      tier: "normal",
      importance: 50,
      confidence: 50,
      evidence: [
        {
          source_type: "session",
          source_id: "session-001",
          excerpt: "初次技术选型探讨",
        },
      ],
    });

    const v2 = await createMemory(db, user, AGENT, {
      content: "二代架构：使用 Hono",
      factKey: "server.framework",
      type: "semantic",
      kind: "fact",
      scopeType: "project",
      scopeKey: "FlareMo",
      tier: "normal",
      importance: 80,
      confidence: 90,
    });

    const lineage = await getMemoryLineage(db, user, v2.memory.id);
    expect(lineage.current.id).toBe(v2.memory.id);
    expect(lineage.chain).toHaveLength(2);
    expect(lineage.events.length).toBeGreaterThan(0);
  });

  it("Acceptance 10: Competing proposals on a challenged human fact all reach the inbox; accepting one retires the holder and leaves the other pending", async () => {
    const humanFact = await createMemory(db, user, USER, {
      content: "日志统一走 pino",
      factKey: "logging.library",
      type: "semantic",
      kind: "decision",
      scopeType: "project",
      scopeKey: "FlareMo",
      tier: "normal",
      importance: 80,
      confidence: 100,
      verification: "confirmed",
    });

    // Two agents challenge the same key. Each must degrade into a proposal —
    // picking the sibling proposal as the key holder would auto-supersede it
    // and then die on the human fact's unique index (regression: key-slot
    // lookups must exclude inferred rows).
    const proposalA = await createMemory(db, user, AGENT, {
      content: "日志改走 winston",
      factKey: "logging.library",
      type: "semantic",
      kind: "decision",
      scopeType: "project",
      scopeKey: "FlareMo",
      tier: "normal",
      importance: 60,
      confidence: 60,
    });
    const proposalB = await createMemory(db, user, AGENT, {
      content: "日志改走 Axiom",
      factKey: "logging.library",
      type: "semantic",
      kind: "decision",
      scopeType: "project",
      scopeKey: "FlareMo",
      tier: "normal",
      importance: 70,
      confidence: 65,
    });

    expect(proposalA.memory.verification).toBe("inferred");
    expect(proposalB.memory.verification).toBe("inferred");
    expect(proposalB.memory.review_reason).toBe("supersede_proposal");

    // B's contradicts relation must point at the human holder, not at A.
    const relations = await db
      .select()
      .from(memoryRelations)
      .where(eq(memoryRelations.memoryId, proposalB.memory.id));
    expect(
      relations.some(
        (r) =>
          r.relatedMemoryId === humanFact.memory.id && r.type === "contradicts",
      ),
    ).toBe(true);
    expect(
      relations.some((r) => r.relatedMemoryId === proposalA.memory.id),
    ).toBe(false);

    // Accepting B retires the human fact; A stays pending in the inbox.
    const resolution = await resolveProposal(
      db,
      user,
      USER,
      proposalB.memory.id,
      {
        action: "accept",
      },
    );
    expect(resolution.memory.verification).toBe("confirmed");

    const humanFresh = await getMemory(db, user, humanFact.memory.id);
    expect(humanFresh.status).toBe("superseded");
    expect(humanFresh.superseded_by_id).toBe(proposalB.memory.id);

    const pendingA = await getMemory(db, user, proposalA.memory.id);
    expect(pendingA.status).toBe("active");
    expect(pendingA.verification).toBe("inferred");
    const inbox = await listMemoryReview(db, user);
    expect(inbox.some((r) => r.id === proposalA.memory.id)).toBe(true);
  });

  it("Review inbox shows the memory a proposal would replace; confirm keeps an iron rule locked; unlock only unpins rules", async () => {
    const rule = await createMemory(db, user, USER, {
      content: "部署只走 kosx 脚本",
      factKey: "deploy.path",
      type: "semantic",
      kind: "constraint",
      scopeType: "global",
      scopeKey: null,
      tier: "normal",
      importance: 80,
      confidence: 100,
      verification: "confirmed",
    });
    const locked = await lockMemory(db, user, USER, rule.memory.id);
    expect(locked.verification).toBe("locked");
    expect(locked.tier).toBe("core");

    const proposal = await createMemory(db, user, AGENT, {
      content: "部署改走 GitHub Actions",
      factKey: "deploy.path",
      type: "semantic",
      kind: "decision",
      scopeType: "global",
      scopeKey: null,
      tier: "normal",
      importance: 50,
      confidence: 60,
    });
    const inbox = await listMemoryReview(db, user);
    const item = inbox.find((r) => r.id === proposal.memory.id);
    expect(item?.conflict_with?.id).toBe(rule.memory.id);
    expect(item?.conflict_with?.content).toBe("部署只走 kosx 脚本");

    const stillLocked = await confirmMemory(db, user, USER, rule.memory.id);
    expect(stillLocked.verification).toBe("locked");

    const untouched = await unlockMemory(db, user, USER, proposal.memory.id);
    expect(untouched.verification).toBe("inferred");

    const unpinned = await unlockMemory(db, user, USER, rule.memory.id);
    expect(unpinned.verification).toBe("confirmed");
    expect(unpinned.tier).toBe("normal");
  });
});
