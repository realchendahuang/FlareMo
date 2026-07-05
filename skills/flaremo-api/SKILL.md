---
name: flaremo-api
description: Interact with a FlareMo instance (self-hosted, Cloudflare-native notes app behind Cloudflare Access) via its Memos-compatible REST API, curl, and the JSON-RPC MCP endpoint. Use when the user asks to create/list/get/update/delete memos on FlareMo, send requests to /api/v1/memos, or use the FlareMo MCP at /api/v1/mcp. Covers Service Token auth (CF-Access-Client-Id / CF-Access-Client-Secret headers), public bypass routes (/share/*, /api/public/shares/*, /assets/*), and a curl wrapper that injects the auth headers. Credentials are read from env vars (FLAREMO_URL, FLAREMO_ACCESS_CLIENT_ID, FLAREMO_ACCESS_CLIENT_SECRET) and are never embedded in the skill.
---

# FlareMo API

Interact with a FlareMo instance via its Memos-compatible REST API and JSON-RPC MCP endpoint. FlareMo runs on Cloudflare Workers behind Cloudflare Access; auth is a Service Token (two headers), not app-level Bearer tokens.

## Failure budget and human-in-the-loop

Stop after 2 failed attempts at the same action — report what you tried and the next alternatives, then wait.

## Prerequisites

Export three env vars (the skill never stores secrets):

```bash
export FLAREMO_URL="https://flaremo.<your-subdomain>.workers.dev"
export FLAREMO_ACCESS_CLIENT_ID="<service-token-client-id>"
export FLAREMO_ACCESS_CLIENT_SECRET="<service-token-secret>"
```

Get a Service Token from Cloudflare Zero Trust → Service Auth → Create. Public share routes (`/share/*`, `/api/public/shares/*`, `/assets/*`) bypass Access and need no token.

## Auth model

Every protected request needs both headers:

- `CF-Access-Client-Id: $FLAREMO_ACCESS_CLIENT_ID`
- `CF-Access-Client-Secret: $FLAREMO_ACCESS_CLIENT_SECRET`

Without them, FlareMo returns 302 → Cloudflare Access login. With them, `/api/v1/*` returns JSON.

## Wrapper script

Use `scripts/flaremo_curl.sh` to avoid retyping the headers:

```bash
./scripts/flaremo_curl.sh /api/v1/memos                                # GET list
./scripts/flaremo_curl.sh -X POST /api/v1/memos -d '{"content":"hi"}'  # create
./scripts/flaremo_curl.sh --dry-run /api/v1/memos                      # print, don't run
```

It errors if any env var is missing. `--dry-run` prints the target URL and flags (secret redacted) instead of executing.

## REST — memos CRUD

```bash
# list
./scripts/flaremo_curl.sh /api/v1/memos
# create
./scripts/flaremo_curl.sh -X POST /api/v1/memos \
  -H 'Content-Type: application/json' -d '{"content":"Hello #memo"}'
# get
./scripts/flaremo_curl.sh /api/v1/memos/<id>
# update
./scripts/flaremo_curl.sh -X PATCH /api/v1/memos/<id> \
  -H 'Content-Type: application/json' -d '{"content":"edited"}'
# delete
./scripts/flaremo_curl.sh -X DELETE /api/v1/memos/<id>
```

Create returns 201; list returns `{"memos":[...]}`. Attachments, shares, relations, and import/export exist on `/api/v1/*` — see [references/endpoints.md](./references/endpoints.md) for the catalog.

## MCP — JSON-RPC at /api/v1/mcp

FlareMo exposes an MCP endpoint (HTTP JSON-RPC, not a native pi MCP server). Call it with the same two Access headers:

```bash
# list tools
./scripts/flaremo_curl.sh /api/v1/mcp -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
# create a memo via MCP
./scripts/flaremo_curl.sh /api/v1/mcp -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create_memo","arguments":{"content":"via MCP"}}}'
```

`tools/list` returns `list_memos`, `create_memo`, `get_memo`, `search_memos`. `create_memo` takes `content` (required) plus optional `visibility` (`private|protected|public`) and `source`. To register this as a native pi MCP server, add it to `~/.pi/agent/mcp.json` (HTTP transport + the two Access headers) — ask the user first (pi config write).

## Quirks

- `/openapi.json` returns HTML (SPA fallback), not JSON. Use `/api/v1/openapi.json` if present, or the repo's `packages/contracts/src/openapi.ts` for the schema.
- The MCP endpoint is JSON-RPC over POST; a plain `GET /api/v1/mcp` may 404.

## Related docs

- [Setup guide](../../docs/setup-guide/) — step-by-step install & deploy
- [FAQ](../../faq/) — [multi-user access](../../faq/can-i-allow-other-users.md), [agent access](../../faq/does-the-agent-have-access.md)