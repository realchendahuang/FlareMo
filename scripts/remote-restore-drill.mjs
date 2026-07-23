import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const targetDatabase = requiredEnv("FLAREMO_RESTORE_DATABASE");
const targetDatabaseId = requiredEnv("FLAREMO_RESTORE_DATABASE_ID");
const targetBucket = requiredEnv("FLAREMO_RESTORE_BUCKET");
const sourceDatabase = process.env.FLAREMO_SOURCE_DATABASE || "DB";
const sourceBucket = process.env.FLAREMO_SOURCE_BUCKET || "flaremo-attachments";
const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
const outputDir = resolve("backups", `remote-restore-${stamp}`);
const dataDump = join(outputDir, "d1-data.sql");
const orderedDump = join(outputDir, "d1-data-ordered.sql");
const generatedConfig = join(outputDir, "wrangler.restore-drill.jsonc");
const reportPath = join(outputDir, "report.md");
const objectDir = join(outputDir, "r2");
const backupTables = [
  "users",
  "memos",
  "attachments",
  "memo_relations",
  "settings",
  "shares",
  "memo_tags",
  "memo_revisions",
];
const tableArgs = backupTables.flatMap((table) => ["--table", table]);
const steps = [];

mkdirSync(objectDir, { recursive: true });
const sourceConfig = readFileSync(resolve("wrangler.jsonc"), "utf8");
const productionDatabaseId = sourceConfig.match(
  /"database_id"\s*:\s*"([^"]+)"/,
)?.[1];
if (!productionDatabaseId) throw new Error("Could not locate production D1 id");
const restoreConfig = sourceConfig
  .replace(productionDatabaseId, targetDatabaseId)
  .replace('"database_name": "flaremo"', `"database_name": "${targetDatabase}"`)
  .replace(
    `"bucket_name": "${sourceBucket}"`,
    `"bucket_name": "${targetBucket}"`,
  )
  .replace(
    '"./apps/worker/src/index.ts"',
    `"${resolve("apps/worker/src/index.ts")}"`,
  )
  .replace('"./apps/web/dist"', `"${resolve("apps/web/dist")}"`)
  .replace('"./migrations"', `"${resolve("migrations")}"`);
writeFileSync(generatedConfig, restoreConfig);

step("verify source and target resources", () => {
  const databases = runWrangler(["d1", "list"], { capture: true }).stdout;
  const buckets = runWrangler(["r2", "bucket", "list"], {
    capture: true,
  }).stdout;
  for (const resource of [sourceBucket, targetBucket]) {
    if (!buckets.includes(resource))
      throw new Error(`Missing R2 bucket ${resource}`);
  }
  if (!databases.includes(targetDatabase)) {
    throw new Error(`Missing D1 database ${targetDatabase}`);
  }
});

step("export production D1 business data", () =>
  runWrangler([
    "d1",
    "export",
    sourceDatabase,
    "--remote",
    ...tableArgs,
    "--no-schema",
    "--output",
    dataDump,
    "--skip-confirmation",
  ]),
);

step("order D1 inserts by foreign-key dependency", () => {
  const dump = readFileSync(dataDump, "utf8");
  const lines = ["PRAGMA defer_foreign_keys=TRUE;"];
  for (const table of backupTables) {
    lines.push(
      ...dump
        .split("\n")
        .filter(
          (line) =>
            line.startsWith(`INSERT INTO "${table}" `) ||
            line.startsWith(`INSERT INTO \`${table}\` `),
        ),
    );
  }
  writeFileSync(orderedDump, `${lines.join("\n")}\n`);
});

step("apply migrations to target D1", () =>
  runWrangler([
    "d1",
    "migrations",
    "apply",
    "DB",
    "--remote",
    "--config",
    generatedConfig,
  ]),
);

step("restore production D1 data to target", () =>
  runWrangler([
    "d1",
    "execute",
    "DB",
    "--remote",
    "--file",
    orderedDump,
    "--yes",
    "--config",
    generatedConfig,
  ]),
);

const sourceCounts = queryCounts(sourceDatabase);
const targetCounts = queryCounts("DB", generatedConfig);
step("compare source and target D1 counts", () => {
  for (const key of Object.keys(sourceCounts)) {
    if (sourceCounts[key] !== targetCounts[key]) {
      throw new Error(
        `${key} mismatch: source=${sourceCounts[key]} target=${targetCounts[key]}`,
      );
    }
  }
  if (targetCounts.memos !== targetCounts.fts) {
    throw new Error("Target FTS index was not rebuilt from restored memos");
  }
});

