#!/usr/bin/env bash
# flaremo_curl.sh — curl wrapper that injects FlareMo Cloudflare Access Service Token headers.
# Reads FLAREMO_URL, FLAREMO_ACCESS_CLIENT_ID, FLAREMO_ACCESS_CLIENT_SECRET from env.
#
# Usage:
#   flaremo_curl.sh [--dry-run] <curl-flags> <path>
#   flaremo_curl.sh /api/v1/memos
#   flaremo_curl.sh -X POST /api/v1/memos -H 'Content-Type: application/json' -d '{"content":"hi"}'
#   flaremo_curl.sh --dry-run /api/v1/memos
#
# The first argument starting with "/" is treated as the request path (appended to FLAREMO_URL).
# All other args are passed through to curl.
set -euo pipefail

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
  shift
fi

: "${FLAREMO_URL:?FLAREMO_URL must be set (e.g. https://flaremo.<subdomain>.workers.dev)}"
: "${FLAREMO_ACCESS_CLIENT_ID:?FLAREMO_ACCESS_CLIENT_ID must be set (Cloudflare Access service token client id)}"
: "${FLAREMO_ACCESS_CLIENT_SECRET:?FLAREMO_ACCESS_CLIENT_SECRET must be set (Cloudflare Access service token secret)}"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 [--dry-run] <curl-flags> <path>" >&2
  echo "  e.g. $0 /api/v1/memos" >&2
  exit 2
fi

# Split args: the first one starting with "/" is the path; the rest go to curl.
PATH_ARG=""
CURL_ARGS=()
while [[ $# -gt 0 ]]; do
  arg="$1"; shift
  if [[ -z "$PATH_ARG" && "$arg" == /* ]]; then
    PATH_ARG="$arg"
  else
    CURL_ARGS+=("$arg")
  fi
done

if [[ -z "$PATH_ARG" ]]; then
  echo "Error: no path argument found (must start with /)." >&2
  exit 2
fi

if [[ $DRY_RUN -eq 1 ]]; then
  echo "DRY-RUN → ${FLAREMO_URL}${PATH_ARG}"
  echo "  curl args: ${CURL_ARGS[*]:-<none>}"
  echo "  headers: CF-Access-Client-Id=<set>, CF-Access-Client-Secret=<set>"
  exit 0
fi

exec curl -sS \
  -H "CF-Access-Client-Id: $FLAREMO_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $FLAREMO_ACCESS_CLIENT_SECRET" \
  "${CURL_ARGS[@]}" \
  "${FLAREMO_URL}${PATH_ARG}"