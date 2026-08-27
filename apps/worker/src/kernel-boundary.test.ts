import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Kernel import boundary (see issue #106).
 *
 * FlareMo ships one AGPL kernel that an external composition shell may mount
 * extra middleware/routes onto. Billing concepts live exclusively in the
 * private control-plane repo; this test keeps them out of the public kernel:
 *
 * 1. Every third-party import must be registered in some workspace's
 *    dependencies/devDependencies ("registration regime": adding a new
 *    runtime dependency to kernel code requires touching a manifest).
 * 2. Payment-provider packages are banned outright, even if registered.
 * 3. URL / git / file dependency specifiers are banned so private-repo code
 *    cannot be pulled into the kernel as a source dependency.
 */

const REPO_ROOT = (() => {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, ".git"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("repo root not found");
    dir = parent;
  }
  return dir;
})();

const SCAN_DIRS = ["packages", join("apps", "worker"), join("apps", "web")];

const BANNED_SCOPE = "@stripe";
const BANNED_PACKAGES = new Set([
  "stripe",
  "@paddle/paddle-js",
  "@paddlejs/paddlejs-core",
  "chargebee",
  "@chargify/chargify-js",
  "lemonsqueezy",
  "@lemonsqueezy/lemonsqueezy.js",
  "revenuecat",
]);

// Same-line anchors only: cross-line whitespace would swallow unrelated
// quoted strings further down the file.
const IMPORT_PATTERNS = [
  /\bfrom\s*[ \t]*["']([^"'\n]+)["']/g,
  /\bimport[ \t]*\([ \t]*["']([^"'\n]+)["']/g,
  /\brequire[ \t]*\([ \t]*["']([^"'\n]+)["']/g,
  /\bimport[ \t]+["']([^"'\n]+)["']/g,
];

function listWorkspaceManifestPaths(): string[] {
  const manifests: string[] = [];
  function walk(dir: string) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) manifests.push(pkgPath);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (
        !entry.isDirectory() ||
        entry.name.startsWith(".") ||
        entry.name === "node_modules" ||
        entry.name === "dist"
      ) {
        continue;
      }
      walk(join(dir, entry.name));
    }
  }
  walk(REPO_ROOT);
  return manifests;
}

function declaredDependencyNames(): Set<string> {
  const names = new Set<string>();
  for (const path of [
    join(REPO_ROOT, "package.json"),
    ...listWorkspaceManifestPaths(),
  ]) {
    try {
      const manifest = JSON.parse(readFileSync(path, "utf8")) as Record<
        string,
        Record<string, unknown> | undefined
      >;
      for (const section of ["dependencies", "devDependencies"] as const) {
        for (const name of Object.keys(manifest[section] ?? {})) {
          names.add(name);
        }
      }
    } catch {
      // A malformed manifest elsewhere fails its own workspace's checks;
      // this audit only asserts against well-formed declarations.
    }
  }
  return names;
}

function listKernelSourceFiles(): string[] {
  const files: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name.startsWith(".") ||
          entry.name === "node_modules" ||
          entry.name === "dist"
        ) {
          continue;
        }
        walk(path);
        continue;
      }
      // Test files exercise this audit with fixture strings; auditing them
      // would flag those fixtures. Product sources carry the real risk.
      if (
        entry.name.endsWith(".d.ts") ||
        /\.test\.tsx?$/.test(entry.name) ||
        entry.name === "kernel-boundary.ts"
      ) {
        continue;
      }
      if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        files.push(path);
      }
    }
  }
  for (const rel of SCAN_DIRS) {
    walk(join(REPO_ROOT, rel));
  }
  return files;
}

function extractImportSpecifiers(source: string): string[] {
  const specifiers = new Set<string>();
  const stripped = stripComments(source);
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of stripped.matchAll(pattern)) {
      specifiers.add(match[1] ?? "");
    }
  }
  return [...specifiers].filter(Boolean).sort();
}

/** Reduce a specifier to its registry identity: "@scope/name" or "name". */
function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@")
    ? `${parts[0]}/${parts[1]}`
    : (parts[0] ?? specifier);
}

function isBannedPaymentPackage(name: string): boolean {
  // Ban the whole payment-provider scope plus explicit lookalike-proof list.
  return name.split("/")[0] === BANNED_SCOPE || BANNED_PACKAGES.has(name);
}

/** Strip comments so source snippets in comments cannot fake imports. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

function isNonRegistrySpecifier(specifier: string): boolean {
  return /^(?:git(?:\+\w+)?:|https?:|file:|link:|github:|gitlab:|bitbucket:)/.test(
    specifier,
  );
}

function auditKernelImports(): string[] {
  const registered = declaredDependencyNames();
  const violations: string[] = [];
  for (const file of listKernelSourceFiles()) {
    const relative = file.slice(REPO_ROOT.length + 1);
    const source = readFileSync(file, "utf8");
    for (const specifier of extractImportSpecifiers(source)) {
      if (
        specifier.startsWith(".") ||
        specifier.startsWith("#") ||
        specifier.startsWith("node:")
      ) {
        continue;
      }
      // Frontend tsconfig path alias ("@/*" in apps/web/tsconfig.json),
      // resolved at build time — not a registry package.
      if (specifier.startsWith("@/")) {
        continue;
      }
      if (isNonRegistrySpecifier(specifier)) {
        violations.push(`${relative}: "${specifier}" (non-registry specifier)`);
        continue;
      }
      const name = packageNameOf(specifier);
      if (isBannedPaymentPackage(name)) {
        violations.push(
          `${relative}: "${name}" (payment provider is banned in kernel)`,
        );
        continue;
      }
      if (!registered.has(name)) {
        violations.push(
          `${relative}: "${name}" is not registered in any package.json`,
        );
      }
    }
  }
  return violations;
}

describe("kernel import boundary", () => {
  it("keeps payment providers, unregistered deps, and url specs out of the kernel", () => {
    const violations = auditKernelImports();
    expect(violations).toEqual([]);
  });

  it("bans payment packages by name while ignoring lookalikes", () => {
    expect(isBannedPaymentPackage("stripe")).toBe(true);
    expect(isBannedPaymentPackage("@stripe/react")).toBe(true);
    expect(isBannedPaymentPackage("@stripe/stripe-js")).toBe(true);
    expect(isBannedPaymentPackage("strip-ansi")).toBe(false);
    expect(isBannedPaymentPackage("@stripeful/sdk")).toBe(false);
  });

  it("rejects non-registry dependency specifiers", () => {
    for (const spec of [
      "git+https://github.com/user/repo.git",
      "github:user/repo",
      "https://example.com/x.ts",
      "file:../flaremo-cloud/apps/hosted-worker",
    ]) {
      expect(isNonRegistrySpecifier(spec)).toBe(true);
    }
    expect(isNonRegistrySpecifier("workspace:*")).toBe(false);
  });

  it("extracts static, side-effect, and dynamic imports, ignoring comments", () => {
    expect(
      extractImportSpecifiers(
        [
          'import x from "a";',
          'import "b";',
          'await import("c");',
          'const r = require("d");',
          'import type y from "e";',
          '// comment: from "not-a-real-import"',
          '/* block from "also-not" */ import z from "f";',
        ].join("\n"),
      ),
    ).toEqual(["a", "b", "c", "d", "e", "f"]);
  });
});
