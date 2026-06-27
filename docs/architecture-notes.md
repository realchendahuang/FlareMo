# FlareMo Architecture Notes

This note captures the first-pass reference study for building a Flomo-like,
Cloudflare-native note product.

Reference repositories are cloned locally under `Temp/` and intentionally
ignored by Git:

- `Temp/MeowNocode` from `XuYouo/MeowNocode`
- `Temp/blinko` from `blinkospace/blinko`
- `Temp/memos` from `usememos/memos`

## Goal

Build a fast capture-first note app with a Flomo-like frontend, but make the
whole product Cloudflare-native:

- Static frontend served from Cloudflare.
- API on Workers.
- Main relational data in D1.
- Attachments and exports in R2.
- Optional AI features through Workers AI or external model providers.
- Optional semantic index in Vectorize.
- No long-running VM, Docker service, Postgres server, or Node server as the
  core production dependency.

## Strategic Direction

Use Memos as the primary base and ecosystem anchor.

This does not mean running the Go Memos server on Cloudflare. It means:

- Treat Memos' domain model, resource names, `/api/v1` protocol, OpenAPI shape,
  import/export expectations, and MCP direction as the main compatibility
  target.
- Rebuild the runtime for Cloudflare Workers, D1, R2, Queues/Cron, and
  Vectorize.
- Keep FlareMo's product experience more Flomo-like: faster capture, calmer
  timeline, lighter navigation, and fewer admin/social surfaces.
- Use Blinko and MeowNocode only as feature references.

Current repository signals support this weighting:

- `usememos/memos`: MIT, about 61k stars, about 4.5k forks, active in 2026.
- `blinkospace/blinko`: GPL-3.0, about 10k stars, useful ideas but not a clean
  copy/paste base for a separate product.
- `XuYouo/MeowNocode`: MIT, smaller project, useful Cloudflare/D1 precedent.

The practical goal is a Cloudflare-native Memos-compatible product, not a
generic note app that merely imports Memos data.

## Reference Summary

### MeowNocode

Useful Cloudflare-light reference, but not the product/protocol base.

Useful parts:

- React + Vite frontend with a compact memo input and recent-thought timeline.
- Existing Cloudflare D1 deployment story.
- D1 schema and Worker API examples for basic memo/settings CRUD.
- Local-first thinking: localStorage, export/import, backup/restore, delayed sync.
- Extra lightweight productivity ideas: heatmap, daily review, backlinks, canvas
  mode, public/private toggle.

Problems to avoid:

- The schema is too ad hoc for a durable product. Several structured fields
  are JSON text columns (`tags`, `backlinks`, `audio_clips`), and old/new worker
  schema variants diverge on `user_id`.
- Authentication is effectively password-gate style, not a proper multi-user
  identity model.
- Cloud sync is client-heavy and conflict handling is fragile.
- Too many secondary features are already mixed into the main page state.

Borrow as inspiration, not as the backend or ecosystem foundation.

### Blinko

Strong feature reference, too heavy to port directly.

Useful parts:

- AI-first note retrieval flow: normal search can escalate into AI/vector search.
- Attachment and note reference model.
- Note history, internal share, public share, archived/recycle flags.
- Rich editor behavior: draft persistence, file drop, references, quick capture,
  hotkeys, mobile/desktop variants.
- AI indexing pipeline: chunk note content, embed, mark indexed, rebuild index
  with progress tracking.

Problems to avoid:

- Backend is a Bun/Node service with Prisma + Postgres.
- The app model is broad: accounts, comments, follows, notifications, plugins,
  MCP servers, AI providers, conversations, scheduled tasks, fonts.
- Some infrastructure assumes filesystem or long-running workers.
- License is GPL-3.0, so do not copy code into a non-GPL product. Treat it as
  product and architecture reference only unless we intentionally accept GPL.

Borrow selectively: AI/search patterns, reference model, attachment UX, and
editor interaction ideas.

### Memos

Primary base for model, API, ecosystem, and migration compatibility.

Useful parts:

- Clean memo domain: `content`, `visibility`, `pinned`, `row_status`, creator,
  created/updated timestamps.
- `payload` stores computed metadata such as tags, link/task/code flags, title,
  and location without over-normalizing the first version.
- Separate tables for attachments, memo relations, shares, reactions, settings,
  identities.
- Timeline-first capture product philosophy.
- React Query cache strategy and optimistic update patterns.
- Mature markdown rendering, editor decomposition, filters, tags, stats, and
  share image flow.

Runtime problems to avoid:

- Go single-binary backend is not directly portable to Workers.
- Echo `http.Server`, `database/sql`, local SQLite/MySQL/Postgres drivers,
  filesystem file serving, SSE connection hub, and background runners do not map
  directly to Cloudflare's request/binding model.
- Multi-database abstraction and admin/server features add weight.

Borrow Memos' product model and public protocol aggressively, but replace the
runtime.

## Cloudflare-Native Product Boundary