const attachments = query(
  sourceDatabase,
  "SELECT id, r2_key, content_type FROM attachments WHERE deleted_at IS NULL AND state = 'ready' ORDER BY id;",
);
step("restore and verify referenced R2 objects", () => {
  for (const attachment of attachments) {
    const key = String(attachment.r2_key);
    const objectFile = join(objectDir, safeFilename(key));
    const verifyFile = `${objectFile}.verify`;
    runWrangler([
      "r2",
      "object",
      "get",
      `${sourceBucket}/${key}`,
      "--remote",
      "--file",
      objectFile,
    ]);
    runWrangler([
      "r2",
      "object",
      "put",
      `${targetBucket}/${key}`,
      "--remote",
      "--file",
      objectFile,
      "--content-type",
      String(attachment.content_type || "application/octet-stream"),
    ]);
    runWrangler([
      "r2",
      "object",
      "get",
      `${targetBucket}/${key}`,
      "--remote",
      "--file",
      verifyFile,
    ]);
    if (sha256(objectFile) !== sha256(verifyFile)) {
      throw new Error(`R2 checksum mismatch for ${key}`);
    }
  }
});

step("verify restored bindings with deploy dry-run", () => {
  run("pnpm", ["--filter", "@flaremo/web", "build"]);
  runWrangler(["deploy", "--config", generatedConfig, "--dry-run"]);
});

writeFileSync(
  reportPath,
  [
    "# FlareMo Remote Restore Drill",
    "",
    `- Created at: ${new Date().toISOString()}`,
    `- Source D1: ${sourceDatabase}`,
    `- Target D1: ${targetDatabase} (${targetDatabaseId})`,
    `- Source R2: ${sourceBucket}`,
    `- Target R2: ${targetBucket}`,
    `- Referenced R2 objects restored: ${attachments.length}`,
    `- Source counts: ${JSON.stringify(sourceCounts)}`,
    `- Target counts: ${JSON.stringify(targetCounts)}`,
    "",
    "## Steps",
    "",
    ...steps.map((item) => `- ${item}`),
    "",
    "The target resources are intentionally not deleted by the script. Inspect the report, then delete the temporary D1 database and R2 bucket explicitly.",
    "",
  ].join("\n"),
);

console.log(`Remote restore drill report: ${reportPath}`);

function queryCounts(database, config) {
  const rows = query(
    database,
    [
      "SELECT",
      "(SELECT COUNT(*) FROM users) AS users,",
      "(SELECT COUNT(*) FROM memos) AS memos,",
      "(SELECT COUNT(*) FROM memo_tags) AS tags,",
      "(SELECT COUNT(*) FROM memo_revisions) AS revisions,",
      "(SELECT COUNT(*) FROM attachments WHERE deleted_at IS NULL) AS attachments,",
      "(SELECT COUNT(*) FROM memo_relations) AS relations,",
      "(SELECT COUNT(*) FROM shares) AS shares,",
      "(SELECT COUNT(*) FROM memos_fts) AS fts;",
    ].join(" "),
    config,
  );
  return rows[0] ?? {};
}

function query(database, command, config) {
  const configArgs = config ? ["--config", config] : [];
  const result = runWrangler(
    [
      "d1",
      "execute",
      database,
      "--remote",
      "--command",
      command,
      "--json",
      ...configArgs,
    ],
    { capture: true },
  );
  const payload = JSON.parse(result.stdout);
  if (!payload[0]?.success) throw new Error(`D1 query failed for ${database}`);
  return payload[0].results ?? [];
}

function step(name, fn) {
  try {
    fn();
    steps.push(`${name}: ok`);
  } catch (error) {
    steps.push(`${name}: failed`);
    writeFileSync(
      reportPath,
      `# FlareMo Remote Restore Drill\n\nFailed step: ${name}\n\n${String(error)}\n`,
    );
    throw error;
  }
}

function runWrangler(args, options) {
  return run("pnpm", ["exec", "wrangler", ...args], options);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    if (options.capture) {
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
    }
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})`);
  }
  return result;
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function safeFilename(key) {
  return `${basename(key).replaceAll(/[^A-Za-z0-9_.-]/g, "_")}-${createHash("sha256").update(key).digest("hex").slice(0, 12)}`;
}

function sha256(path) {
  if (!existsSync(path)) throw new Error(`Missing object file ${path}`);
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
