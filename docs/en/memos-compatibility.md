# Memos Compatibility Matrix

FlareMo is a Cloudflare-native personal knowledge system with a Memos-compatible adapter, not a fork of the Memos Go server. The default `/api/v1` wire is a current Memos-style camelCase / protobuf-JSON subset. The previous FlareMo snake_case wire remains available through an explicit legacy header, and the root `/mcp` endpoint provides a stateless Streamable HTTP MCP subset.

This is an interoperability boundary, not a claim of complete Memos Server parity. Repository contract tests prove FlareMo's own surface; they do not replace real smoke tests against Memos clients. See the [ecosystem matrix](../memos-ecosystem.md) for third-party verification status.

## Wire negotiation

| Wire | Selection | Meaning |
| --- | --- | --- |
| current (default) | No header, or `X-FlareMo-Wire: current` | camelCase fields, uppercase protobuf-style enums, and current standard errors. |
| legacy | `X-FlareMo-Wire: legacy`, or `Accept: application/vnd.flaremo.legacy+json` | Existing FlareMo snake_case responses for older scripts and clients. |

Resource names remain Memos-shaped, such as `memos/{id}`, `attachments/{id}`, and `users/{id}`. `GET /openapi.json` returns the current OpenAPI document by default; the explicit legacy wire returns the legacy document.

## Authentication boundary

Better Auth is the application authentication source of truth. Cloudflare Access is optional outer policy and does not map an Access identity to a FlareMo application user.

| Surface | Authentication | Compatibility note |
| --- | --- | --- |
| Web / Better Auth | Username/password followed by an `HttpOnly` cookie session | Single-user bootstrap is the current product mode; public signup is disabled while the data model leaves a future user-mapping boundary. |
| Current auth facade | `POST /api/v1/auth/signin`, `refresh`, `signout`, and `GET /api/v1/auth/me` | Backed by Better Auth session/account data. `accessToken` is an opaque session-backed token, not a native Memos JWT. |
| Private `/api/v1/*` | Cookie session or `Authorization: Bearer memos_pat_...` | PATs are created by an authenticated account, shown only at creation, revocable, and stored through the Better Auth API-key boundary. |
| Current PAT resources | `/api/v1/users/{user}/personalAccessTokens` | Current user's list/create/revoke subset; not native Memos JWT/refresh-token parity. |
| Root `/mcp` | Cookie session, Better Auth session bearer, or `memos_pat_` PAT | Stateless JSON response subset; it does not create an MCP session. |
| Origin policy | Cookie-session mutations require an exact `FLAREMO_PUBLIC_URL` / `FLAREMO_TRUSTED_ORIGINS` Origin; PAT may omit Origin but a supplied Origin must match | Missing or untrusted Origin returns `403`; Access headers are not a substitute. |
| Cloudflare Access | Optional outer policy / Service Auth | Access only gates the network edge; the application still needs the cookie, session bearer, or PAT above. |

## Implemented current subset

