# Memos Compatibility Matrix

FlareMo is a Cloudflare-native personal knowledge system with a Memos-compatible adapter, not a fork of the Memos Go server. The default `/api/v1` wire is a current Memos-style camelCase / protobuf-JSON subset. The previous FlareMo snake_case wire remains available through an explicit legacy header, and the root `/mcp` endpoint provides a stateless Streamable HTTP MCP subset. The pinned official Memos generated Connect client has completed an isolated binary-unary smoke against a local Wrangler Worker and an anonymous `ListMemos` binary smoke against the production domain; this is not complete Memos Server parity or proof that the official Web and third-party clients work in production.

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
| Current auth facade | `POST /api/v1/auth/signin`, `refresh`, `signout`, and `GET /api/v1/auth/me` | Better Auth remains the identity/account source of truth. Sign-in returns an HS256 Memos-style access JWT and sets the rotating `memos_refresh` HttpOnly cookie; legacy Better Auth session bearers remain accepted. |
| Private `/api/v1/*` | Cookie session or `Authorization: Bearer memos_pat_...` | PATs are created by an authenticated account, shown only at creation, revocable, and stored through the Better Auth API-key boundary. |
| Current PAT resources | `/api/v1/users/{user}/personalAccessTokens` | Current user's list/create/revoke subset. PATs and native JWTs are separate, explicit application credentials. |
| Root `/mcp` | Cookie session, Better Auth session bearer, or `memos_pat_` PAT | Stateless JSON response subset; it does not create an MCP session. |
| Origin policy | Cookie-session mutations require an exact `FLAREMO_PUBLIC_URL` / `FLAREMO_TRUSTED_ORIGINS` Origin; PAT may omit Origin but a supplied Origin must match | Missing or untrusted Origin returns `403`; Access headers are not a substitute. |
| Cloudflare Access | Optional outer policy / Service Auth | Access only gates the network edge; the application still needs the cookie, session bearer, or PAT above. |

## Implemented current subset

