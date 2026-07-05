# FlareMo API endpoint catalog

Compact reference for `/api/v1/*` (Memos-compatible subset). All routes are **protected** unless marked *public*. Auth: two headers `CF-Access-Client-Id` + `CF-Access-Client-Secret`.

> Memos `list` + `create` + `delete` tested live (REST + MCP, 2026-07). `get`/`update` follow the same `/api/v1/memos/{id}` pattern. Other endpoints (attachments, relations, shares, import/export) are Memos-compatible; verify exact field names against `packages/contracts/src/openapi.ts` and the route definitions in `apps/worker/src/` before relying on them.

## Memos

`{id}` is a UUID (e.g. `a139dcb8-ab36-41fe-8d64-7b1849fa1145`); the response `name` is `memos/<uuid>`. Both `/api/v1/memos/<uuid>` and `/api/v1/<name>` work as paths.

- `GET /api/v1/memos` — list (query: `creatorId`, `rowStatus`, `visibility`, `pinned`, `tag`, `limit`, `offset`)
- `POST /api/v1/memos` — create; body `{"content":"...","visibility":"private|protected|public"}`; returns **201** + the created memo
- `GET /api/v1/memos/{id}` — get
- `PATCH /api/v1/memos/{id}` — update
- `DELETE /api/v1/memos/{id}` — **soft-delete**; returns 200 with `state:"trashed"` (purge is a separate step)

## Attachments (R2-backed) — verify

- `GET /api/v1/attachments` — list
- `POST /api/v1/attachments` — upload (multipart)
- `GET /api/v1/attachments/{id}` — metadata
- `GET /api/v1/attachments/{id}/content` — bytes

## Relations — verify

- `GET /api/v1/memos/{id}/relations`
- `POST /api/v1/memos/{id}/relations`

## Shares

- `POST /api/v1/memos/{id}/shares` — create a share link
- `GET /api/v1/shares` — list
- `GET /api/v1/shares/{id}`

## Import / export — verify

- `POST /api/v1/memos:import` — Memos-style import
- `POST /api/v1/memos:export` — export bundle

## Public bypass (no token)

- `GET /share/{name}` — public share page (HTML)
- `GET /api/public/shares/{name}` — public share JSON (404 if not found)
- `GET /assets/*` — static assets

## OpenAPI / discovery

- `/openapi.json` returns HTML (SPA fallback), not JSON.
- Try `/api/v1/openapi.json`, or read the repo's `packages/contracts/src/openapi.ts` for the authoritative schema.

## MCP

- `POST /api/v1/mcp` — JSON-RPC.
- Methods: `tools/list`, `tools/call` with `params.name` ∈ `list_memos`, `create_memo`, `get_memo`, `search_memos` (call `tools/list` to enumerate). `create_memo` takes `content` + optional `visibility` (`private|protected|public`) and `source`.