The initial architecture should be a Worker-first full-stack app:

- One Worker serves static React/Vite assets and `/api/*`.
- D1 is the source of truth for notes, users, tags, settings, shares, and
  attachment metadata.
- R2 stores binary attachments, generated share images, import/export archives,
  and audio files.
- KV is only for cache/config/rate-limit/session-adjacent data where eventual
  consistency is acceptable.
- Durable Objects are not required for v1. Use them later only for live sync,
  collaborative editing, per-user queues, rate limiting, or WebSocket features.
- Queues/Cron can later handle embeddings, link previews, cleanup, and exports.
- Vectorize can hold semantic search vectors once AI search becomes real.

This keeps the first version within Cloudflare products and avoids maintaining
Docker/Postgres/Node services.

## Memos Compatibility Strategy

Compatibility should be a product feature, not a vague aspiration.

### Compatibility Tiers

Tier 0: Data compatibility.

- Use Memos-like tables and fields: users, user settings, memo, memo relations,
  attachments, shares, reactions where useful.
- Preserve Memos resource naming: `memos/{id}`, `users/{id}`,
  `attachments/{id}`.
- Store computed memo metadata in a `payload`/`property` shape compatible with
  Memos: tags, title, has_link, has_task_list, has_code,
  has_incomplete_tasks, location.
- Provide Memos import/export paths.

Tier 1: REST API subset compatibility.

- Implement high-value `/api/v1` endpoints from Memos:
  - `POST /api/v1/memos`
  - `GET /api/v1/memos`
  - `GET /api/v1/{name=memos/*}`
  - `PATCH /api/v1/{memo.name=memos/*}`
  - `DELETE /api/v1/{name=memos/*}`
  - `PATCH /api/v1/{name=memos/*}/attachments`
  - `GET /api/v1/{name=memos/*}/attachments`
  - `PATCH /api/v1/{name=memos/*}/relations`
  - `GET /api/v1/{name=memos/*}/relations`
  - `POST /api/v1/{parent=memos/*}/shares`
  - `GET /api/v1/shares/{share_id}`
  - `POST /api/v1/attachments`
  - `GET /api/v1/attachments`
  - `GET /api/v1/{name=attachments/*}`
  - `DELETE /api/v1/{name=attachments/*}`
- Support bearer tokens/personal access tokens enough for scripts and tools.
- Support common `page_size`, `page_token`, `order_by`, `state`, and simple
  filter cases.

Tier 2: Ecosystem compatibility.

- Generate or maintain an OpenAPI document for the supported subset.
- Expose an MCP endpoint shaped like Memos' OpenAPI-driven MCP tool catalog.
- Keep response fields compatible even when FlareMo's internal API is simpler.
- Add webhooks only after the core API is stable.

Tier 3: Full Memos parity.

- Not a v1 goal.
- Full parity would include Connect/gRPC semantics, broad CEL filtering,
  instance settings, SSO, notifications, webhooks, comments, reactions, admin
  surfaces, SSE, and edge cases from the Go server.

### API Split

Use two API layers:

- `/api/v1/*`: Memos-compatible public ecosystem API.
- `/api/app/*`: FlareMo-native frontend API, allowed to be simpler and optimized
  for the Cloudflare UI.

The Memos-compatible layer should call the same domain services as the native
layer. Do not maintain two separate business implementations.

### Porting Rule

The Memos source tree is a specification and component library, not a runtime
that can be deployed unchanged.

Good to port:

- SQL schema intent.
- API request/response field names.
- Resource naming.
- Markdown/tag/property extraction semantics.
- React editor/timeline/search/cache patterns.
- OpenAPI/MCP catalog shape.

Must rewrite:

- Go server lifecycle.
- Echo middleware and route registration.
- `database/sql` driver layer.
- File server and local filesystem attachment storage.
- S3 presign background runner.
- SSE hub and long-lived connection management.
- Migration runner around local SQLite/Postgres/MySQL.

## Suggested V1 Data Model

Use Memos as the durable shape, with a Cloudflare-friendly smaller scope:

```sql
users
  id TEXT PRIMARY KEY
  email TEXT UNIQUE
  name TEXT
  avatar_url TEXT
  created_at TEXT
  updated_at TEXT

notes
  id TEXT PRIMARY KEY
  user_id TEXT NOT NULL
  content TEXT NOT NULL
  visibility TEXT NOT NULL DEFAULT 'private'
  status TEXT NOT NULL DEFAULT 'normal'
  pinned INTEGER NOT NULL DEFAULT 0
  source TEXT DEFAULT 'web'
  payload TEXT NOT NULL DEFAULT '{}'
  created_at TEXT NOT NULL
  updated_at TEXT NOT NULL

note_relations
  note_id TEXT NOT NULL
  related_note_id TEXT NOT NULL
  type TEXT NOT NULL
  PRIMARY KEY (note_id, related_note_id, type)

attachments
  id TEXT PRIMARY KEY
  user_id TEXT NOT NULL
  note_id TEXT
  r2_key TEXT NOT NULL
  filename TEXT NOT NULL
  content_type TEXT
  size INTEGER NOT NULL DEFAULT 0
  payload TEXT NOT NULL DEFAULT '{}'
  created_at TEXT NOT NULL
  updated_at TEXT NOT NULL

shares
  id TEXT PRIMARY KEY
  note_id TEXT NOT NULL
  user_id TEXT NOT NULL
  token TEXT UNIQUE NOT NULL
  expires_at TEXT
  created_at TEXT NOT NULL

settings
  user_id TEXT NOT NULL
  key TEXT NOT NULL
  value TEXT NOT NULL
  PRIMARY KEY (user_id, key)
```

