# Agent Memory: the AI Long-Term Memory Hub

Beyond recording what you wrote (Memos), FlareMo ships an independent **Agent Memory** that answers a different question — what should AI remember long-term? It lets agents (Claude Code / Codex / Pi / ZCode and others) read and write cross-session, cross-agent long-term memory (user preferences, project decisions, constraints, lessons learned) through **CLI commands and a Skills playbook**, while you review, confirm, lock, correct, or delete every entry from the FlareMo web UI.

Positioning: **FlareMo = Human Knowledge (Memo) + Agent Memory**. Memory belongs to the user; agents are readers and contributors.

## Boundary with Memos

- A **Memo** is a record on the timeline, any length, part of the "event stream".
- A **Memory** is an atomic conclusion — one stable fact per entry (e.g. "FlareMo uses D1 as the source of truth"), capped at 4,000 characters. Long content goes into Memos; Memory stores conclusions only.
- The two are linked bidirectionally via `derived_from` / `promoted_to`: a memo can be distilled into a memory, and a memory can be expanded back into a memo.

## Recommended integration: CLI + Skills (best practice)

Integration principle (see [memory-ledger-design.md](../memory-ledger-design.md) §8): **REST is the only substrate; CLI and Skill are the primary paths.** Both ship with the repository and are published with the open-source release:

- **CLI**: `bin/flaremo` at the repo root, registered under `bin` in `package.json`. Install after cloning:

  ```bash
  npm install -g .    # or pnpm link --global; or run directly via node bin/flaremo
  ```

- **Skill**: `skills/flaremo-memory/SKILL.md` — a standard working playbook for agents (Claude Code, Codex, Pi, ZCode, …): check the rules before starting, record facts while working, file a battle report when finishing, and declare explicitly when the service is unreachable. Install it into your agent's skills directory (e.g. `~/.agents/skills/flaremo-memory/`) for consistent behavior with no extra system prompt.

The CLI needs two environment variables pointing at the instance and credentials:

```bash
export FLAREMO_URL="https://flaremo.example.com"   # your FlareMo instance
export FLAREMO_PAT="memos_pat_…"                    # a PAT created in the web UI
```

The daily four steps:

```bash
flaremo lens                       # before work: the compiled projection for this project
flaremo recall "database migration rules"   # targeted retrieval of rules and past pitfalls
flaremo remember "conclusion" --key "deploy.wrangler_config"   # record a fact (auto version lineage)
flaremo checkpoint "this session's report"   # after work: episodic summary + atomic conclusions
```

Also available: `flaremo status` (list active notes) and `flaremo seed` (cold start: scan README/AGENTS and submit candidate notes for review). The **exit-code contract** (`0` success / `0` + offline warning / `1` error / `3` service unreachable) and the weak-network local-snapshot fallback are documented in the Skill — **"read current rules" and "only got a stale snapshot" must stay distinguishable**, otherwise an agent will treat an expired snapshot as current fact.

The CLI is the command-line subset of the capability surface: `lens`↔`memory_compile`, `recall`↔`memory_recall`, `remember`↔`memory_remember`, `checkpoint`↔`memory_checkpoint`, `status`↔`memory_bootstrap`. Relation editing (`memory_link`) and archiving (`memory_forget`) happen in the web UI or via the MCP endpoint below.

## Authentication

Agent Memory reuses FlareMo's Better Auth application-layer credentials — **no second token system**. Agents authenticate with a revocable `memos_pat_` Personal Access Token; the browser management UI uses the HttpOnly cookie session. If production still sits behind Cloudflare Access, pair an Access Service Token on top, but an Access Service Token alone never becomes a FlareMo identity.

Create a PAT in the web UI first, with a clear purpose and an expiry.

## Alternative integration: the MCP endpoint

Existing MCP clients can connect to `/memory/mcp` directly (stateless Streamable HTTP MCP). It shares the same REST domain semantics as the CLI/Skills — no second set of semantics — and is a **different endpoint** from the existing `/mcp` and `/api/v1/mcp` (memo tool subset); they do not interfere with each other.

Tool discovery:

```bash
curl "$FLAREMO_URL/memory/mcp" \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $FLAREMO_PAT" \
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

The seven tools:

| Tool | Purpose | When to call |
| --- | --- | --- |
| `memory_bootstrap` | Restore global + project core memories, key decisions/constraints, recent lessons | Once when entering a new project or major session; not every turn |
| `memory_recall` | Hybrid recall: fact-key exact hit, full-text, semantic, 1-hop relations fused by RRF, with hit paths | When a task involves past decisions, preferences, constraints, or failures |
| `memory_remember` | Store one atomic long-term fact (with `fact_key` version lineage and evidence chain) | When a stable cross-session conclusion emerges |
| `memory_compile` | Compile the full projection for the current context (deterministic, char-budgeted, iron rules hard-included, auto-archived) | When multiple agents must share one projection; preferred over assembling bootstrap results yourself |
| `memory_checkpoint` | Distill completed work into 1 episodic summary + several atomic memories | After finishing a feature, design, research, or decision |
| `memory_link` | Create memory↔memory or memory↔resource relations (`supersedes`/`contradicts`/`supports`, …) | When a new/old memory relation (conflict, supersession, support) is discovered |
| `memory_forget` | Archive or mark superseded a memory that is no longer correct | When a memory is wrong, outdated, or irrelevant |

Each tool's description inlines its calling policy, so any MCP client gets consistent behavior with no extra system prompt.

### Key parameters

- **scope**: memories are partitioned by `global` / `workspace` / `project` / `agent`. Recall and bootstrap cover `global` + the current `project_key` (e.g. `github:owner/repo`) + the current `agent` by default; **cross-project recall is forbidden**.
- **type**: `semantic` (facts/knowledge), `episodic` (events/experiences), `procedural` (flows/how-to).
- **kind**: `preference` / `fact` / `decision` / `constraint` / `entity` / `event` / `outcome` / `lesson` / `procedure`.

### Example calls

```bash
# Restore context when entering a project (once)
curl "$FLAREMO_URL/memory/mcp" \
  -H "content-type: application/json" \
  -H "Authorization: Bearer $FLAREMO_PAT" \
  --data '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"memory_bootstrap","arguments":{"agent":"codex","project_key":"github:owner/repo"}}}'

