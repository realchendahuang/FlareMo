# Moving from Memos to FlareMo

A Memos export (0.31 and later) is a ZIP archive: a manifest, one JSON record
per memo, the memo bodies as Markdown, and the attachment bytes. FlareMo's
import takes a single JSON bundle, so the archive needs one conversion step.
The repository ships a converter that needs nothing beyond Node.js 20+.

## Steps

1. **Export from Memos**: Settings → Data → Export, and download
   `memos-export-*.zip`.
2. **Convert**:

   ```bash
   node scripts/migrate-memos-export.mjs ~/Downloads/memos-export-2026-10-31.zip flaremo-import.json
   ```

   The output reports how many memos and attachments were converted, and
   anything that was skipped.
3. **Import into FlareMo**: account menu (bottom left) → Settings → Import &
   Export → Import, then pick `flaremo-import.json`.

Export your current FlareMo data first if you want a rollback point.

## How fields map

| Memos | FlareMo | Notes |
| --- | --- | --- |
| Markdown at `contentPath` | Memo body | Copied unchanged |
| `createTime` / `updateTime` | created / updated | RFC 3339, second precision |
| `PRIVATE` | Private | |
| `PROTECTED` | Team | |
| `PUBLIC` | Public | |
| `SPACE` | **Private** | A Memos Space has no equivalent; the converter narrows visibility rather than widening it |
| `NORMAL` / `ARCHIVED` | Normal / Archived | |
| `pinned` | Pinned | |
| `#tags` | Tags | Re-parsed from the body, including nested tags |

## Known limits

- **Comments become standalone memos.** FlareMo does not rebuild the reply
  relation, so each reply imports as an ordinary memo.
- **External-link attachments are skipped.** Only attachments stored inside
  the archive are imported; `externalLink` ones must be uploaded again.
- **25 MiB per attachment.** Larger attachments are skipped with a warning.
- **No ZIP64.** An instance large enough to trigger ZIP64 should export in
  batches from Memos.
- **Export format 1.x only.** Older Memos releases do not write this format;
  upgrade Memos to 0.31 first.

## Verify

After importing, check three things: the timeline count matches the converter
report, an image attachment opens, and the sidebar tag count matches Memos.

If something looks wrong, restore the bundle you exported before importing,
or move the imported memos to the trash and import again.
