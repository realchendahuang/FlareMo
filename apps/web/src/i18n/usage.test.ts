import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { enUS } from "./messages/en-US";

/**
 * Keys that are intentionally kept before the UI that will use them. The list
 * is exact: wiring a key removes it from the orphan set (and this test fails
 * until the entry is dropped), and adding copy without a consumer fails here.
 */
const PENDING_KEYS = [
  "pwa.installTitle",
  "pwa.installDescription",
  "pwa.installButton",
  "pwa.installUnavailable",
  "pwa.iosHint",
  "pwa.installedTitle",
  "pwa.installedDescription",
  "pwa.offlineTitle",
  "pwa.offlineDescription",
  "pwa.dismiss",
] as const;

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Message catalogs are the definition of the key set, not usages.
      if (entry.name === "i18n") continue;
      files.push(...sourceFiles(full));
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !/\.test\.(ts|tsx)$/.test(entry.name)
    ) {
      files.push(full);
    }
  }
  return files;
}

/** Any dotted string literal counts: keys also live in data tables, not just t() calls. */
const LITERAL = /["'`]([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)["'`]/g;
const DYNAMIC_PREFIX = /\bt\(\s*`([^`$]*)\$\{/g;

describe("translation key usage", () => {
  it("has no unreferenced keys besides the documented pending list", () => {
    const literals = new Set<string>();
    const prefixes: string[] = [];
    for (const file of sourceFiles(sourceRoot)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(LITERAL)) {
        literals.add(match[1]);
      }
      for (const match of source.matchAll(DYNAMIC_PREFIX)) {
        prefixes.push(match[1]);
      }
    }
    const orphanKeys = Object.keys(enUS).filter(
      (key) =>
        !literals.has(key) &&
        !prefixes.some((prefix) => key.startsWith(prefix)),
    );
    expect(orphanKeys.sort()).toEqual([...PENDING_KEYS].sort());
  });
});
