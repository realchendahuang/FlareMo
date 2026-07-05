---
id: P02
type: plan
status: draft
owner: Maksim
depends_on: [P01]
spec_checksum: 1c879734
last_validated: ~
---

# Private Feed Weekly-Post — Week's Starred Repos to FlareMo

```spec
scope: document
type: plan
required_sections: [Context, Tools & Skills, Approach, Out of Scope, Steps, Files to Modify, Reuse, Evidence Pack, Verification, Bottom Line]
max_chars: 20000
banned_words: [TODO, TBD, placeholder]
placeholders: ["```df-todo", "[REPLACE]"]
match:
  has_checklist: '^- \[( |x)\]'
  has_source: 'Source:'
  has_file_marker: '(CREATED|UPDATED|DELETED)'
  has_test: '# Test \d'
  has_out_of_scope: '^## Out of Scope'
  has_tools_and_skills: '^## Tools & Skills'
  has_ynp_format: '^- .+: (Yes|No|Possibly)\b'
```

## Context

```spec
type: plan
max_chars: 20000
banned_words: [might be, could be, seems like, I think, possibly, perhaps]
match:
  has_problem: '(problem|issue|bug|break|fail|cannot|does.not|unable)'
```

P01 harvest writes this week's starred-repo batch to `queue.json` in `private-feed-source`, but nothing drains it into FlareMo memos. The problem is a missing weekly workflow that reads the batch and posts every entry to FlareMo as PROTECTED memos, recording them in `posted.json` for dedupe/audit. This plan builds the post half: a weekly workflow in the `flaremo` repo (gated to the real owner so clones stay dormant) that posts the whole batch in one run, 2h after P01's harvest.

## Tools & Skills

```spec
type: plan
max_chars: 20000
banned_words: [N/A, n/a, grep sufficient, small codebase, simple enough, overkill for]
match:
  min_3_ynp: '^- .+: (Yes|No|Possibly)\b'
  has_cx: '\bcx\b.*\(Skills\).*: Yes\b'
  has_ck: '\bck\b.*\(Skills\).*: Yes\b'
  has_gh: '\bgh\b.*\(CLI\).*: Yes\b'
  has_deepwiki: 'deepwiki.*\(MCP\).*: Yes\b'
  has_inspect: '\binspect\b.*\(Skills\).*: Yes\b'
  has_slopscan: '\bslop-scan\b.*\(CLI\).*: Yes\b'
```

- cx (Skills): Yes — navigate flaremo's codebase to place post.sh + weekly-post.yml consistently with existing structure
- ck (Skills): Yes — semantic-search flaremo for existing API-call / CF-Access header / curl patterns to reuse in post.sh
- gh (CLI): Yes — set the 4 flaremo repo secrets, dispatch weekly-post, watch runs
- deepwiki (MCP): Yes — understand flaremo's auth + API surface so post.sh hits the right endpoint with the right headers
- inspect (Skills): Yes — triage the PR adding weekly-post.yml + post.sh for structural risk before merge
- slop-scan (CLI): Yes — scan post.sh for AI-slop patterns before committing
- curl (CLI): Yes — the gating live curl and the POSTs inside post.sh
- jq (CLI): Yes — post.sh reads queue.json / writes posted.json with jq
- actionlint (CLI): Possibly — validate weekly-post.yml locally if installed
- docfence (Skills): Yes — scaffolded and validates this plan
- commit (Skills): Yes — frequent commits per skill guidance
- verification-before-completion (Skills): Yes — run the Verification block before done

## Approach

```spec
type: plan
max_chars: 800
banned_words: [Q1:, Q2:, Q3:, **Q, Question:]
match:
  has_alternative: '(alternative|instead of|rather than|compared to|over:|vs[.])'
```

Weekly-post workflow in `flaremo`, gated by `if: github.repository_owner == 'MaksimZinovev'` so clones/forks stay dormant. Cron Sun 14:00 UTC, 2h after P01's harvest, so this week's `queue.json` is ready. It checks out `private-feed-source` cross-repo read-only (one read-only PAT), reads `queue.json`, posts EVERY unposted entry to FlareMo `/api/v1/memos` with the two CF-Access headers and `{content, visibility:"protected"}`, and appends each returned `name` to `posted.json` (committed locally). `queue.json` is untouched (P01 overwrites it weekly) — zero cross-repo writes. An alternative is a daily one-per-day drip — rejected because it couples posting to daily cadence and leaves a busy week's queue undrained; the weekly batch matches the harvest cadence.

## Out of Scope

```spec
type: plan
max_chars: 20000
banned_words: [Nothing., None., N/A, n/a, Not applicable]
match:
  has_justification: '^- .+:'
  min_2_exclusions: '^- .+:'