| Capability | Status | Current surface / note |
| --- | --- | --- |
| Current user | Implemented | `GET /api/v1/auth/me`, `GET /api/v1/users`, and `GET /api/v1/users/{user}`. |
| Better Auth / native Memos auth facade | Implemented subset | `POST /api/v1/auth/signin`, `POST /api/v1/auth/refresh`, and `POST /api/v1/auth/signout`; Better Auth owns identity, while the facade returns an `iss=memos`, `aud=user.access-token` HS256 access JWT and rotates the `memos_refresh` cookie. |
| Create/list memos | Implemented subset | `POST /api/v1/memos` and `GET /api/v1/memos`; supports `pageSize`, `pageToken`, limited `orderBy`, and a limited filter subset. |
| Get/update/delete memo | Implemented subset | `GET/PATCH/DELETE /api/v1/memos/{memo}`; supports the current `{ memo: {...} }` wrapper and `updateMask`; `memoId` is explicitly rejected. |
| Memo state and visibility | Mapped subset | `NORMAL`, `ARCHIVED`, `PRIVATE`, `PROTECTED`, and `PUBLIC`; FlareMo trash/deleted semantics do not exactly match the current Memos state model. |
| Memo fields | Implemented subset | `tags`, `property`, `location`, `snippet`, and core field mapping. |
| Memo attachments | Implemented subset | `GET/PATCH /api/v1/memos/{memo}/attachments`; PATCH is primarily memo attachment-set replacement, not full Attachment update parity. |
| Memo relations | Implemented subset | `GET/PATCH /api/v1/memos/{memo}/relations` with nested `memo` / `relatedMemo` DTOs and current relation enums. |
| Memo comments | Implemented subset | `GET/POST /api/v1/memos/{memo}/comments`; a comment is a memo with a `COMMENT` relation and current camelCase memo DTO. |
| Memo reactions | Implemented subset | `GET/POST /api/v1/memos/{memo}/reactions` and `DELETE /api/v1/memos/{memo}/reactions/{reaction}`; upsert uniqueness is creator/content/type. |
| Shortcuts | Implemented subset | `GET/POST /api/v1/users/{user}/shortcuts` and `GET/PATCH/DELETE /api/v1/users/{user}/shortcuts/{shortcut}`; supports CEL validation, `validateOnly`, and `updateMask`. |
| UserService webhooks and notifications | Implemented subset | `List/Create/Update/DeleteUserWebhook`, `GetUserWebhookSigningSecret`, and `List/Update/DeleteUserNotification` are current-user resources. Comment/mention notification payloads and a bounded D1 outbox with retries for four memo webhook events are wired; complete upstream webhook event/egress semantics, full notification filtering, and multi-user ACL are not complete. |
| Memo shares | Implemented subset | `GET/POST /api/v1/memos/{memo}/shares` and `DELETE /api/v1/memos/{memo}/shares/{share}`; current share names use `memos/{id}/shares/{token}`. |
| Anonymous share read | Implemented | `GET /api/v1/shares/{share_id}`, still guarded by share token, expiry, and memo state. |
| Attachment resources | Implemented subset | `GET/POST /api/v1/attachments` and `GET/PATCH/DELETE /api/v1/attachments/{attachment}`; supports the current `{ attachment: {...} }` wrapper and explicitly rejects `attachmentId`. The official Memos Web `/file/attachments/{id}/{filename}` private/share read bridge is also implemented; arbitrary `externalLink` persistence, thumbnails, and motion conversion are not. |
| Attachment list | Implemented subset | Connect `ListAttachments` returns `attachments`, `totalSize`, and an optional `nextPageToken`; it supports bounded `create_time`/`filename` ordering and filename/mime/memo filters. Protobuf JSON `size` is emitted as a decimal string. |
| PAT resources | Implemented foundation | `GET/POST /api/v1/users/{user}/personalAccessTokens` and `DELETE /api/v1/users/{user}/personalAccessTokens/{token}`. |
| Standard errors | Implemented | Current errors use `{ code, message, details }` rather than exposing internal FlareMo exceptions. |
| Current OpenAPI | Implemented | `GET /openapi.json`, and authenticated `GET /api/v1/openapi.json`, describe current/legacy negotiation, native JWT/refresh cookie, social routes, SSE, the Connect JSON subset, and `/mcp`. |

### Limited filter and ordering support

The adapter does not interpret arbitrary CEL on Workers. The tested subset accepts expressions such as:

```text
content.contains("...")
tags.exists(t, t == "...")
pinned == true
visibility == "PUBLIC"
size(content) > 100
created_ts.getFullYear() == 2026
created_ts >= timestamp(1704067200)
updated_ts < now - duration("1h")
```

The tested surface also includes `size(content)`, `size(tags)`, the pinned upstream timestamp accessors without timezone arguments, integer Unix timestamps, and `now`/`duration` arithmetic. `orderBy` currently accepts only a single `create_time` or `update_time` field with `asc` or `desc`. Unsupported filters and orderings return a current standard error instead of silently changing the query semantics.

### Root `/mcp`

`POST /mcp` is a stateless JSON Streamable HTTP MCP subset. It negotiates protocol versions `2025-03-26` and `2024-11-05` and supports:

- `initialize`
- `notifications/initialized`
- `tools/list`
- `tools/call`

The current tool names use `memo_`, `attachment_`, `shortcut_`, and `auth_` prefixes and cover memo CRUD, attachments, relations, comments, reactions, shortcuts, attachment list/get/delete, and the current user. Successful calls provide both text content and object-shaped `structuredContent`; tool failures remain in the MCP result with `isError: true`.

### Connect JSON and SSE

