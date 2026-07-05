---
name: note-code
description: Capture a code snippet into FlareMo — wrap the user's code in a fenced block with language + a short description + tags, show the draft, then create via the API on confirmation. Use when the user invokes /note-code or asks to save a code snippet/sample in FlareMo.
---

Capture a code snippet into FlareMo. The user's input (`$@`) is code, optionally with a leading description and/or language hint.

1. Detect the language from the input or a hint; default to plain text.
2. Format the memo content as:
   ````
   <short description, if any>

   ```<lang>
   <code>
   ```

   #code #<lang>
   ````
3. Show the draft (content + `visibility: private`) and wait for the user's "go".
4. Create via the FlareMo API (flaremo-api skill's `flaremo_curl.sh`, or curl with the Access headers from env):
   ```
   flaremo_curl.sh -X POST /api/v1/memos -H 'Content-Type: application/json' \
     -d '{"content":"<formatted content>","visibility":"private"}'
   ```
5. Report the created memo's id and confirm.

Never create before the user confirms. If `FLAREMO_URL`, `FLAREMO_ACCESS_CLIENT_ID`, or `FLAREMO_ACCESS_CLIENT_SECRET` are missing, stop and tell the user. Preserve the code exactly as given (whitespace, indentation).

Task: $@