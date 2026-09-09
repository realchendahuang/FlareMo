import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  assertDerivedIndexesComplete,
  buildOrderedDataRestore,
  buildPersistenceCountsQuery,
  RESTORE_TABLES,
  TABLE_EXPORT_ARGS,
} from "./persistence-manifest.mjs";

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
const steps = [];

mkdirSync(objectDir, { recursive: true });
const sourceConfig = readFileSync(resolve("wrangler.jsonc"), "utf8");
const productionDatabaseId = findD1DatabaseId(sourceConfig);
const restoreConfig = replaceEachExactlyOnce(sourceConfig, [
  {
    label: `production D1 database id "${productionDatabaseId}"`,
    needle: productionDatabaseId,
    replacement: targetDatabaseId,
  },
  {
    label: '"database_name": "flaremo"',
    needle: '"database_name": "flaremo"',
    replacement: `"database_name": "${targetDatabase}"`,
  },
  {
    label: `"bucket_name": "${sourceBucket}"`,
    needle: `"bucket_name": "${sourceBucket}"`,
    replacement: `"bucket_name": "${targetBucket}"`,
  },
  {
    label: '"./apps/worker/src/index.ts"',
    needle: '"./apps/worker/src/index.ts"',
    replacement: `"${resolve("apps/worker/src/index.ts")}"`,
  },
  {
    label: '"./apps/web/dist"',
    needle: '"./apps/web/dist"',
    replacement: `"${resolve("apps/web/dist")}"`,
  },
  {
    label: '"./migrations"',
    needle: '"./migrations"',
    replacement: `"${resolve("migrations")}"`,
  },
]);
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
    ...TABLE_EXPORT_ARGS,
    "--no-schema",
    "--output",
    dataDump,
    "--skip-confirmation",
  ]),
);

step("order D1 inserts by foreign-key dependency", () => {
  const dump = readFileSync(dataDump, "utf8");
  writeFileSync(orderedDump, buildOrderedDataRestore(dump));
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
  for (const table of RESTORE_TABLES) {
    if (sourceCounts[table] !== targetCounts[table]) {
      throw new Error(
        `${table} mismatch: source=${sourceCounts[table]} target=${targetCounts[table]}`,
      );
    }
  }
  assertDerivedIndexesComplete(sourceCounts);
  assertDerivedIndexesComplete(targetCounts);
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

// The restore config is built by literal surgery on wrangler.jsonc. Every
// replacement must hit exactly once: a silently skipped needle would leave
// production binding values (or the production database id) in the generated
// config and point the drill at live resources.
function replaceEachExactlyOnce(config, replacements) {
  let result = config;
  for (const { label, needle, replacement } of replacements) {
    const start = result.indexOf(needle);
    const repeated =
      start !== -1 && result.indexOf(needle, start + needle.length) !== -1;
    if (start === -1 || repeated) {
      throw new Error(
        `Expected exactly one occurrence of ${label} in wrangler.jsonc but found ${start === -1 ? "none" : "multiple"}; refusing to generate a restore config that might still point at production resources.`,
      );
    }
    result =
      result.slice(0, start) +
      replacement +
      result.slice(start + needle.length);
  }
  return result;
}

// Anchor on the d1_databases block instead of the first database_id anywhere
// in the file, so other configs sharing the file cannot hijack the match.
function findD1DatabaseId(config) {
  const keyIndex = config.indexOf('"d1_databases"');
  if (keyIndex === -1) {
    throw new Error('Could not locate "d1_databases" in wrangler.jsonc');
  }
  const arrayStart = config.indexOf("[", keyIndex);
  let depth = 0;
  let arrayEnd = -1;
  for (let index = arrayStart; index < config.length; index += 1) {
    if (config[index] === "[") {
      depth += 1;
    } else if (config[index] === "]") {
      depth -= 1;
      if (depth === 0) {
        arrayEnd = index;
        break;
      }
    }
  }
  if (arrayStart === -1 || arrayEnd === -1) {
    throw new Error(
      'Could not locate the "d1_databases" array in wrangler.jsonc',
    );
  }
  const match = config
    .slice(arrayStart, arrayEnd + 1)
    .match(/"database_id"\s*:\s*"([^"]+)"/);
  if (!match) {
    throw new Error(
      'Could not locate a "database_id" inside the "d1_databases" block of wrangler.jsonc',
    );
  }
  return match[1];
}

function queryCounts(database, config) {
  const rows = query(database, buildPersistenceCountsQuery(), config);
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
