#!/usr/bin/env node
/**
 * `pnpm plugin:check <dir|zip>` — validate a plugin package (or the whole
 * repo directory) with the same rules instances enforce on install.
 *
 *   pnpm plugin:check plugins/official/flaremo-cards
 *   pnpm plugin:check path/to/my-pack.zip
 *   pnpm plugin:check            # every plugin in plugins/{official,community}
 *
 * Exit code 0 = no errors (warnings may still be printed); 1 = errors found.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkPluginFiles,
  type CheckIssue,
  type PluginCheckResult,
} from "../plugins/src/check";
import { extractPluginPackage as extractZip } from "../plugins/src/package";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const RED = "\u001b[31m";
const YELLOW = "\u001b[33m";
const GREEN = "\u001b[32m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";

const PROBLEM_CODES: Record<string, string> = {
  "manifest/missing": "add a plugin.json at the package root",
  "manifest/invalid": "fix the reported manifest field",
  "manifest/id-mismatch": "rename the folder (or the id) so they match",
  "manifest/missing-author": "add an author object",
  "manifest/unknown-field": "remove the unknown field",
  "manifest/extra-field": "remove the field that belongs to the other kind",
  "card/missing-file":
    "create the referenced file (paths are relative to plugin.json)",
  "card/unknown-node": "see plugins/README.md for the node list",
  "card/invalid-json": "fix the JSON syntax",
  "card/spec-version": "set specVersion to the current document spec (1)",
  "color/unknown-token":
    "use a brand step from the spec (brand.50 … brand.700, brand.coral)",
  "color/unsafe": "remove url()/javascript: from the value",
  "svg/unknown-tag": "see plugins/README.md for the SVG whitelist",
  "svg/event-handler": "remove the on* attribute",
  "svg/filter": 'reference a filter as "url(#id)"',
  "binding/unknown-option": "declare the option in this card's options array",
  "sandbox/external-url": "inline the resource as a data: URI",
  "sandbox/external-script": "inline the script",
  "sandbox/external-style": "inline the styles",
  "sandbox/missing-asset": "fix the path or add the file",
  "sandbox/absolute-path": "use a path relative to the entry file",
  "sandbox/base-tag": "remove the <base> tag",
  "sandbox/css-import": "inline the styles",
  "preview/not-png": "export the preview as PNG",
  "preview/too-large": "shrink the preview image",
  "asset/font-not-supported": "remove the font file; use a built-in family",
};

class CliError extends Error {}

async function readDirectoryFiles(
  dir: string,
): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {};
  const walk = async (absolute: string, relative: string) => {
    for (const entry of await readdir(absolute, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const childAbsolute = path.join(absolute, entry.name);
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(childAbsolute, childRelative);
      } else if (entry.isFile()) {
        files[childRelative] = new Uint8Array(await readFile(childAbsolute));
      }
    }
  };
  await walk(dir, "");
  return files;
}

function printIssue(issue: CheckIssue): void {
  const color = issue.severity === "error" ? RED : YELLOW;
  const label = issue.severity === "error" ? "error" : "warning";
  const where = issue.where ? `${issue.where}: ` : "";
  console.log(`  ${color}${label}${RESET} ${where}${issue.message}`);
  const hint = PROBLEM_CODES[issue.code];
  if (hint && issue.severity === "error") {
    console.log(`    ${DIM}→ ${hint}${RESET}`);
  }
}

function printResult(result: PluginCheckResult, problems: string[]): boolean {
  const name = result.pluginId
    ? `${result.pluginId}@${result.version ?? "?"}`
    : "(unknown plugin)";
  const errors = result.issues.filter((i) => i.severity === "error").length;
  const warnings = result.issues.length - errors;
  if (errors === 0 && problems.length === 0) {
    console.log(
      `${GREEN}✓${RESET} ${name}${warnings > 0 ? ` ${YELLOW}(${warnings} warning${warnings === 1 ? "" : "s"})${RESET}` : ""}`,
    );
  } else {
    console.log(
      `${RED}✗${RESET} ${name} ${RED}(${errors + problems.length} error${errors + problems.length === 1 ? "" : "s"})${RESET}`,
    );
  }
  for (const problem of problems) {
    console.log(`  ${RED}error${RESET} ${problem}`);
  }
  for (const issue of result.issues) {
    printIssue(issue);
  }
  return errors === 0 && problems.length === 0;
}

async function checkOne(target: string): Promise<boolean> {
  const resolved = path.resolve(process.cwd(), target);
  const info = await stat(resolved).catch(() => null);
  if (!info) {
    console.log(`${RED}✗${RESET} ${target}: not found`);
    return false;
  }
  if (info.isDirectory()) {
    const files = await readDirectoryFiles(resolved);
    const rootFolder = path.basename(resolved);
    const result = checkPluginFiles({ files, rootFolder });
    return printResult(result, []);
  }
  const bytes = new Uint8Array(await readFile(resolved));
  const extracted = extractZip(bytes);
  const result = checkPluginFiles({
    files: extracted.files,
    rootFolder: extracted.rootFolder ?? undefined,
  });
  return printResult(result, extracted.problems);
}

async function checkRepo(): Promise<boolean> {
  const roots = [
    path.join(repoRoot, "plugins", "official"),
    path.join(repoRoot, "plugins", "community"),
  ];
  const targets: string[] = [];
  for (const root of roots) {
    for (const entry of await readdir(root, { withFileTypes: true }).catch(
      () => [],
    )) {
      if (entry.isDirectory()) targets.push(path.join(root, entry.name));
    }
  }
  if (targets.length === 0) {
    console.log("No plugins found under plugins/{official,community}.");
    return true;
  }
  let ok = true;
  for (const target of targets.sort()) {
    const tier = target.includes(`${path.sep}community${path.sep}`)
      ? ("community" as const)
      : ("official" as const);
    const files = await readDirectoryFiles(target);
    const result = checkPluginFiles({
      files,
      rootFolder: path.basename(target),
      tier,
    });
    if (!printResult(result, [])) ok = false;
  }
  return ok;
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  console.log("");
  if (args.length === 0) {
    console.log(
      `${DIM}Checking every plugin in plugins/{official,community}…${RESET}`,
    );
    const ok = await checkRepo();
    console.log("");
    if (!ok) throw new CliError("some plugins failed validation");
    return;
  }
  let ok = true;
  for (const arg of args) {
    if (!(await checkOne(arg))) ok = false;
  }
  console.log("");
  if (!ok) throw new CliError("validation failed");
}

try {
  await main();
} catch (error) {
  if (error instanceof CliError) {
    console.error(`${RED}plugin:check failed — ${error.message}${RESET}`);
    process.exit(1);
  }
  throw error;
}
