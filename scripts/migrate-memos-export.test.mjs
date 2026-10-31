import assert from "node:assert/strict";
import test from "node:test";
import { buildBundle, readZip } from "./migrate-memos-export.mjs";

/** Build a stored-entry ZIP; enough of the format for the reader. */
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(text, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, eocd]);
}

function archive(overrides = {}) {
  const memo = {
    uid: "abc123",
    creator: "alice",
    createTime: "2024-03-01T08:00:00Z",
    updateTime: "2024-03-02T09:00:00Z",
    state: "ARCHIVED",
    visibility: "PROTECTED",
    pinned: true,
    contentPath: "memos/abc123.md",
    attachments: [
      {
        uid: "att1",
        filename: "shot.png",
        type: "image/png",
        size: 4,
        path: "attachments/att1/shot.png",
        createTime: "2024-03-01T08:00:00Z",
      },
    ],
    ...overrides,
  };
  return zip({
    "manifest.json": JSON.stringify({
      format: "memos-export",
      formatVersion: "1.0",
      generator: { name: "memos", version: "0.31.0" },
      exportTime: "2024-03-03T00:00:00Z",
      scope: { kind: "USER", user: { username: "alice" } },
    }),
    "memos/abc123.json": JSON.stringify(memo),
    "memos/abc123.md": "# 标题\n\n正文 #标签",
    "attachments/att1/shot.png": "PNG!",
  });
}

test("converts a Memos export into a FlareMo bundle", () => {
  const { bundle, report } = buildBundle(readZip(archive()));
  assert.equal(bundle.memos.length, 1);
  assert.equal(bundle.attachments.length, 1);
  const [memo] = bundle.memos;
  assert.equal(memo.name, "memos/abc123");
  assert.equal(memo.content, "# 标题\n\n正文 #标签");
  assert.equal(memo.visibility, "team");
  assert.equal(memo.state, "archived");
  assert.equal(memo.pinned, true);
  assert.equal(memo.create_time, "2024-03-01T08:00:00Z");
  assert.equal(report.warnings.length, 0);

  const [attachment] = bundle.attachments;
  assert.equal(attachment.memo, "memos/abc123");
  assert.equal(attachment.filename, "shot.png");
  assert.equal(attachment.content_type, "image/png");
  assert.equal(attachment.size, 4);
  assert.equal(
    Buffer.from(attachment.data_base64, "base64").toString(),
    "PNG!",
  );
});

test("keeps a Space memo private rather than widening it", () => {
  const { bundle } = buildBundle(readZip(archive({ visibility: "SPACE" })));
  assert.equal(bundle.memos[0].visibility, "private");
});

test("warns instead of failing when a body is missing", () => {
  const files = archive();
  const entries = readZip(files);
  entries.delete("memos/abc123.md");
  const { bundle, report } = buildBundle(entries);
  assert.equal(bundle.memos.length, 0);
  assert.match(report.warnings.join("\n"), /content file is missing/);
});

test("rejects a ZIP that is not a Memos export", () => {
  const entries = readZip(zip({ "manifest.json": '{"format":"other"}' }));
  assert.throws(() => buildBundle(entries), /not a Memos export/);
});
