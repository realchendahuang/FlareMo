---
name: note-link
description: Capture a link/bookmark note into FlareMo — format the user's URL + optional comment as a bookmark memo, show the draft, then create via the API on confirmation. Use when the user invokes /note-link or asks to save a link/url/bookmark in FlareMo.
---

Capture a link/bookmark into FlareMo. The user's input (`$@`) is a URL plus an optional comment.

1. Format the memo content exactly as:
   ```
   🔗 <url>
   <user's comment, if any>
   #link #bookmark
   ```
2. Show the draft (content + tags + `visibility: private`) and wait for the user's "go".
3. Create via the FlareMo API (use the flaremo-api skill's `flaremo_curl.sh`, or fall back to curl with `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers from env):
   ```
   flaremo_curl.sh -X POST /api/v1/memos -H 'Content-Type: application/json' \
     -d '{"content":"<formatted content>","visibility":"private"}'
   ```
4. Report the created memo's id and confirm.

Never create before the user confirms. If `FLAREMO_URL`, `FLAREMO_ACCESS_CLIENT_ID`, or `FLAREMO_ACCESS_CLIENT_SECRET` are missing, stop and tell the user.

Task: $@