```

- Daily one-per-day posting: P02 posts the whole weekly batch in one run, not one-per-day
- Harvesting starred repos: P01 scope (this plan depends_on P01)
- Cross-repo writes to private-feed-source: intentionally avoided; the PAT is read-only
- Per-run idempotency guard (tag-based skip): POC choice — accept manual re-run duplicates (posted.json dedupe is the safety net)
- State-write durability (POST 200 but commit fails): accepted POC gap
- posted.json pruning: unbounded growth is trivial at personal scale
- DST-aware cron (AEDT): fixed UTC cron; 1-hour summer drift acceptable
- Rich memo content (images, per-repo customization): fixed "Detailed" text format only

## Steps

```spec
type: plan
max_chars: 20000
banned_words: [**Step, **Task, **Phase]
match:
  has_step_evidence: '^- \[ \].*\(Source'
  min_3_steps: '^- \[( |x)\]'
```

- [ ] Run the gating live curl — `POST /api/v1/memos` with the two CF-Access headers and a test body (Source: Evidence Pack Claim 1, Claim 2)
  - Confidence: 0.9
  - Details: `curl -sS -X POST "$FLAREMO_URL/api/v1/memos" -H "content-type: application/json" -H "CF-Access-Client-Id: $FLAREMO_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $FLAREMO_ACCESS_CLIENT_SECRET" --data '{"content":"POC test — safe to delete","visibility":"protected"}' | jq .` Confirm HTTP 2xx (201 Created) and inspect `creator`. If `creator` is not your FlareMo user, STOP — the rest depends on the Service Token mapping to the right account. Delete the test memo afterward.
- [ ] Seed `data/posted.json` as `[]` in `flaremo` (Source: this plan)
  - Confidence: 1.0
  - Details: `mkdir -p data && echo '[]' > data/posted.json`. Non-sensitive (memo names + repo ids already in public memos); committed state.
- [ ] Write `scripts/post.sh` (in `flaremo`) — post every unposted queue entry, record in posted (Source: Evidence Pack Claim 1, Claim 2)
  - Confidence: 0.85
  - Details: Reads `queue.json` from `$QUEUE_FILE` and `posted.json` from `$POSTED_FILE`. If queue empty, `exit 0`. Build the posted-id set from posted.json (dedup id = numeric GitHub repo `id` per P01's state contract; `posted.id` == `queue.id`; posted.json entry = queue entry + `{memo_name, posted_at}`, e.g. `{"id":12345678,"full_name":"owner/repo",...,"memo_name":"memos/<uuid>","posted_at":"2026-07-07T14:05:00Z"}`). For each queue entry whose `id` is NOT in the posted set: format the "Detailed" memo body (`⭐ [full_name](html_url)` + description + `**Lang:** … · **Stars:** … · **Starred at:** …` + `Topics: #topic1 #topic2`); `POST $FLAREMO_URL/api/v1/memos` with the two CF-Access headers and `{"content": "...", "visibility": "protected"}`; on 2xx (201), capture `name` and append the entry to `posted.json` with `posted_at` + `memo_name`; on non-2xx, print the body to stderr and `exit 1` (stop the batch — already-posted entries stay recorded, unposted ones stay in queue for the next run). Do NOT modify `queue.json` (P01 merges/refreshes it weekly).
- [ ] Write `.github/workflows/weekly-post.yml` in `flaremo` — weekly cron + owner gate + read-only cross-repo checkout + local posted write (Source: Evidence Pack Claim 3, Claim 4)
  - Confidence: 0.9
  - Details: `on: schedule: - cron: "0 14 * * 0"` (Sun 14:00 UTC, 2h after P01 harvest) plus `workflow_dispatch`. Job-level `if: github.repository_owner == 'MaksimZinovev'`. `permissions: contents: write` (local posted.json commit; auto `GITHUB_TOKEN`). `concurrency: { group: feed-state, cancel-in-progress: false }`. Job env: `FLAREMO_URL`, `FLAREMO_ACCESS_CLIENT_ID`, `FLAREMO_ACCESS_CLIENT_SECRET`, `PRIVATE_FEED_SOURCE_PAT` (read-only) from secrets. Steps: (1) read-only checkout of `MaksimZinovev/private-feed-source` into a subpath via `actions/checkout` with `repository:` + `token: ${{ secrets.PRIVATE_FEED_SOURCE_PAT }}`; (2) run `scripts/post.sh` with `QUEUE_FILE=<checkout>/data/queue.json` and `POSTED_FILE=data/posted.json`; (3) `git add data/posted.json`/`commit`/`push` to flaremo only if `post.sh` exited 0 and `posted.json` changed. `queue.json` is never written.
