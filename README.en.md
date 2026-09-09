# FlareMo

**A Cloudflare-native team knowledge base that runs all day on a free Cloudflare account. Use it alone and it is a quiet personal notebook; use it with a team and it becomes a shared knowledge base with roles and three visibility levels (private, team-visible, public). It ships with D1, R2, Better Auth native authentication, an optional Cloudflare Access outer layer, a quiet memo timeline, and a Memos-compatible API subset.**

[![GitHub stars](https://img.shields.io/github/stars/realchendahuang/FlareMo?style=social)](https://github.com/realchendahuang/FlareMo)
[![license](https://img.shields.io/github/license/realchendahuang/FlareMo)](./LICENSE)
[![Powered by Cloudflare](https://img.shields.io/badge/powered%20by-Cloudflare-F38020?logo=cloudflare&logoColor=white)](https://www.cloudflare.com/)
[![Memos compatible](https://img.shields.io/badge/Memos-compatible-0466c1)](https://github.com/usememos/memos)

[中文 README](./README.md)

<p>
  <img src="./docs/assets/flaremo-desktop.png" alt="FlareMo desktop timeline" width="720">
  <img src="./docs/assets/flaremo-mobile.png" alt="FlareMo mobile timeline" width="220">
</p>

The screenshots show the current backend-backed timeline, editor, filtering, and mobile navigation. Features that are not implemented yet, such as messaging-app capture, are not exposed as placeholder UI.

## What It Does

- Quick memo capture with tags and attachments.
- Timeline, archive, trash, D1 FTS5 search, tag filtering, and activity heatmap. Search spans timeline and archived notes by default and supports `has:attachment`, `is:pinned`, `before:YYYY-MM-DD`, `after:YYYY-MM-DD`, and `in:timeline|archive|trash`.
- Semantic search ("Find"): Workers AI embeddings plus a Vectorize derived index, with every hit re-checked against D1 permissions; it degrades to FTS5 keyword search when the embedding provider or index is absent. See [docs/semantic-search.md](./docs/semantic-search.md) for the boundary.
- Daily review (`/review/daily`, this-day-in-history), random walk (`/review/walk`, tag/relation strolls with a postcard summary), and related notes on the memo detail page.
- An installable PWA; new memo drafts are saved locally, while offline submissions (including attachments) wait in a local queue and are submitted in order when connectivity returns.
- Markdown/GFM with image and audio attachment previews.
- Memo detail pages with relations, backlinks, and revision restore.
- Revocable public share links.
- Team mode: `owner` / `admin` / `member` roles with member management. Admins add members in the Team Management page (name + email; the server issues a one-time activation link and members set their own passwords — the admin never handles or sees a password), promote or demote admins, and remove members with a retryable data cleanup that deletes private data while keeping team and public content.
- Three visibility levels: private (author only), team-visible (read-only for active members), and public (anonymous read-only). The web UI, Memos-compatible API, MCP, attachments, search, and SSE all share one permission matrix.
- Memos-style import and export with conflict strategies.
- A current Memos-style camelCase/protobuf-JSON `/api/v1` subset for memos, attachments, relations, shares, social resources, the auth facade, and PAT resources; the Connect JSON/protobuf/gRPC-Web surface also covers the single-user UserService webhook CRUD/signing-secret and notification list/update/delete subset, including comment/mention payloads. The legacy snake_case wire remains available through an explicit header.
- Chinese and English interface.

FlareMo keeps the UI honest: if a feature is not wired to the backend, it does not appear as a fake entry point.

## Deployment

Deployment is manual by design: the repository does not track `wrangler.jsonc`, and there is no one-click button or automatic deployer. Two ways to get there — pick one.

### Agent Deployment

Use the repository [agent deployment runbook](./docs/agent-deploy.md) with Codex, Claude Code, Cursor Agent, or another command-capable agent. The agent copies `wrangler.jsonc.example`, creates the D1 / R2 resources, fills in the `database_id`, applies migrations, and deploys.

### Manual Deployment

```bash
pnpm install
pnpm exec wrangler d1 create flaremo
pnpm exec wrangler r2 bucket create flaremo-attachments
```

Copy `wrangler.jsonc.example` to `wrangler.jsonc` (the repository does not track `wrangler.jsonc` itself), fill in the generated D1 `database_id`, and set `FLAREMO_PUBLIC_URL` to your public origin, then run:

```bash
pnpm verify
pnpm deploy:dry-run
pnpm deploy
```

Full deployment docs: [docs/deploy.md](./docs/deploy.md).

### Pre-deployment Checklist

- Wrangler is logged in to the target Cloudflare account: `pnpm exec wrangler whoami`.
- `wrangler.jsonc` uses `DB` as the D1 binding and contains the target D1 `database_id`.
- `wrangler.jsonc` uses `ATTACHMENTS` as the R2 binding, and the target bucket exists.
- `pnpm deploy` applies pending remote D1 migrations before publishing the Worker.
- `FLAREMO_PUBLIC_URL` is set to the production canonical origin, and Better Auth secrets are configured through Wrangler or the Cloudflare dashboard.
- The one-time owner bootstrap, native login, and PAT creation have been verified; if Cloudflare Access is enabled, the outer policy and application authentication have both been tested.
- Cloudflare Access policies are optional outer controls for human access, Service Tokens, and public share bypass routes.
- The release gate has passed: `pnpm verify` and `pnpm deploy:dry-run`.

## Auth Boundary: Better Auth, with optional Access

FlareMo's application authentication is provided by Better Auth. On the first production deployment, the operator manually enters the one-time bootstrap secret, username, display name, email, and password in the HTTPS `/setup` page to create the single owner. Public signup is disabled after bootstrap. The main team path is adding members in the Team Management page: the server issues a one-time activation link and members set their own passwords. The owner can still enable open registration as a compatibility path (off by default), letting anyone create a member account through `/register` or the Memos-compatible `signup`. `FLAREMO_SINGLE_USER_EMAIL` and `FLAREMO_SINGLE_USER_NAME` are legacy variables for existing `users/owner` domain metadata, not login credentials or bootstrap inputs; the setup form is authoritative. Team roles, visibility permissions, and member-removal semantics are documented in [docs/team-mode.md](./docs/team-mode.md). The data model leaves room for future mapped users without changing existing memo IDs.

- Browser login uses an `HttpOnly`, `SameSite=Lax` cookie session.
- Scripts, MCP, and Memos-compatible clients use a revocable `memos_pat_` Personal Access Token created by an authenticated account.
- The plaintext PAT is returned only at creation time; list and revoke responses do not expose it.
- Cookie-session state-changing requests such as `POST`, `PATCH`, and `DELETE` must carry an `Origin` that exactly matches `FLAREMO_PUBLIC_URL` or `FLAREMO_TRUSTED_ORIGINS`; missing or untrusted origins return `403`. PAT requests may omit `Origin` for desktop scripts and MCP clients, but a supplied `Origin` must match the same allowlist or the request returns `403`. Wildcards, `Referer`, and Access headers are not substitutes for Origin validation.
- Cloudflare Access is an optional outer layer. An Access Service Token only passes the outer policy; it does not become a FlareMo user session. If Access is enabled, clients need both layers.
- Public shares continue to use FlareMo share tokens, expiry, and memo-state checks.

Set the production `FLAREMO_PUBLIC_URL` to an origin without a path, query, or fragment, then configure the two Worker secrets interactively:

```bash
pnpm exec wrangler secret put BETTER_AUTH_SECRET --config ./wrangler.jsonc
pnpm exec wrangler secret put FLAREMO_BOOTSTRAP_SECRET --config ./wrangler.jsonc
```

Never put real secrets, the initial password, cookies, or PATs in `wrangler.jsonc`, documentation, Git, logs, or chat. See the [deployment guide](./docs/deploy.md) for the setup sequence.

Native PAT example (`FLAREMO_MEMOS_PAT` must come from a secure local configuration):

```bash
curl "$FLAREMO_URL/api/v1/memos" \
  -H "Authorization: Bearer $FLAREMO_MEMOS_PAT"
```

When Access remains enabled, add its headers as well; an Access Service Token alone is not enough for private application data:

```bash
curl "$FLAREMO_URL/api/v1/memos" \
  -H "CF-Access-Client-Id: $FLAREMO_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $FLAREMO_ACCESS_CLIENT_SECRET" \
  -H "Authorization: Bearer $FLAREMO_MEMOS_PAT"
```

## Tech Stack

- Runtime: Cloudflare Workers
- Web: React, Vite, Tailwind CSS, shadcn/radix primitives
- API: Hono-style Worker routes, Zod contracts, OpenAPI
- Database: Cloudflare D1, Drizzle
- Object storage: Cloudflare R2
- Auth boundary: Better Auth; optional Cloudflare Access outer layer
- Package manager: pnpm

D1 is the source of truth for notes, users, relations, shares, settings, and attachment metadata. R2 stores only binary objects and export bundles.

## Memos Compatibility

FlareMo uses Memos as an ecosystem anchor, not as an internal server fork. The compatibility layer is an adapter over FlareMo domain services.

Current docs:

- [Memos compatibility matrix](./docs/memos-compatibility.md)
- [Memos ecosystem matrix](./docs/memos-ecosystem.md)
- [Semantic search architecture](./docs/semantic-search.md)
- [OpenAPI](./packages/contracts/src/openapi.ts)

The important auth detail is the two-layer boundary. A third-party Memos client must send a FlareMo PAT, and if the production instance is behind Access it must also send these headers:

```text
CF-Access-Client-Id
CF-Access-Client-Secret
```

`memos_pat_` is a FlareMo-native application credential, not proof of complete Memos Server auth parity. The Origin security direction follows the [Memos 0.30 MCP browser-origin model](https://usememos.com/docs/integrations/mcp). The default `/api/v1` wire is now the implemented current camelCase/protobuf-JSON subset, while `X-FlareMo-Wire: legacy` keeps the older snake_case surface available. The Better Auth-backed auth facade and PAT resources are implemented as a subset; `accessToken` is an opaque session-backed token, not a native Memos JWT. The root `/mcp` endpoint is a stateless Streamable HTTP MCP tool subset. FlareMo has bounded social routes and a UserService webhook CRUD/signing-secret plus notification list/update/delete subset, including comment/mention payloads, and a bounded asynchronous outbox for four memo webhook events with retries; complete Memos Server parity, full CEL/Connect/SSE, complete upstream comments/reactions/shortcuts service/wire parity, full multi-user notification ACL, complete upstream webhook event semantics/egress SSRF protection, and real smoke tests for third-party clients remain unfinished. See the [compatibility matrix](./docs/memos-compatibility.md) and [ecosystem matrix](./docs/memos-ecosystem.md).

## Development

```bash
pnpm install
pnpm migrate:local
pnpm dev
```

Local URL:

```text
http://localhost:8787
```

Quality gate:

```bash
pnpm verify
pnpm deploy:dry-run
```

Maintenance commands:

```bash
pnpm format:check
pnpm screenshots
pnpm backup:drill
pnpm release vX.Y.Z
```

The project does not use GitHub Actions as CI or as the production deployer. Maintainers run the local release gate before publishing. A self-hosted deployment repository includes the least-privilege `Prepare FlareMo update` workflow that only prepares upstream Release updates as pull requests; Cloudflare Workers Builds remains the deployer for repositories connected to it. See [the update guide](./docs/en/update.md).

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md), [SUPPORT.md](./SUPPORT.md), [SECURITY.md](./SECURITY.md), and [ROADMAP.md](./ROADMAP.md).

## License

FlareMo is open source under the [GNU AGPL-3.0](./LICENSE) (AGPL-3.0-only).

- Self-hosting, modification, and redistribution follow the AGPL-3.0 terms; if you offer a modified version as a network service, you must make the corresponding source available to that service's users.
- Copyright (c) 2026 realchendahuang. The copyright holder may dual-license beyond AGPL-3.0 for the FlareMo hosted offering.
- The "FlareMo" name and marks are not licensed under AGPL-3.0; forks and derivatives must not use the FlareMo brand for promotion or imply official endorsement.
