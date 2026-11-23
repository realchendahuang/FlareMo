#!/usr/bin/env node
/**
 * Build the plugin store from the repository's `plugins/{official,community}`
 * folders (the open directory):
 *
 *   <id>/plugin.json + card files
 *     → plugins/dist/store/<id>/<id>-<version>.zip   (the artifact)
 *     → plugins/dist/store/<id>/preview.png          (optional, for the store UI)
 *     → plugins/registry.json                        (the directory index)
 *
 * `registry.json` is tracked so the diff shows what the store actually
 * serves; `dist/store` is generated and gets mirrored into the marketing
 * site by `apps/site`'s build. Artifact URLs are relative to the registry,
 * so the same file works from any host that mirrors the directory.
 *
 * Run: pnpm plugins:build
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkPluginFiles } from "../plugins/src/check";
import { zipPluginFiles } from "../plugins/src/package";
import { PLUGIN_SPEC_VERSION } from "../plugins/src/spec";
import { validatePluginManifest } from "../plugins/src/validate";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const sourceRoot = path.join(root, "plugins");
const storeDir = path.join(sourceRoot, "dist", "store");
const registryPath = path.join(sourceRoot, "registry.json");

type StorePlugin = {
  id: string;
  version: string;
  tier: "official" | "community";
  name: Record<string, string>;
  description?: Record<string, string>;
  author?: { name: string; url?: string; email?: string };
  license?: string;
  minAppVersion?: string;
  defaultEnabled?: boolean;
  preview: string | null;
  contributes: {
    shareCardTemplates: Array<{
      id: string;
      kind: "document" | "sandbox";
      name: Record<string, string>;
      description?: Record<string, string>;
      size?: { width: number; height: number };
      options?: unknown[];
      /** Registry-relative card preview image, when the plugin ships one. */
      preview?: string;
    }>;
  };
  artifact: { url: string; sha256: string; size: number };
};