- [ ] Add the four `flaremo` repo secrets (Source: Evidence Pack Claim 2)
  - Confidence: 0.95
  - Details: `gh secret set FLAREMO_URL -b "https://flaremo.mkznve.workers.dev" -R MaksimZinovev/flaremo`; `gh secret set FLAREMO_ACCESS_CLIENT_ID -b "<id>" -R MaksimZinovev/flaremo`; `gh secret set FLAREMO_ACCESS_CLIENT_SECRET -b "<secret>" -R MaksimZinovev/flaremo`; `gh secret set PRIVATE_FEED_SOURCE_PAT -b "<fine-grained PAT with contents:read-only on MaksimZinovev/private-feed-source>" -R MaksimZinovev/flaremo`. The PAT is read-only — the workflow never pushes to `private-feed-source`. Document in `flaremo`'s workflow README that the three `FLAREMO_*` come from the Cloudflare Access Service Token (rotate together) and `PRIVATE_FEED_SOURCE_PAT` is a separate rotation.
- [ ] Manually dispatch `weekly-post` and confirm memos appear in FlareMo (Source: this plan)
  - Confidence: 0.8
  - Details: First ensure `private-feed-source`'s `data/queue.json` has entries (P01 has run or a manual seed). `gh workflow run weekly-post.yml -R MaksimZinovev/flaremo`. Watch with `gh run watch -R MaksimZinovev/flaremo`. Confirm the memos are visible in FlareMo as PROTECTED and `flaremo`'s `data/posted.json` holds them with `memo_name` (queue.json unchanged).
- [ ] Commit and push the `flaremo` branch (Source: commit skill)
  - Confidence: 0.9
  - Details: On `plan/private-feed-source` commit `.github/workflows/weekly-post.yml`, `scripts/post.sh`, `data/posted.json`, and this plan; open PR.

## Files to Modify

