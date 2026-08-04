# Agent Deployment Runbook

This runbook is for Codex, Claude Code, Cursor Agent, and other command-capable coding agents.

## Preconditions

- Current directory is the FlareMo repository root.
- `pnpm install` has completed, or the agent can run it.
- Wrangler is logged in to the target Cloudflare account.
- `wrangler.jsonc` points to the target D1 and R2 resources.
- `wrangler.jsonc` Static Assets `run_worker_first` covers `/api/*`, `/file/*`, `/mcp`, `/openapi.json`, and `/memos.api.v1.*`; otherwise API, Memos Web attachment URLs, or Connect/gRPC-Web requests can be handled by the SPA fallback instead of the Worker.
- Application authentication is handled by Better Auth. Cloudflare Access is optional outer policy and does not replace a FlareMo cookie session or `memos_pat_` PAT.
- `BETTER_AUTH_SECRET` and `FLAREMO_BOOTSTRAP_SECRET` are configured as Wrangler secrets. `FLAREMO_RECOVERY_SECRET` is optional and must only be configured for an approved break-glass recovery window, then rotated or removed.

## Do Not

- Do not add GitHub Actions CI or deployment workflows. `flaremo-update.yml` is the only exception and only prepares upstream update pull requests in user deployment repositories.
- Do not deploy before `pnpm verify`.
- Do not commit `Temp/`, `node_modules/`, `dist/`, `.wrangler/`, `.dev.vars`, `backups/`, `test-results/`, or `playwright-report/`.
- Do not add a second authentication system, shared password, or standalone bearer-token table outside Better Auth. Machine access uses the revocable `memos_pat_` PAT boundary.
- Do not move canonical note data from D1 to KV, R2, or Vectorize.

## Standard Flow

```bash
git status --short
pnpm install
pnpm verify
pnpm deploy:dry-run
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

Scripts need a FlareMo `memos_pat_` application token. If the deployment still uses Cloudflare Access, they also need an Access Service Token:

```bash
curl "$FLAREMO_URL/api/v1/memos" \
  -H "CF-Access-Client-Id: $FLAREMO_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $FLAREMO_ACCESS_CLIENT_SECRET" \
  -H "Authorization: Bearer $FLAREMO_MEMOS_PAT"
```

Public share routes need a separate Access bypass policy. The content must still be protected by FlareMo share tokens.

The default `/api/v1` wire is the current camelCase/protobuf-JSON subset. `X-FlareMo-Wire: legacy` selects the older snake_case wire. Better Auth remains the identity source while the auth facade issues a Memos-style HS256 access JWT and rotates the `memos_refresh` HttpOnly cookie. The current release also exposes bounded social REST resources, a UserService webhook/notification resource subset, a bounded D1 outbox for four memo webhook events with retries, a Connect JSON/protobuf/gRPC-Web unary subset, and an authenticated heartbeat SSE stream. The root `/mcp` endpoint is a stateless Streamable HTTP subset; complete upstream webhook event/egress semantics, full notification filtering and multi-user ACL, complete upstream social semantics, and complete Memos Server, protobuf/gRPC, or third-party-client parity are not claimed.

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