| Capability | Status | Current surface / note |
| --- | --- | --- |
| Current user | Implemented | `GET /api/v1/auth/me`, `GET /api/v1/users`, and `GET /api/v1/users/{user}`. |
| Better Auth sign-in facade | Implemented subset | `POST /api/v1/auth/signin`, `POST /api/v1/auth/refresh`, and `POST /api/v1/auth/signout`; returns a Better Auth-backed opaque token. |
| Create/list memos | Implemented subset | `POST /api/v1/memos` and `GET /api/v1/memos`; supports `pageSize`, `pageToken`, limited `orderBy`, and a limited filter subset. |
| Get/update/delete memo | Implemented subset | `GET/PATCH/DELETE /api/v1/memos/{memo}`; supports the current `{ memo: {...} }` wrapper and `updateMask`; `memoId` is explicitly rejected. |
| Memo state and visibility | Mapped subset | `NORMAL`, `ARCHIVED`, `PRIVATE`, `PROTECTED`, and `PUBLIC`; FlareMo trash/deleted semantics do not exactly match the current Memos state model. |
| Memo fields | Implemented subset | `tags`, `property`, `location`, `snippet`, and core field mapping. |
| Memo attachments | Implemented subset | `GET/PATCH /api/v1/memos/{memo}/attachments`; PATCH is primarily memo attachment-set replacement, not full Attachment update parity. |
| Memo relations | Implemented subset | `GET/PATCH /api/v1/memos/{memo}/relations` with nested `memo` / `relatedMemo` DTOs and current relation enums. |
| Memo shares | Implemented subset | `GET/POST /api/v1/memos/{memo}/shares` and `DELETE /api/v1/memos/{memo}/shares/{share}`; current share names use `memos/{id}/shares/{token}`. |
| Anonymous share read | Implemented | `GET /api/v1/shares/{share_id}`, still guarded by share token, expiry, and memo state. |
| Attachment resources | Implemented subset | `GET/POST /api/v1/attachments` and `GET/PATCH/DELETE /api/v1/attachments/{attachment}`; supports the current `{ attachment: {...} }` wrapper and explicitly rejects `attachmentId`. |
| Attachment list | Implemented subset | Returns `attachments` and an optional `nextPageToken`; protobuf JSON `size` is emitted as a decimal string. |
| PAT resources | Implemented foundation | `GET/POST /api/v1/users/{user}/personalAccessTokens` and `DELETE /api/v1/users/{user}/personalAccessTokens/{token}`. |
| Standard errors | Implemented | Current errors use `{ code, message, details }` rather than exposing internal FlareMo exceptions. |
| Current OpenAPI | Implemented | `GET /openapi.json`, and authenticated `GET /api/v1/openapi.json`, describe current/legacy negotiation, auth, and `/mcp`. |

### Limited filter and ordering support

The adapter does not interpret arbitrary CEL on Workers. The tested subset accepts expressions such as:

```text
content.contains("...")
tags.exists(t, t == "...")
pinned == true
visibility == "PUBLIC"
```

`orderBy` currently accepts only a single `create_time` or `update_time` field with `asc` or `desc`. Unsupported filters and orderings return a current standard error instead of silently changing the query semantics.

### Root `/mcp`

`POST /mcp` is a stateless JSON Streamable HTTP MCP subset. It negotiates protocol versions `2025-03-26` and `2024-11-05` and supports:

- `initialize`
- `notifications/initialized`
- `tools/list`
- `tools/call`

The current tool names use `memo_`, `attachment_`, and `auth_` prefixes and cover memo CRUD, memo attachments, memo relations, attachment list/get/delete, and the current user. Successful calls provide both text content and object-shaped `structuredContent`; tool failures remain in the MCP result with `isError: true`.

The endpoint is currently stateless JSON. SSE, MCP session state, the complete method surface, and every third-party MCP client's behavior are not promised. The older `POST /api/v1/mcp` JSON-RPC tool names remain available for existing FlareMo clients.

## Not complete or not verified

Do not describe the following as complete compatibility:

- Complete Memos Server parity or complete Connect/gRPC parity.
- Full CEL, complex pagination/ordering, or complete attachment filter/order/page-token semantics.
- Current attachment batch delete or Attachment updates beyond the memo-binding subset.
- Memos comments, reactions, shortcuts, notifications, admin/instance surfaces.
- SSE and stateful MCP sessions.
- Native Memos JWT/refresh-token and byte-level auth parity; FlareMo `accessToken` is an opaque Better Auth session-backed token.
- Real smoke tests for the official Memos client, MemoFlow, Dynos, Raycast, browser extensions, or other third-party clients.
- Cloudflare Access policy correctness; Access is a deployment-layer policy, not the FlareMo application protocol.

## Compatibility test policy

Every expanded compatibility promise needs tests for:

- DTO mapping, uppercase current enums, and standard errors.
- Resource-name parsing and nested relation/share DTOs.
- Pagination, limited ordering, and rejection of unsupported filters.
- Import/export roundtrips.
- Attachment upload, listing, binding, and download.
- Share-token isolation and anonymous reads.
- Current/legacy OpenAPI negotiation.
- Better Auth cookie, session bearer, PAT bearer, PAT revocation, and public-share boundaries.
- `/mcp` initialize, tools/list, tools/call, and tool-error envelopes.

These tests prove FlareMo's own contract, not third-party client compatibility. Untested clients stay untested until a real connection, version, date, and result are recorded in the [ecosystem matrix](../memos-ecosystem.md).
