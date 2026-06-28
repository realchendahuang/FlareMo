import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const version = process.argv[2];

if (!version || !/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: pnpm release v0.1.1");
  process.exit(1);
}

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

run("pnpm", ["verify"]);
run("pnpm", ["deploy:dry-run"]);

const notesDir = mkdtempSync(join(tmpdir(), "flaremo-release-"));
const notesFile = join(notesDir, `${version}.md`);
writeFileSync(notesFile, releaseSection);

try {
  run("git", ["tag", version]);
  run("git", ["push", "origin", version]);
  run("gh", [
    "release",
    "create",
    version,
    "--title",
    version,
    "--notes-file",
    notesFile,
  ]);
} finally {
  rmSync(notesDir, { recursive: true, force: true });
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
