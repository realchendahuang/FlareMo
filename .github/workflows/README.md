# weekly-post workflow — secrets, rotation, and runbook

Posts P01's starred-repo batch (`private-feed-source/data/queue.json`) to FlareMo
as PROTECTED memos every Sunday 14:00 UTC, and commits `data/posted.json` back
to this repo for dedupe/audit. See `plans/P02-private-feed-weekly-post.md`.

## Owner gate

The job runs only when `github.repository_owner == 'MaksimZinovev'`, so forks and
clones owned by other users stay dormant.

## Secrets (4)

Set on `MaksimZinovev/FlareMo` via `gh secret set … -R MaksimZinovev/FlareMo`:

| Secret | Value | Source | Rotation |
| --- | --- | --- | --- |
| `FLAREMO_URL` | `https://flaremo.mkznve.workers.dev` | your deployed Worker URL | only when the Worker URL changes |
| `FLAREMO_ACCESS_CLIENT_ID` | Service Token Client ID | Cloudflare Zero Trust → Access → Service Tokens | rotate with the secret (one Service Token) |
| `FLAREMO_ACCESS_CLIENT_SECRET` | Service Token Secret | same Service Token (shown once at creation) | rotate with the client id |
| `PRIVATE_FEED_SOURCE_PAT` | fine-grained PAT, `contents:read` on `MaksimZinovev/private-feed-source` | GitHub → Settings → Developer settings → PAT | independent rotation |

The three `FLAREMO_*` secrets come from a single Cloudflare Access Service Token
and must rotate together. `PRIVATE_FEED_SOURCE_PAT` is a separate GitHub PAT
with only `contents:read` on the harvest repo — the workflow never pushes to it
(`persist-credentials: false` on that checkout).

Local template: `.dev.vars.example` (copy to gitignored `.dev.vars` for the
gating curl). Setup steps: `docs/setup-guide/05b-access-service-token.md`.

## Concurrency

`group: feed-state`, `cancel-in-progress: false` — a run is never cancelled by
a new schedule; they serialize. This group is per-repo and independent of P01's
same-named group in `private-feed-source`.

## What the workflow writes

- `data/posted.json` in THIS repo (committed via the auto `GITHUB_TOKEN`,
  `contents: write`). Non-sensitive: memo names + public repo ids.
- It NEVER writes to `private-feed-source`. `queue.json` is read-only here; P01
  overwrites it weekly.

## Runbook

- Manual dispatch: `gh workflow run weekly-post.yml -R MaksimZinovev/FlareMo`
- Watch: `gh run watch -R MaksimZinovev/FlareMo`
- If a run fails mid-batch: already-posted entries are committed; unposted ones
  stay in `queue.json` for the next run (post.sh stops on the first non-2xx).

## Debugging auth failures

If the workflow's POST step fails with HTTP 302, the Service Token is not
attached to a Service Auth policy on the FlareMo Access app. See
`skills/flaremo-api/SKILL.md` → "Debugging auth failures", and the fix at
`docs/setup-guide/05b-access-service-token.md` step 5.
