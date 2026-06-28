# Agent Deployment Runbook

This runbook is for Codex, Claude Code, Cursor Agent, and other command-capable coding agents.

## Preconditions

- Current directory is the FlareMo repository root.
- `pnpm install` has completed, or the agent can run it.
- Wrangler is logged in to the target Cloudflare account.
- `wrangler.jsonc` points to the target D1 and R2 resources.
- Production access is handled by Cloudflare Access, not FlareMo application code.

## Do Not

- Do not add GitHub Actions.
- Do not deploy before `pnpm verify`.
- Do not commit `Temp/`, `node_modules/`, `dist/`, `.wrangler/`, `.dev.vars`, `backups/`, `test-results/`, or `playwright-report/`.
- Do not add app-level Bearer token login.
- Do not move canonical note data from D1 to KV, R2, or Vectorize.

## Standard Flow

```bash
git status --short
pnpm install
pnpm verify
pnpm deploy:dry-run
pnpm migrate:remote
pnpm deploy
```

## Post-Deploy Check

Set the production URL:

```bash
export FLAREMO_URL="https://<worker-name>.<account>.workers.dev"
```

If the instance is protected by Cloudflare Access, unauthenticated requests should be intercepted by Access:

```bash
curl -sSL "$FLAREMO_URL" | rg "Log in|Cloudflare Access|FlareMo"
```

Scripts need an Access Service Token:

```bash
curl "$FLAREMO_URL/api/v1/memos" \
  -H "CF-Access-Client-Id: $FLAREMO_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $FLAREMO_ACCESS_CLIENT_SECRET"
```

Public share routes need a separate Access bypass policy. The content must still be protected by FlareMo share tokens.

## Common Failures

### D1 Migration Failed

Confirm the D1 binding name is `DB`:

```bash
pnpm exec wrangler d1 migrations list DB --remote
```

### R2 Upload Failed

Confirm the R2 binding name is `ATTACHMENTS` and the bucket exists:

```bash
pnpm exec wrangler r2 bucket list
```

### Request Blocked by Access

This is expected for production. Script requests must include:

```text
CF-Access-Client-Id
CF-Access-Client-Secret
```

### Old Frontend Assets

```bash
pnpm --filter @flaremo/web build
pnpm deploy
```