# Record a decision
curl "$FLAREMO_URL/memory/mcp" \
  -H "content-type: application/json" \
  -H "Authorization: Bearer $FLAREMO_PAT" \
  --data '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"memory_remember","arguments":{"content":"FlareMo uses D1 as the business data source of truth","type":"semantic","kind":"decision","scope_type":"project","scope_key":"github:owner/repo"}}}'
```

## Permission model

User authority always outranks agents:

```
locked > confirmed > observed > inferred
```

- Agents may only write as `observed` / `inferred`; they can **never lock or confirm** a memory.
- Agents cannot overwrite user `confirmed` / `locked` memories. On conflict, use `memory_link` to file a `contradicts` relation — the asserting memory enters the Review queue (`needs_review`) while the challenged memory stays untouched and fully recallable, until the user rules on it.
- Agents never hard-delete; `memory_forget` only archives or marks superseded, history is preserved. Only the user can physically delete in the UI.
- The write gate rejects credentials (`Authorization` / `cookie` / `memos_pat_` / private keys / passwords) and does SHA-256 fingerprint exact-dedup.

## Current boundaries (P0)

These are deliberately deferred, not defects; the design leaves room for them:

- **Hybrid recall**: `memory_recall` runs four paths in parallel — `fact_key` exact hit (short-circuits to the top), full-text index (FTS5 bm25 relevance order), `VECTORIZE_MEMORIES` semantic search, and 1-hop relation expansion — fused with RRF; every result carries the paths it hit. The semantic path depends on the embedding infrastructure (when the provider or index is unavailable that path silently drops out and the other three keep working). Memory vectors are isolated by `namespace = owning user`, sharing the same infrastructure as memo semantic search — see [semantic search](../semantic-search.md).
- **Automated consolidation is offline dreaming, not in-conversation**: agent-driven `remember` / `checkpoint` remains the primary path. "Dreaming" is driven by the daily maintenance window — it distills new memos and checkpoints from the scan window into 💡 conjectures in the review inbox (Workers AI extraction, disable with `FLAREMO_MEMORY_DREAMING=off`), **never enters the projection directly**, **never auto-supersedes human assets**, and is bounded by the daily proposal quota (default 5, `FLAREMO_MEMORY_PROPOSAL_DAILY_LIMIT`), a prompt-level guardrail fed by fact keys rejected in the last 30 days, and fingerprint dedup. A weekly conflict patrol additionally samples human-endorsed assets for internal contradictions — findings become proposals, never edits.
- **Lifecycle has a maintenance clock**: 💡 conjectures auto-archive after N days (default 14) unanswered; 👀 memories that have not been recalled for 90 days sink to the archive (human-endorsed assets never sink; recall records access time); vectors of superseded / archived / expired / past-`expires_at` rows are reclaimed by the daily maintenance task (future-dated supersessions keep their vectors until the effective date); revisions fold into milestone snapshots beyond 50; a full quota first sinks dormant AI assets, then refuses writes explicitly.
- **Evidence has staleness detection**: memo-backed evidence is checked daily by the maintenance task — a changed source gets the【evidence changed】badge, a vanished source gets【evidence missing】and the memory re-enters the review inbox for a human to re-take or retire it.
- **Fact keys are governed**: caller-supplied keys are normalized (`Project.Database` → `project.database`); when no key is given, an established same-family key is reused (primary topic matching an existing key's tail segment); when no family exists the entry stays keyless — a bare topic never coins a key out of thin air.
- **Injection archive**: every agent `memory_compile` is archived automatically; the web `/memory/lens` endpoint returns both the recompute preview and the most recent actual injection — when they differ, the archive wins.
- **`source_agent` is a string**: for source attribution and agent-scope isolation, not a registered identity system.
- **Single user**: all queries carry `user_id`; multi-user collaboration is out of current scope.

## Management UI

The web `/memory` page provides Core / Projects / Recent / Review / Archive columns: inspect every AI-recorded memory's provenance and confidence, confirm, lock, correct, archive, or delete; the Review column aggregates `inferred` pending items and `disputed` conflicts. A memo detail page can "record as Memory", and a memory card can "promote to memo".

On export, the six memory datasets are included in the bundle (version 6: items / revisions / relations / resource-links / evidence / events); fingerprints, access counts and embedding-derived fields are not exported and are rebuilt on import.
