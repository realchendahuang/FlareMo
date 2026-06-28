# Deploy FlareMo

FlareMo deploys to Cloudflare Workers. The same Worker serves the web UI and API. D1 stores canonical data, and R2 stores attachments and export bundles.

## Deploy to Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/realchendahuang/FlareMo)

Cloudflare reads `wrangler.jsonc`, creates the Worker, and provisions the D1 and R2 bindings.

If the Cloudflare Dashboard shows `Connect a Git account to continue.`, connect GitHub or GitLab in Cloudflare first. That is a Cloudflare Workers Builds requirement.

After deployment, apply remote D1 migrations:

```bash
pnpm migrate:remote
```

## Manual Deployment

```bash
pnpm install
pnpm exec wrangler d1 create flaremo
pnpm exec wrangler r2 bucket create flaremo-attachments
```

Write the D1 `database_id` into `wrangler.jsonc`, then run:

```bash
pnpm verify
pnpm deploy:dry-run
pnpm migrate:remote
pnpm deploy
```

## Cloudflare Access

FlareMo expects production instances to be protected by Cloudflare Access.

Recommended policy split:

- Human access: Access identity policy.
- Scripts, MCP, and Memos-compatible clients: Access Service Token.
- Public shares: explicit bypass policy for public share routes.

Service Token example:

```bash
curl "$FLAREMO_URL/api/v1/memos" \
  -H "CF-Access-Client-Id: $FLAREMO_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $FLAREMO_ACCESS_CLIENT_SECRET"
```

Recommended bypass paths:

- `/share/*`
- `/api/public/shares/*`
- `/assets/*`

The bypass only skips Cloudflare Access. FlareMo still validates share token, expiration time, and memo state.

## Local Development

```bash
pnpm migrate:local
pnpm dev
```

Default URL:

```text
http://localhost:8787
```

## Upgrade

Read `CHANGELOG.md` and GitHub Release notes before upgrading.

If the release notes mention a database migration:

```bash
pnpm migrate:remote
```

Then deploy:

```bash
pnpm deploy
```

## Verification

```bash
curl -I "$FLAREMO_URL"
curl "$FLAREMO_URL/openapi.json"
```

If Cloudflare Access is enabled, unauthenticated browser requests should see the Access login page. Script requests must include `CF-Access-Client-Id` and `CF-Access-Client-Secret`.
