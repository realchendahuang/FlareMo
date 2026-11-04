import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
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

describe("query keys", () => {
  it("has no inline queryKey array literals outside query-keys.ts", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(sourceRoot)) {
      if (file.endsWith("lib/query-keys.ts")) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        // Only flag a literal whose first element is a hard-coded string; a
        // computed prefix (e.g. [queryKey, token]) is not a cache anchor.
        if (/queryKey:\s*\[\s*["']/.test(line)) {
          offenders.push(`${relative(sourceRoot, file)}:${index + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
