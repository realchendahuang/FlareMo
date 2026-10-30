import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const version = process.argv[2];

if (!version || !/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: pnpm release vX.Y.Z");
  process.exit(1);
}

// The tag must match the version every workspace declares (package.json) and
// the one the OpenAPI document advertises. release.md pins both as part of the
// bump checklist; forgetting one used to go unnoticed until smoke checks.
const bareVersion = version.slice(1);
const rootPackage = JSON.parse(readFileSync("package.json", "utf8"));
const apiVersion = readFileSync(
  "packages/contracts/src/constants.ts",
  "utf8",
).match(/FLAREMO_API_VERSION = "([^"]+)"/)?.[1];
const mismatches = [];
if (rootPackage.version !== bareVersion) {
  mismatches.push(`package.json: ${rootPackage.version}`);
}
if (apiVersion !== bareVersion) {
  mismatches.push(
    `packages/contracts/src/constants.ts FLAREMO_API_VERSION: ${apiVersion}`,
  );
}
const workspaceDirs = [
  "apps/web",
  "apps/worker",
  "apps/site",
  "apps/telegram-bot",
  "packages/contracts",
  "packages/db",
  "packages/domain",
  "packages/memos",
];
for (const dir of workspaceDirs) {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  if (pkg.version !== bareVersion) {
    mismatches.push(`${dir}/package.json: ${pkg.version}`);
  }
}
if (mismatches.length) {
  console.error(`Version mismatch for tag ${version}:`);
  for (const line of mismatches) console.error(`  - ${line}`);
  console.error("Bump every version before releasing (see docs/release.md).");
  process.exit(1);
}
console.log(`All workspace versions match ${version}.`);

const releaseSection = extractChangelogSection(version);
const status = run("git", ["status", "--short"], { capture: true });
if (status.stdout.trim()) {
  console.error(
    "Working tree is not clean. Commit or stash changes before release.",
  );
  console.error(status.stdout);
  process.exit(1);
}

run("git", ["fetch", "origin", "main", "--tags"]);
const head = run("git", ["rev-parse", "HEAD"], { capture: true }).stdout.trim();
const upstream = run("git", ["rev-parse", "origin/main"], {
  capture: true,
}).stdout.trim();
if (head !== upstream) {
  console.error(
    `HEAD (${head}) does not match origin/main (${upstream}). Push main before release.`,
  );
  process.exit(1);
}

const existingTag = run("git", ["tag", "--list", version], {
  capture: true,
}).stdout.trim();
if (existingTag) {
  console.error(`${version} already exists locally.`);
  process.exit(1);
}

// The full 9-step gate is opt-in (--verify): the maintainer runs it only on
// explicit request. Releases otherwise rely on the targeted tests each change
// already ran, plus the deploy dry-run and drill gates below.
if (process.argv.includes("--verify")) {
  run("pnpm", ["verify"]);
} else {
  console.log("Skipping the full pnpm verify gate (opt in with --verify).");
}

// Conditional gate: if migrations changed since the last release tag, the
// backup/restore drill must pass before this release can be cut. The drill
// is cheap locally but easy to forget; schema-bearing releases are exactly
// when forgetting it hurts (see docs/release.md 数据库 migration rules).
const lastTag = run("git", ["describe", "--tags", "--abbrev=0"], {
  capture: true,
}).stdout.trim();
if (lastTag) {
  const changed = run(
    "git",
    ["diff", "--name-only", `${lastTag}..HEAD`, "--", "migrations/"],
    { capture: true },
  ).stdout.trim();
  if (changed) {
    console.log(
      `migrations changed since ${lastTag}:\n${changed}\n→ running backup drill before release`,
    );
    run("pnpm", ["backup:drill"]);
  } else {
    console.log(`no migration changes since ${lastTag}; skipping backup drill`);
  }
}

run("pnpm", ["deploy:dry-run"]);

const notesDir = mkdtempSync(join(tmpdir(), "flaremo-release-"));
const notesFile = join(notesDir, `${version}.md`);
writeFileSync(notesFile, releaseSection);

run("git", ["tag", version]);
run("git", ["push", "origin", version]);
try {
  runOrThrow("gh", [
    "release",
    "create",
    version,
    "--title",
    version,
    "--notes-file",
    notesFile,
  ]);
} catch {
  printReleaseRecoveryHints(version, notesFile);
  process.exit(1);
}
rmSync(notesDir, { recursive: true, force: true });

// The tag is already pushed when the GitHub release step runs, so a failure
// there leaves the repo with a remote tag and no release. The notes file is
// deliberately kept so the hints below can be executed as-is.
function printReleaseRecoveryHints(version, notesFile) {
  console.error(`gh release create failed for ${version}.`);
  console.error(
    `The tag ${version} was already pushed to origin, so the GitHub release may be missing.`,
  );
  console.error("Recover manually:");
  console.error(
    `  git push origin :refs/tags/${version}  # delete the remote tag`,
  );
  console.error(`  git tag -d ${version}  # delete the local tag (optional)`);
  console.error(
    `  gh release create ${version} --title ${version} --notes-file ${notesFile}`,
  );
  console.error(`The release notes were kept at ${notesFile}.`);
}

function runOrThrow(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status}`,
    );
  }

  return result;
}

function extractChangelogSection(tag) {
  const changelog = readFileSync("CHANGELOG.md", "utf8");
  const heading = `## ${tag}`;
  const start = changelog.indexOf(heading);
  if (start === -1) {
    console.error(`CHANGELOG.md is missing section: ${heading}`);
    process.exit(1);
  }

  const next = changelog.indexOf("\n## ", start + heading.length);
  return changelog.slice(start, next === -1 ? undefined : next).trimStart();
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    if (options.capture) {
      process.stderr.write(result.stderr);
      process.stdout.write(result.stdout);
    }
    process.exit(result.status ?? 1);
  }

  return result;
}