```spec
type: plan
max_chars: 20000
banned_words: [TODO, TBD, placeholder]
match:
  has_file_entry: '^- `[^`]+` — (CREATED|UPDATED|DELETED)'
```

- `flaremo/.github/workflows/weekly-post.yml` — CREATED: weekly post workflow (owner gate, read-only checkout of private-feed-source, Sun 14:00 UTC)
- `flaremo/scripts/post.sh` — CREATED: post every unposted queue entry + append to posted
- `flaremo/data/posted.json` — CREATED: dedupe/audit log, committed state local to flaremo (public; non-sensitive)
- `flaremo/plans/P02-private-feed-weekly-post.md` — CREATED: this plan

## Reuse

```spec
type: plan
max_chars: 20000
banned_words: [None., N/A, Nothing to reuse, No reuse]
match:
  has_reuse_item: '^- .+:'
```

- memos `CreateMemo` REST contract from `proto/api/v1/memo_service.proto`: `POST /api/v1/memos` with `body: "memo"`, fields `content` + `visibility`; response is the `Memo` with `name` and `creator`
- CF-Access Service Token header pattern from `flaremo/docs/deploy.md`: two headers `CF-Access-Client-Id` + `CF-Access-Client-Secret`, no app token
- archify e2e diagram `flaremo/faq/private-feed-source-e2e.html`: visual reference for the harvest→post flow split across P01 + P02

## Evidence Pack

```spec
type: plan
max_chars: 20000
banned_words: [**Source**:, **Source:**]
match:
  has_evidence_claim: '^- Claim:'
  has_confidence: 'Confidence:'
```

- Claim: `POST /api/v1/memos` is the REST endpoint; the body IS the `Memo` object (`body: "memo"`), with `content` (markdown) and `visibility` (`PRIVATE`/`PROTECTED`/`PUBLIC` in the proto enum — **but FlareMo's REST/Zod layer accepts lowercase strings `private`/`protected`/`public`**); the response is the created `Memo` with `name` (`memos/{id}`, where `{id}` is a UUID) and `creator` (`users/{user}`, OUTPUT_ONLY).
  Source: `proto/api/v1/memo_service.proto:18-26` (http annotation), `:149-158` (Visibility enum), `:293-300` (CreateMemoRequest), Memo `name`/`creator` fields
  Confidence: 0.95
  Implication: post.sh builds `{"content": "...", "visibility": "protected"}` and reads `name` + `creator` from each 2xx (201) response; `creator` answers which user owns it.
- Claim: FlareMo sits behind Cloudflare Access; machine clients authenticate with exactly two headers (`CF-Access-Client-Id`, `CF-Access-Client-Secret`) via a Service Auth policy. No FlareMo application token is involved.
  Source: `flaremo/docs/deploy.md:130-132, 178-180, 236`; `flaremo/faq/does-the-agent-have-access.md`
  Confidence: 0.9
  Implication: the workflow needs exactly three FlareMo secrets (`FLAREMO_URL` + the two header values); the REST `POST` path is not yet confirmed — hence the gating live curl in Step 1.
- Claim: GitHub Actions `concurrency` groups are per-repo; a fine-grained PAT with `contents:read` on a private repo authorizes `actions/checkout` of it; `permissions: contents: write` authorizes a commit to the workflow's own repo via the auto `GITHUB_TOKEN`.
  Source: GitHub Actions docs (known stable behavior)
  Confidence: 0.9
  Implication: weekly-post.yml uses a read-only PAT for the cross-repo checkout, `contents: write` for the local posted.json commit, and a per-repo `feed-state` group (independent of P01's same-named group).
- Claim: A job-level `if: github.repository_owner == 'MaksimZinovev'` prevents a workflow from running in forks/clones owned by other users.
  Source: GitHub Actions docs (`github` context, `repository_owner`)
  Confidence: 0.9
  Implication: weekly-post.yml is dormant in any clone of `flaremo` owned by a different user.
- Claim: AEST is UTC+10 (QLD, no DST); P02's weekly cron at Sun 14:00 UTC = 00:00 AEST Monday, 2h after P01's Sun 12:00 UTC harvest.
  Source: timezone definitions; user-confirmed weekly cadence
  Confidence: 0.9
  Implication: post cron `0 14 * * 0`. DST-state summer drift accepted in Out of Scope.

### Gaps

- Whether the REST `POST /api/v1/memos` returns 200 with only the two CF-Access headers is unverified — the FAQ confirms GET and MCP create, not REST Create. Resolved by Step 1 (gating live curl).
- Which FlareMo user `creator` is set to via the Service Token is unverified — confirmed by Step 1.
- `actionlint` availability unverified; if absent, YAML validated only by GitHub on dispatch.
- Mid-batch partial failure (some POSTs succeed, then one fails) is covered by the "stop on first failure" design but not by an offline test; the all-fail (Test 7) and all-succeed (Test 5/6) cases are covered.

### Sources Used

- `proto/api/v1/memo_service.proto` (local, memos repo)
- `flaremo/docs/deploy.md`, `flaremo/faq/does-the-agent-have-access.md` (local, flaremo repo)
- GitHub Actions docs (concurrency, permissions, GITHUB_TOKEN, github context)

## Verification

```spec
type: plan
max_chars: 20000
banned_words: [TODO, TBD, placeholder]
match:
  has_verify_command: '^```bash'
  has_expected: '# Expected:'
  min_2_tests: '# Test \d'
  has_state_space: '(empty|zero|partial|intermediate|boundary|edge case|failure)'
```

State-space — B1 CreateMemo REST auth: {happy 200 + correct creator; failure non-200/wrong creator/auth rejected}. B2 post.sh batch: queue {empty → no post; all-already-posted → no post; min(1) → 1 post; intermediate ~20 → 20 posts}; FlareMo {200 → append to posted; non-200 → exit 1, stop batch, posted unchanged}; queue untouched (P01 merges weekly). B3 workflow: {owner gate; contents:write; cron Sun 14:00; read-only checkout; no cross-repo push; YAML valid}.

```bash
# Test 1: B1 happy — gating live curl confirms REST CreateMemo works and captures creator
curl -sS -o /tmp/memo-res.json -w "%{http_code}\n" -X POST "$FLAREMO_URL/api/v1/memos" \
  -H "content-type: application/json" \
  -H "CF-Access-Client-Id: $FLAREMO_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $FLAREMO_ACCESS_CLIENT_SECRET" \
  --data '{"content":"POC test — safe to delete","visibility":"protected"}'
jq '.name, .creator' /tmp/memo-res.json
# Expected: 201, and /tmp/memo-res.json contains "name":"memos/<uuid>" and "creator":"users/<your-flaremo-user>"
```

```bash
# Test 2: B1 failure — wrong secret must be rejected (auth enforced, not silently bypassed)
curl -sS -o /dev/null -w "%{http_code}\n" -X POST "$FLAREMO_URL/api/v1/memos" \
  -H "content-type: application/json" \
  -H "CF-Access-Client-Id: bogus" -H "CF-Access-Client-Secret: bogus" \
  --data '{"content":"should fail","visibility":"protected"}'
# Expected: 302 (redirect to Cloudflare Access login) — NOT 2xx. A 2xx means Service Auth is misconfigured and the endpoint is open.
```

```bash
# Test 3: B2 empty — empty queue exits 0 and makes no POST (no blank note posted)
cd ~/repos/flaremo && echo '[]' > /tmp/queue.json && echo '[]' > data/posted.json && \
  QUEUE_FILE=/tmp/queue.json POSTED_FILE=data/posted.json ./scripts/post.sh; echo "exit=$?"; echo "queue=$(jq 'length' /tmp/queue.json) posted=$(jq 'length' data/posted.json)"
# Expected: exit=0, queue=0, posted=0 (nothing posted; queue file untouched)
```

```bash
# Test 4: B2 all-already-posted — every queue entry already in posted.json exits 0 with no post
cd ~/repos/flaremo && echo '[{"id":1,"full_name":"a/b"}]' > /tmp/queue.json && echo '[{"id":1,"full_name":"a/b","memo_name":"memos/1"}]' > data/posted.json && \
  QUEUE_FILE=/tmp/queue.json POSTED_FILE=data/posted.json ./scripts/post.sh; echo "exit=$?"; echo "posted=$(jq 'length' data/posted.json)"
# Expected: exit=0, posted=1 (all entries already posted; no new POST, posted.json unchanged)
```

```bash
# Test 5: B2 min(1) happy (integration) — one unposted entry is posted; queue untouched, posted gains it
cd ~/repos/flaremo && echo '[{"id":1,"full_name":"a/b","html_url":"https://github.com/a/b","description":null,"language":"Go","stargazers_count":1,"starred_at":"2026-07-04T12:00:00Z","topics":[],"queued_at":"now"}]' > /tmp/queue.json && echo '[]' > data/posted.json && \
  QUEUE_FILE=/tmp/queue.json POSTED_FILE=data/posted.json ./scripts/post.sh; echo "exit=$?"; echo "queue=$(jq 'length' /tmp/queue.json)"; jq 'length' data/posted.json
# Expected: exit=0, queue=1 (untouched — P01 owns queue), posted=1 (the entry now recorded with memo_name)
```

```bash
# Test 6: B2 intermediate (integration) — a 2-entry batch posts both; queue untouched, posted gains 2
cd ~/repos/flaremo && echo '[{"id":1,"full_name":"a/b","html_url":"https://github.com/a/b","description":null,"language":"Go","stargazers_count":1,"starred_at":"2026-07-04T12:00:00Z","topics":[],"queued_at":"now"},{"id":2,"full_name":"c/d","html_url":"https://github.com/c/d","description":null,"language":"Go","stargazers_count":1,"starred_at":"2026-07-04T11:00:00Z","topics":[],"queued_at":"now"}]' > /tmp/queue.json && echo '[]' > data/posted.json && \
  QUEUE_FILE=/tmp/queue.json POSTED_FILE=data/posted.json ./scripts/post.sh; echo "exit=$?"; echo "queue=$(jq 'length' /tmp/queue.json)"; jq 'length' data/posted.json
# Expected: exit=0, queue=2 (untouched), posted=2 (both entries recorded)
```

```bash
# Test 7: B2 failure — non-200 from FlareMo exits 1, stops the batch, and leaves posted.json unchanged
cd ~/repos/flaremo && echo '[{"id":1},{"id":2}]' > /tmp/queue.json && echo '[]' > data/posted.json && \
  FLAREMO_URL="http://127.0.0.1:9/api/v1/memos" QUEUE_FILE=/tmp/queue.json POSTED_FILE=data/posted.json ./scripts/post.sh; echo "exit=$?"; echo "queue=$(jq 'length' /tmp/queue.json) posted=$(jq 'length' data/posted.json)"
# Expected: exit=1 (connection refused → non-200), queue=2 (untouched), posted=0 (batch stopped, nothing recorded)
```

```bash
# Test 8: B3 — workflow has the owner gate, contents:write, Sun 14:00 cron, read-only checkout, feed-state group
grep -q "github.repository_owner == 'MaksimZinovev'" ~/repos/flaremo/.github/workflows/weekly-post.yml && \
  grep -q 'contents: write' ~/repos/flaremo/.github/workflows/weekly-post.yml && \
  grep -q 'group: feed-state' ~/repos/flaremo/.github/workflows/weekly-post.yml && \
  grep -q 'cron: "0 14 \* \* 0"' ~/repos/flaremo/.github/workflows/weekly-post.yml && \
  grep -q 'MaksimZinovev/private-feed-source' ~/repos/flaremo/.github/workflows/weekly-post.yml && \
  (actionlint ~/repos/flaremo/.github/workflows/weekly-post.yml 2>/dev/null || echo "actionlint-absent-yaml-skipped")
# Expected: all greps match; actionlint clean (or the skip note if actionlint is absent)
```

```bash
# Test 9: end-user — dispatched weekly-post posts the batch as PROTECTED memos visible to signed-in users
gh workflow run weekly-post.yml -R MaksimZinovev/flaremo && \
  gh run watch -R MaksimZinovev/flaremo && \
  test "$(jq 'length' ~/repos/flaremo/data/posted.json)" -ge 1 && echo "post-ok"
# Expected: post-ok — run succeeds; posted.json gains ≥1 entry; signed-in FlareMo shows the memos PROTECTED; incognito cannot read them
```

## Corrections applied during implementation

Captured 2026-07-05 while executing the plan (merged in PR #2):

1. **visibility lowercase**: the REST/Zod layer accepts `private|protected|public` (lowercase strings), not the proto enum's uppercase `PRIVATE/PROTECTED/PUBLIC`. Corrected in every code/curl body above. Evidence Pack Claim 1 updated with a parenthetical note.
2. **success = 2xx, not 200**: `POST /api/v1/memos` returns **201 Created** on success. post.sh treats any 2xx as success; the failure branch is `non-2xx → exit 1` (not `non-200`). Corrected in Step 3, Claim 1 Implication, and Tests 1/2.
3. **memo `name` is `memos/<uuid>`**, not `memos/<numeric>` (e.g. `memos/a139dcb8-…`). Corrected in Step 3's example.
4. **Step 6 ↔ Step 7 reorder**: GitHub Actions only registers/dispatches workflows present on the **default branch**. Test 9 (dispatch) therefore requires the PR to have merged to `main` first — the plan's original ordering (dispatch before merge) is impossible. Reordered in execution: PR merged, then dispatched from `main`.
5. **CF-Access Service Token must be attached to a Service Auth policy on the FlareMo app** (setup-guide 05b step 5). Symptom: live curl returns 302 with `service_token_status:false` in the redirect's `meta` JWT. Diagnostic captured in `skills/flaremo-api/SKILL.md` → "Debugging auth failures".
6. **post.sh curl-connection-failure `set -e` bug**: without `|| http_code="000"`, a connection failure aborted the script with curl's exit code (7) before the structured `exit 1` path. Fixed in `4c12057`.
7. **`actions/checkout@v4` → `@v5`**: v4 targets Node 20 (deprecated on Actions runners); bumped to v5 (Node 24) in this follow-up PR.

## Bottom Line

```spec
type: plan
max_chars: 20000
banned_words: [TODO, TBD, placeholder]
match:
  has_recommendation: 'Recommendation:'
```

- Per-step confidence: 0.9, 1.0, 0.85, 0.9, 0.95, 0.8, 0.9 — average ~0.90
- Key risk: the REST `POST /api/v1/memos` with only the two CF-Access headers is unverified, and the Service Token may map to the wrong `creator`. Mitigation: Step 1 is a hard gate — do not build the workflow until the live curl returns 200 with the correct `creator`.
- Gaps: REST POST path + creator mapping unverified until Step 1; `actionlint` availability unverified; mid-batch partial failure not offline-tested (all-fail + all-succeed covered); depends on P01 having populated `queue.json` before Test 9.
- Recommendation: proceed — but execute Step 1 first as a hard gate; coordinate with P01 so queue.json has this week's batch before the dispatch test.