Put fast-changing derived metadata in `notes.payload`:

```json
{
  "tags": ["idea", "work"],
  "title": "",
  "hasLink": true,
  "hasTaskList": false,
  "hasCode": false,
  "clientId": "optional-offline-id"
}
```

Add normalized `tags` and `note_tags` only when tag management needs hierarchy,
aliases, colors, or per-tag settings.

## API Shape

Keep the native API small and typed:

- `GET /api/notes?cursor=&q=&tag=&visibility=&status=`
- `POST /api/notes`
- `GET /api/notes/:id`
- `PATCH /api/notes/:id`
- `DELETE /api/notes/:id` as soft archive/recycle first.
- `POST /api/notes/:id/attachments/presign` or direct Worker upload endpoint.
- `POST /api/shares`
- `GET /api/shares/:token`
- `GET /api/stats/activity`
- `GET/PATCH /api/settings/:key`

Use zod or similar validation at the Worker boundary. Use D1 prepared
statements, not string-built SQL.

For the Memos-compatible API, preserve Memos field names even when internal
tables use shorter names. Example: internal `created_at` maps to Memos
`create_time`; internal `status` maps to Memos `state`.

## Frontend Direction

The UI should take the product center from Flomo/Memos, not from a dashboard:

- First screen is capture + timeline.
- Capture box stays always available.
- Timeline cards are calm, readable, and fast to scan.
- Left rail: search, tags, shortcuts, activity stats.
- Right/detail panel later: backlinks, note metadata, shares, attachment info.
- Mobile: bottom or top compact nav, capture remains one tap away.

Borrow:

- MeowNocode: quick input, heatmap, daily review, canvas as optional later mode.
- Memos: editor decomposition, memo filters, React Query cache model, markdown
  rendering, activity calendar.
- Blinko: references UI, attachment handling, AI query entry point.

Avoid:

- Music/background decoration as core UX.
- Too many cards inside cards.
- Turning v1 into a social/collaboration platform.
- Shipping AI features before the capture/search loop is excellent.

## AI/Search Roadmap

V1:

- Plain full-text-ish search using D1 `LIKE` plus tag/date filters.
- Extract tags and computed flags on write.

V1.5:

- Add a `note_embeddings` metadata table and Vectorize index.
- Queue embedding jobs on note create/update.
- Search flow: normal text search first, optional AI semantic search button.

V2:

- Ask-your-notes chat.
- Attachment extraction for PDF/doc/text.
- Daily/weekly review generation.
- Suggested tags and related notes.

Blinko is the best conceptual reference for this, but its concrete
implementation assumes a heavier runtime.

## Initial Implementation Recommendation

Start from a Memos-first Cloudflare port, not a neutral scratch app:

1. Copy the Memos-compatible schema intent into D1 migrations.
2. Define a small domain service layer around users, memos, attachments,
   relations, shares, tokens, and settings.
3. Implement `/api/v1` Memos-compatible endpoints first for notes and
   attachments.
4. Implement `/api/app` only where the FlareMo frontend needs a simpler or
   more efficient shape.
5. Build a Flomo-like capture + timeline + search + tag frontend on top of the
   same service layer.
6. Add import/export for Memos data early.
7. Add R2 attachment storage.
8. Generate or maintain OpenAPI for the supported `/api/v1` subset.
9. Add MCP from that OpenAPI subset.
10. Add AI/Vectorize after the core Memos-compatible surface is stable.

The best reference weighting:

- Ecosystem/API/model: Memos.
- Product feel: Flomo-like, using selected Memos frontend discipline.
- Cloudflare deployment baseline: MeowNocode, but corrected and hardened.
- AI/RAG future: Blinko plus Memos-compatible extension points.

## Open Decisions

- Authentication: Cloudflare Access, email magic link, GitHub OAuth, or custom
  session. For a public product, do not use the MeowNocode shared password gate.
- Single-user vs multi-user: design the schema as multi-user now even if the
  first deployment is personal.
- License posture: avoid copying Blinko source unless GPL-3.0 compatibility is
  accepted.
- Whether to use Workers Static Assets only, or Pages + Functions. Worker-first
  is cleaner for one deployable unit.