async function listFolders(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/** Collect `<id>/`-prefixed files for one plugin folder. */
async function collectFiles(
  folder: string,
): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {};
  const walk = async (absolute: string, relative: string) => {
    const entries = await readdir(absolute, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const childAbsolute = path.join(absolute, entry.name);
      const childRelative = `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(childAbsolute, childRelative);
      } else if (entry.isFile()) {
        files[childRelative] = await readFile(childAbsolute);
      }
    }
  };
  await walk(path.join(sourceRoot, folder), folder);
  return files;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function buildTier(
  tier: "official" | "community",
  output: StorePlugin[],
): Promise<void> {
  const tierDir = path.join(sourceRoot, tier);
  for (const folder of await listFolders(tierDir)) {
    const files = await collectFiles(`${tier}/${folder}`);
    const manifestBytes = files[`${tier}/${folder}/plugin.json`];
    if (!manifestBytes) {
      throw new Error(`plugins/${tier}/${folder} is missing plugin.json`);
    }
    const { manifest, problems } = validatePluginManifest(
      JSON.parse(new TextDecoder().decode(manifestBytes)),
    );
    if (!manifest) {
      throw new Error(`plugins/${tier}/${folder}: ${problems.join("; ")}`);
    }
    if (manifest.id !== folder) {
      throw new Error(
        `plugins/${tier}/${folder}: id "${manifest.id}" must match the folder name`,
      );
    }

    // The store build enforces the same rules as `pnpm plugin:check` and the
    // instance install path, so a published artifact is always installable.
    const check = checkPluginFiles({
      files: Object.fromEntries(
        Object.entries(files).map(([name, data]) => [
          name.slice(`${tier}/${folder}/`.length),
          data,
        ]),
      ),
      rootFolder: folder,
      tier,
    });
    const errors = check.issues.filter((issue) => issue.severity === "error");
    if (errors.length > 0) {
      throw new Error(
        `plugins/${tier}/${folder} failed validation:\n${errors
          .map(
            (issue) =>
              `  - ${issue.where ? `${issue.where}: ` : ""}${issue.message}`,
          )
          .join("\n")}`,
      );
    }

    // The zip keeps the standard `<id>/…` layout the installer expects
    // (top-level folder named after the plugin, plugin.json at its root).
    const zipEntries: Record<string, Uint8Array> = {};
    const prefix = `${tier}/${folder}/`;
    for (const [name, data] of Object.entries(files)) {
      zipEntries[`${manifest.id}/${name.slice(prefix.length)}`] = data;
    }
    const zipped = await zipPluginFiles(zipEntries);
    const artifactName = `${manifest.id}-${manifest.version}.zip`;
    await mkdir(path.join(storeDir, manifest.id), { recursive: true });
    await writeFile(path.join(storeDir, manifest.id, artifactName), zipped);

    // Plugin-level preview: `<folder>/preview.png`, mirrored next to the zip.
    let preview: string | null = null;
    const previewBytes = files[`${prefix}preview.png`];
    if (previewBytes) {
      await writeFile(
        path.join(storeDir, manifest.id, "preview.png"),
        previewBytes,
      );
      preview = `${manifest.id}/preview.png`;
    }

    // Card-level previews are mirrored too (flattened to `<id>/<cardId>.png`)
    // so the site and the store can show the actual cards.
    const cardPreviews: Record<string, string> = {};
    for (const card of manifest.contributes.shareCardTemplates ?? []) {
      if (!card.preview) continue;
      const cardPreviewBytes = files[`${prefix}${card.preview}`];
      if (!cardPreviewBytes) continue;
      await writeFile(
        path.join(storeDir, manifest.id, `${card.id}.png`),
        cardPreviewBytes,
      );
      cardPreviews[card.id] = `${manifest.id}/${card.id}.png`;
    }

    output.push({
      id: manifest.id,
      version: manifest.version,
      tier,
      name: manifest.name,
      ...(manifest.description ? { description: manifest.description } : {}),
      ...(manifest.author ? { author: manifest.author } : {}),
      ...(manifest.license ? { license: manifest.license } : {}),
      ...(manifest.minAppVersion
        ? { minAppVersion: manifest.minAppVersion }
        : {}),
      ...(manifest.defaultEnabled !== undefined
        ? { defaultEnabled: manifest.defaultEnabled }
        : {}),
      preview,
      contributes: {
        shareCardTemplates: (manifest.contributes.shareCardTemplates ?? []).map(
          (card) => ({
            id: card.id,
            kind: card.kind,
            name: card.name,
            ...(card.description ? { description: card.description } : {}),
            ...(card.size ? { size: card.size } : {}),
            ...(card.options ? { options: card.options } : {}),
            ...(cardPreviews[card.id]
              ? { preview: cardPreviews[card.id] }
              : {}),
          }),
        ),
      },
      artifact: {
        url: `${manifest.id}/${artifactName}`,
        sha256: sha256(zipped),
        size: zipped.byteLength,
      },
    });
    console.log(
      `[plugins] ${tier}/${manifest.id}@${manifest.version} → ${artifactName} (${zipped.byteLength}B, sha256 ${sha256(zipped).slice(0, 12)}…)`,
    );
  }
}

async function main() {
  await rm(storeDir, { recursive: true, force: true });
  await mkdir(storeDir, { recursive: true });

  const plugins: StorePlugin[] = [];
  await buildTier("official", plugins);
  await buildTier("community", plugins);

  // Keep `updatedAt` stable while the content is unchanged so the tracked
  // registry only diffs when the store actually changes.
  let updatedAt = new Date().toISOString();
  try {
    const existing = JSON.parse(await readFile(registryPath, "utf8")) as {
      updatedAt?: string;
      plugins?: unknown;
    };
    if (JSON.stringify(existing.plugins) === JSON.stringify(plugins)) {
      updatedAt = existing.updatedAt ?? updatedAt;
    }
  } catch {
    // No previous registry: first build.
  }

  const registry = {
    specVersion: PLUGIN_SPEC_VERSION,
    name: "FlareMo 官方目录",
    updatedAt,
    plugins,
  };
  await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);

  console.log(
    `[plugins] registry.json: ${plugins.length} plugin(s); artifacts in plugins/dist/store (mirrored into the site by apps/site's build)`,
  );
}

await main();
