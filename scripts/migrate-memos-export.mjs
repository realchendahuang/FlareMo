#!/usr/bin/env node

// Convert a Memos 0.31+ export archive (ZIP) into the JSON bundle FlareMo's
// "Import" accepts. Memos writes one manifest, one JSON record per memo and
// the memo bodies as Markdown files inside the archive; FlareMo imports a
// single JSON document.
//
// Usage:
//   node scripts/migrate-memos-export.mjs ~/Downloads/memos-export.zip out.json
//
// The conversion is deliberately conservative about visibility: a Memos
// SPACE memo has no exact FlareMo equivalent, so it becomes private rather
// than exposing it to a team. Comment threads are flattened: each reply is
// imported as its own memo because the converter does not create relations.

import { readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

function findEndOfCentralDirectory(buffer) {
  const earliest = Math.max(0, buffer.length - 0xffff - 22);
  for (let at = buffer.length - 22; at >= earliest; at -= 1) {
    if (buffer.readUInt32LE(at) === EOCD_SIG) return at;
  }
  throw new Error("Not a ZIP file: end-of-central-directory record not found.");
}

/** Minimal ZIP reader: stored and deflated entries, no ZIP64. */
export function readZip(buffer) {
  const eocd = findEndOfCentralDirectory(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  const directoryAt = buffer.readUInt32LE(eocd + 16);
  if (count === 0xffff || directoryAt === 0xffffffff) {
    throw new Error(
      "ZIP64 archives are not supported; re-export from a smaller instance.",
    );
  }
  const entries = new Map();
  let at = directoryAt;
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(at) !== CD_SIG) {
      throw new Error("Damaged ZIP: central directory entry is missing.");
    }
    const method = buffer.readUInt16LE(at + 10);
    const compressedSize = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const localAt = buffer.readUInt32LE(at + 42);
    const name = buffer.toString("utf8", at + 46, at + 46 + nameLength);
    if (buffer.readUInt32LE(localAt) !== LOCAL_SIG) {
      throw new Error(`Damaged ZIP: local header for ${name} is missing.`);
    }
    const localNameLength = buffer.readUInt16LE(localAt + 26);
    const localExtraLength = buffer.readUInt16LE(localAt + 28);
    const dataAt = localAt + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataAt, dataAt + compressedSize);
    if (method === 0) entries.set(name, Buffer.from(raw));
    else if (method === 8) entries.set(name, inflateRawSync(raw));
    else throw new Error(`Unsupported ZIP compression method ${method}.`);
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const VISIBILITY = {
  PRIVATE: "private",
  PROTECTED: "team",
  PUBLIC: "public",
  // A Memos Space is not a FlareMo team. Private keeps the content from
  // being shared more widely than the author intended.
  SPACE: "private",
};

const STATE = { NORMAL: "normal", ARCHIVED: "archived" };

function readJson(entries, path, label) {
  const bytes = entries.get(path);
  if (!bytes) throw new Error(`Archive is missing ${label} (${path}).`);
  return JSON.parse(bytes.toString("utf8"));
}

/**
 * Convert the archive entries into a FlareMo import bundle.
 * Returns the bundle plus a report the caller can print.
 */
export function buildBundle(entries) {
  const manifest = readJson(entries, "manifest.json", "the export manifest");
  if (!String(manifest.format ?? "").startsWith("memos")) {
    throw new Error("This ZIP is not a Memos export archive.");
  }
  if (!String(manifest.formatVersion ?? "").startsWith("1.")) {
    throw new Error(
      `Unsupported Memos export version ${manifest.formatVersion}.`,
    );
  }

  const memos = [];
  const attachments = [];
  const warnings = [];
  let flattenedReplies = 0;
  let skippedExternal = 0;

  for (const [path, bytes] of entries) {
    if (!path.startsWith("memos/") || !path.endsWith(".json")) continue;
    const record = JSON.parse(bytes.toString("utf8"));
    const contentBytes = entries.get(record.contentPath);
    if (!contentBytes) {
      warnings.push(`memos/${record.uid}: content file is missing, skipped`);
      continue;
    }
    if (record.parent) flattenedReplies += 1;
    const visibility = VISIBILITY[record.visibility];
    if (!visibility) {
      warnings.push(
        `memos/${record.uid}: unknown visibility ${record.visibility}, made private`,
      );
    }
    const name = `memos/${record.uid}`;
    memos.push({
      name,
      content: contentBytes.toString("utf8"),
      visibility: visibility ?? "private",
      state: STATE[record.state] ?? "normal",
      pinned: Boolean(record.pinned),
      payload: {},
      create_time: record.createTime,
      update_time: record.updateTime ?? record.createTime,
      display_time: record.createTime,
      source: "memos-export",
    });

    for (const attachment of record.attachments ?? []) {
      if (!attachment.path) {
        skippedExternal += 1;
        continue;
      }
      const data = entries.get(attachment.path);
      if (!data) {
        warnings.push(
          `attachments/${attachment.uid}: bytes are missing, skipped`,
        );
        continue;
      }
      attachments.push({
        name: `attachments/${attachment.uid}`,
        id: `attachments/${attachment.uid}`,
        memo: name,
        filename: attachment.filename,
        content_type: attachment.type ?? null,
        size: data.length,
        payload: {},
        create_time: attachment.createTime ?? record.createTime,
        update_time: attachment.createTime ?? record.createTime,
        data_base64: data.toString("base64"),
      });
    }
  }

  if (flattenedReplies > 0) {
    warnings.push(
      `${flattenedReplies} comment(s) were imported as standalone memos; FlareMo does not keep the reply thread`,
    );
  }
  if (skippedExternal > 0) {
    warnings.push(
      `${skippedExternal} attachment(s) only exist as external links and were skipped`,
    );
  }

  return {
    bundle: { version: 1, memos, attachments },
    report: {
      memos: memos.length,
      attachments: attachments.length,
      warnings,
    },
  };
}

function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error(
      "Usage: node scripts/migrate-memos-export.mjs <memos-export.zip> <flaremo-import.json>",
    );
    process.exit(1);
  }
  const { bundle, report } = buildBundle(readZip(readFileSync(input)));
  writeFileSync(output, JSON.stringify(bundle));
  console.log(
    `Wrote ${output}: ${report.memos} memos, ${report.attachments} attachments.`,
  );
  for (const warning of report.warnings) console.warn(`warning: ${warning}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
