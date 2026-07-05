# Daily FlareMo note from a private source — ideas & alternatives

> **Q:** Could a GitHub Actions workflow run daily and post a specific type of note using content extracted from a private resource (e.g. a private GitHub repo, Cloudflare storage/DB, or something else)? Generate ideas and alternatives, scored by complexity.

**A:** Yes. Here's a brainstorm of daily-note workflows, scored by complexity. All share a common baseline, then differ by the **private source** they pull from.

## Common baseline (applies to every idea)

- `on: schedule: cron` daily + `curl` POST to `$FLAREMO_URL/api/v1/memos` with the 3 CF-Access headers (Service Token — the "Service auth" Access policy bypasses login, so GitHub Actions IPs work fine).
- 3 repo secrets: `FLAREMO_URL`, `FLAREMO_ACCESS_CLIENT_ID`, `FLAREMO_ACCESS_CLIENT_SECRET`.
- A guard: **skip if content is empty** (don't post a blank note).

## Ideas, scored 1 (trivial) → 5 (hard)

| # | Idea | Private source | Note type | Complexity | Extra secrets | Why that score |
|---|------|----------------|-----------|------------|---------------|----------------|
| 1 | Daily entry from a file (reading-list / quotes / "tip of the day") | Private GitHub repo | link / idea | **1** | repo PAT (or `GITHUB_TOKEN` if same repo) | `actions/checkout` + read one line by date; minimal formatting |
| 2 | Code snippet of the day | Private GitHub repo | code | **2** | repo access | checkout + pick a file/snippet + wrap in fence; light logic |
| 3 | Daily commit/issue/PR digest | Private GitHub repo | meeting | **2** | GH PAT (for other private repos) | GitHub REST API + date filter + format a digest |
| 4 | RSS/feed item of the day | Private/authenticated feed | link | **2** | feed auth header | curl + parse XML (jq/xmllint); one item |
| 5 | Cloudflare KV value (rotating key) | Cloudflare KV | generic / idea | **2–3** | `CF_API_TOKEN` (KV read) | KV REST `GET` one key |
| 6 | Cloudflare D1 query result (daily metric/row) | Cloudflare D1 (another DB) | generic / idea | **3** | `CF_API_TOKEN` + `D1_DATABASE_ID` | run SQL via D1 REST + format rows |
| 7 | Cloudflare R2 object of the day | Cloudflare R2 | code / link | **3–4** | R2 S3-style creds (access key + secret + account) | S3 GET object + extract content |
| 8 | External DB row (Supabase / Postgres) | External DB | generic | **4** | DB connection string | DB client in the runner + query + format |
| 9 | Calendar agenda (Google Calendar) | Google Calendar (private) | meeting | **5** | service-account JSON + calendar ID | OAuth/JWT setup, scope, token exchange — heaviest |
| 10 | Workers-AI summary of today's commits | Private repo + Cloudflare AI | meeting / idea | **4** | repo PAT + `CF_API_TOKEN` | gather commits + call Workers AI + format |

## Notes / risks

- **Service Token from GH Actions**: works (Service Auth policy bypasses Access) — but if you rotate the token, update the GH secret.
- **Secret masking**: GitHub auto-masks secrets in logs; the *note content* isn't a secret, so it's fine to log.
- **Idempotency**: a daily cron can re-run on manual dispatch — add a "today's note already exists?" check (e.g. tag like `#daily-2026-07-05`) to avoid duplicates.
- **Privacy**: ideas 1–3 keep content inside GitHub (no third-party calls). 6–7 stay in your Cloudflare account. 8–9 leave your perimeter.

## Recommendation

**Start with #1** (daily entry from a file in a private GitHub repo) — complexity 1, truly private, maps cleanly to a note type, fewest secrets, easiest to debug. **#2** if you specifically want code snippets. **#6** if you want to surface data you already have in another D1.

---

*Captured 2026-07-05 from a pi agent session. Source: brainstorm in response to the question above.*