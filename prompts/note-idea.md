---
name: note-idea
description: Capture an idea/sketch into FlareMo — format the user's raw idea as an idea memo (one-line summary, elaboration, optional next steps), show the draft, then create via the API on confirmation. Use when the user invokes /note-idea or asks to save an idea/sketch/thought in FlareMo.
---

Capture an idea/sketch into FlareMo. The user's input (`$@`) is a raw idea; distill it, don't invent.

1. Format the memo content as:
   ```
   💡 <one-line summary of the idea>
   <elaboration from the input, if any>
   Next steps:
   - <only if clearly stated in the input>
   #idea
   ```
2. Show the draft (content + `visibility: private`) and wait for the user's "go".
3. Create via the FlareMo API (flaremo-api skill's `flaremo_curl.sh`, or curl with the Access headers from env):
   ```
   flaremo_curl.sh -X POST /api/v1/memos -H 'Content-Type: application/json' \
     -d '{"content":"<formatted content>","visibility":"private"}'
   ```
4. Report the created memo's id and confirm.

Keep the memo content to 215 lines max by default; if the input is longer, ask the user whether to split, summarize, or truncate before creating.

Never create before the user confirms. If `FLAREMO_URL`, `FLAREMO_ACCESS_CLIENT_ID`, or `FLAREMO_ACCESS_CLIENT_SECRET` are missing, stop and tell the user. Don't fabricate next steps not in the input.

Task: $@