The Worker also exposes the canonical `memos.api.v1/{Service}/{Method}` HTTP unary adapter for the documented service subset. It accepts Connect JSON plus `application/proto`, `application/grpc`, `application/grpc+proto`, `application/grpc-web`, `application/grpc-web+proto`, `application/grpc-web-text`, and `application/grpc-web-text+proto`. Ordinary upstream methods use the pinned generated descriptors in `apps/worker/src/memos-generated/` and `@bufbuild/protobuf`; the hand-written codec remains only for the historical `GetSharedMemo` alias and error/status framing. gRPC-Web unary responses now include a standard data frame followed by a trailer frame, and gRPC-Web application errors use a trailers-only frame. This still does not provide native HTTP/2 gRPC, complete metadata/trailers, compression, streaming, or full Memos service/schema parity.

The pinned official generated-client smoke used the `Temp/memos` commit `daa71d0456d07a25ff5ea435e46577d31d030728`, `@bufbuild/protobuf@2.12.0`, `@connectrpc/connect@2.1.1`, `@connectrpc/connect-web@2.1.1`, and `useBinaryFormat: true` against `http://127.0.0.1:18787`. The current executable test directly decodes a limited `MemoService` Connect/gRPC-Web binary subset and a limited `UserService` webhook/notification subset. Other services have Worker transport/codec contract coverage, but are not current generated-client smoke evidence. A separate production smoke used the same generated client for anonymous `MemoService/ListMemos` only. Neither result is an official-Web full smoke or complete Memos Server parity evidence.

`GET /api/v1/sse` provides an authenticated `text/event-stream` handshake, a D1-backed mutation outbox, five-second polling, numeric `Last-Event-ID` replay, connection comments, a 30-second heartbeat, visibility filtering, and abort/cancel handling. Comment-created events identify the parent memo in `name`, matching the pinned upstream Memos behavior; relation and attachment-binding mutations atomically append `memo.updated` outbox events. It does not provide the upstream in-process SSEHub, complete event retention/stream semantics, or a third-party EventSource smoke.

The root MCP endpoint remains a stateless JSON Streamable HTTP subset. MCP session state, SSE MCP transport, the complete method surface, and every third-party MCP client's behavior are not promised. The older `POST /api/v1/mcp` JSON-RPC tool names remain available for existing FlareMo clients.

## Not complete or not verified

Do not describe the following as complete compatibility:

- Complete Memos Server parity or complete Connect/gRPC parity.
- Full CEL/SQL-rendering parity, complex pagination/ordering, or complete attachment filter/order/page-token semantics; the current CEL implementation is a bounded Worker-side evaluator and attachment list support is a bounded subset.
- The Memos Web `/file/attachments/{id}/{filename}` bridge supports private Better Auth/PAT/native-JWT reads and `share_token`-scoped public reads. `thumbnail=true` currently returns the original object; motion-media conversion and arbitrary `externalLink` persistence are not implemented.
- Current attachment batch delete or Attachment updates beyond the memo-binding subset.
- Complete upstream service/wire parity for comments, reactions, shortcuts, notifications, and admin/instance surfaces. FlareMo now has bounded UserService webhook and notification resource lifecycles, including comment/mention payloads and a D1 outbox with retries for four memo webhook events, but complete upstream webhook event/egress semantics, full notification filtering, and multi-user notification ACL are not complete.
- A complete SSE event hub/replay protocol and stateful MCP sessions.
- Byte-level/version-level native Memos JWT/refresh-token parity; the current implementation only verifies FlareMo's own HS256 claims, rotation, and revocation behavior.
- Uncovered Memos services, native HTTP/2 gRPC, complete gRPC-Web metadata behavior, compression, and streaming. The unary gRPC-Web data/trailer frame contract is covered locally, but not yet by an official browser transport or third-party client smoke.
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
- Native JWT headers/claims, refresh-cookie attributes and reuse rejection, Connect JSON transport, and SSE handshake/cancel behavior.
- Unary gRPC-Web data/trailer framing and trailers-only application errors.

These tests prove FlareMo's own contract, not third-party client compatibility. Untested clients stay untested until a real connection, version, date, and result are recorded in the [ecosystem matrix](../memos-ecosystem.md).
