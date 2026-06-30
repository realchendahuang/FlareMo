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

FlareMo expects production instances to be protected by Cloudflare Access. Do not add an app-level Bearer token, login page, or custom session gateway to FlareMo.

Recommended boundary:

- Human access: `Allow` identity policy.
- Scripts, MCP, and Memos-compatible clients: `Service Auth` policy plus Access Service Token.
- Public shares and static assets: narrowly scoped `Bypass` policies.

### 1. Create an Access application

In the Cloudflare Dashboard, go to `Zero Trust` -> `Access` -> `Applications` -> `Add an application`, then choose `Self-hosted`.

Recommended values:

| Field | Value |
| --- | --- |
| Application name | `FlareMo` |
| Application domain | Your production hostname, for example `notes.example.com` |
| Session duration | `24h` or `1 week` for a personal instance |

If you are starting with a `workers.dev` or Worker Preview URL, enable Cloudflare Access from the Worker `Settings` -> `Domains & Routes` page, then manage the Access policies. For long-term use, prefer a custom hostname and protect that hostname.

### 2. Configure the human access policy

Add an `Allow` policy for the root application. Include only yourself or the people who should use this FlareMo instance.

Recommended values:

| Item | Value |
| --- | --- |
| Policy action | `Allow` |
| Include | Your email, email domain, GitHub/Google/SSO group, or selected One-time PIN email |
| Exclude | Usually empty; do not use `Everyone` for the root application |

This policy protects the browser UI. Authenticated users receive a Cloudflare Access session cookie.

### 3. Create a Service Token

Scripts, MCP, and Memos-compatible clients usually cannot complete a browser login flow. Use an Access Service Token for those clients.

In the Cloudflare Dashboard, go to `Zero Trust` -> `Access` -> `Service Auth` -> `Service Tokens`, then create a token such as:

```text
FlareMo API clients
```

Save the `Client ID` and `Client Secret` shown at creation time. The secret is only displayed once. Store it in a password manager or environment variables; never commit it.

Local environment example:

```bash
export FLAREMO_ACCESS_CLIENT_ID="<client-id>"
export FLAREMO_ACCESS_CLIENT_SECRET="<client-secret>"
```

### 4. Configure the machine access policy

Return to the FlareMo Access application and add a policy:

| Item | Value |
| --- | --- |
| Policy action | `Service Auth` |
| Include | The Service Token you created |
| Require | Optional; add IP/Country constraints if clients come from fixed networks |

Machine clients authenticate with Cloudflare Access headers:

```bash
curl "$FLAREMO_URL/api/v1/memos" \
  -H "CF-Access-Client-Id: $FLAREMO_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $FLAREMO_ACCESS_CLIENT_SECRET"
```

MCP example:

```bash
curl "$FLAREMO_URL/api/v1/mcp" \
  -H "content-type: application/json" \
  -H "CF-Access-Client-Id: $FLAREMO_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $FLAREMO_ACCESS_CLIENT_SECRET" \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Do not turn the Service Token into a FlareMo app token. FlareMo application code does not read, issue, or store these credentials.

### 5. Configure public share bypass

Public shares need unauthenticated access to the share page and shared attachments. Cloudflare Access path policies let more specific paths override the root application policy, so add explicit `Bypass` policies for:

- `/share/*`
- `/api/public/shares/*`
- `/assets/*`

Recommended policies:

| Path | Policy action | Include |
| --- | --- | --- |
| `/share/*` | `Bypass` | `Everyone` |
| `/api/public/shares/*` | `Bypass` | `Everyone` |
| `/assets/*` | `Bypass` | `Everyone` |

Only bypass these public paths. Do not bypass `/api/v1/*`, `/openapi.json`, or the root application. `Bypass` disables Access enforcement and Access logging for matching requests; machine clients that need authentication and auditability should use `Service Auth`.

The bypass only skips Cloudflare Access. FlareMo still validates share token, expiration time, and memo state. Archived, trashed, deleted, or expired shares must remain inaccessible.

### 6. Verify the configuration

Unauthenticated browser access to the root application should see Cloudflare Access:

```bash
curl -I "$FLAREMO_URL"
```

API requests with a Service Token should reach FlareMo:

```bash
curl "$FLAREMO_URL/api/v1/memos" \
  -H "CF-Access-Client-Id: $FLAREMO_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $FLAREMO_ACCESS_CLIENT_SECRET"
```

Public share routes should not require Access login, but invalid share tokens still must not expose content:

```bash
curl -I "$FLAREMO_URL/share/not-a-real-token"
curl -I "$FLAREMO_URL/api/public/shares/not-a-real-token"
```

## Access Checklist

- The root hostname or Worker URL has a Cloudflare Access application.
- Human access uses an `Allow` policy scoped to allowed users only.
- Scripts, MCP, and Memos-compatible clients use a `Service Auth` policy and Access Service Token.
- The `Client Secret` is not committed to the repository, issues, PRs, or public logs.
- `/share/*`, `/api/public/shares/*`, and `/assets/*` have explicit `Bypass` policies.
- The root application, `/api/v1/*`, and `/openapi.json` are not bypassed.
- FlareMo has no app-level Bearer token login.

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
