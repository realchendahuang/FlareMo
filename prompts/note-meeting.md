---
name: note-meeting
description: Capture a meeting note into FlareMo — structure the user's raw notes into a meeting memo (topic, attendees, notes, action items), show the draft, then create via the API on confirmation. Use when the user invokes /note-meeting or asks to save meeting notes in FlareMo.
---

Capture a meeting note into FlareMo. The user's input (`$@`) is raw meeting notes; infer structure, don't invent facts.

1. Format the memo content as:
   ```
   ## <meeting topic — infer from input, or "Meeting">
   Attendees: <from input, or "—">
   Notes:
   - <key points from input>
   Action items:
   - [ ] <action — only if clearly stated in input>
   #meeting
   ```
2. Show the draft (content + `visibility: private`) and wait for the user's "go".
3. Create via the FlareMo API (flaremo-api skill's `flaremo_curl.sh`, or curl with the Access headers from env):
   ```
   flaremo_curl.sh -X POST /api/v1/memos -H 'Content-Type: application/json' \
     -d '{"content":"<formatted content>","visibility":"private"}'
   ```
4. Report the created memo's id and confirm.

Keep the memo content to 215 lines max by default; if the input is longer, ask the user whether to split, summarize, or truncate before creating.

Never create before the user confirms. If `FLAREMO_URL`, `FLAREMO_ACCESS_CLIENT_ID`, or `FLAREMO_ACCESS_CLIENT_SECRET` are missing, stop and tell the user. Don't fabricate attendees or actions not in the input.

Task: $@