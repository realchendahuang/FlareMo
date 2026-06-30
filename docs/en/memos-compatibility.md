# Memos Compatibility Matrix

FlareMo is Memos-compatible, not a Memos server fork. The goal is to reuse common clients, scripts, import/export flows, OpenAPI, and MCP tools while keeping the implementation Cloudflare-native.

## Supported

| Capability | Status | Notes |
| --- | --- | --- |
| memo resource name | Supported | `memos/{id}`. |
| attachment resource name | Supported | `attachments/{id}`. |
| share resource name | Supported | `shares/{token}`. |
| create memo | Supported | `POST /api/v1/memos`. |
| list memos | Supported | `GET /api/v1/memos`. |
| get memo | Supported | `GET /api/v1/{name=memos/*}`. |
| update memo | Supported | `PATCH /api/v1/{memo.name=memos/*}`. |
| delete memo | Supported | `DELETE /api/v1/{name=memos/*}` moves to trash by default. |
| tag filter | Supported | `GET /api/v1/memos?tag=<tag>`. |
| state filter | Supported | `normal`, `archived`, `trashed`. |
| pagination | Supported | `page_size`, `page_token`. |
| ordering | Supported | `order_by` subset. |
| upload attachment | Supported | `POST /api/v1/attachments`. |
| bind memo attachments | Supported | `PATCH /api/v1/{name=memos/*}/attachments`. |
| download attachment | Supported | `GET /api/v1/{name=attachments/*}/blob`. |
| memo relations | Supported | `GET/PATCH /api/v1/{name=memos/*}/relations`. |
| share | Supported | `POST /api/v1/{parent=memos/*}/shares`. |
| public share read | Supported | `GET /api/public/shares/{token}`. |
| export | Supported | `GET /api/v1/export`. |
| import | Supported | `POST /api/v1/import`. |
| OpenAPI | Supported | `GET /openapi.json`. |
| MCP | Supported | `POST /api/v1/mcp`. |

## Not Promised

These are not current compatibility goals unless they directly serve FlareMo:

- Memos Go server internals.
- Connect/gRPC.
- Full CEL filter parity.
- Instance admin surface.
- Multi-user social features, comments, reactions, notifications.
- SSE.
- Memos-native auth, SSO, and login flows.
- Original database abstraction and local filesystem behavior.

## Compatibility Test Policy

Every expanded compatibility promise needs tests for:

- DTO field mapping.
- Resource name parser.
- Pagination and ordering.
- Import/export roundtrip.
- Attachment upload and download.
- Share token isolation.
- OpenAPI schema.
- MCP tool calls.

For real clients, use [../memos-ecosystem.md](../memos-ecosystem.md). A client that cannot send Cloudflare Access Service Token headers may be API-compatible but still unusable against a protected production FlareMo instance.

Third-party clients must only be marked as supported after a real FlareMo connection test. Untested clients stay in the candidate matrix as untested.
