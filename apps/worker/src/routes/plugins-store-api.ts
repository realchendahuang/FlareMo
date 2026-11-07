import {
  getPluginSettings,
  type InstalledPluginRecord,
  OutboundFetchError,
  type PluginSettings,
  pluginAssetPrefix,
  type SafeOutboundResponse,
  safeOutboundFetch,
  setPluginSettings,
  ValidationError,
} from "@flaremo/domain";
import {
  PLUGIN_PACKAGE_LIMITS,
  readPluginPackage,
  sha256Hex,
} from "@flaremo/plugins/package";
import { Hono } from "hono";
import { z } from "zod";
import type { HonoBindings } from "../context";
import { jsonError } from "../http";
import { invalidatePluginSettingsCache } from "../settings-cache";
import { zValidator } from "../validated";
import { ownerContext } from "./admin/context";

/**
 * Owner-only plugin store: browse directory sources, install/uninstall
 * packages into R2, upload a local package, and manage custom directories.
 *
 * The worker does the fetching and unpacking (no browser CORS constraints,
 * and sha256 verification happens before anything is written). Directories
 * are plain static JSON (`registry.json`) — the same protocol shapes the
 * repository's `pnpm plugins:build` output, so the official directory is
 * just the default entry in that list.
 */

export const pluginsStoreApi = new Hono<HonoBindings>();

/** The directory every instance ships with; relative artifact URLs resolve against it. */
export const DEFAULT_PLUGIN_SOURCE = {
  id: "official",
  name: "FlareMo 官方目录",
  url: "https://flaremo.app/plugins/registry.json",
} as const;

const PLUGIN_DIRECTORY_MAX_BYTES = 512 * 1024;
const PLUGIN_DIRECTORY_TIMEOUT_MS = 5_000;
const PLUGIN_ARTIFACT_TIMEOUT_MS = 15_000;

const registryEntrySchema = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  version: z.string().trim().min(1).max(64),
  tier: z.enum(["official", "community"]),
  name: z.record(z.string(), z.string()),
  description: z.record(z.string(), z.string()).optional(),
  author: z
    .object({
      name: z.string(),
      url: z.string().optional(),
      email: z.string().optional(),
    })
    .optional(),
  license: z.string().optional(),
  minAppVersion: z.string().optional(),
  preview: z.string().nullable().optional(),
  contributes: z
    .object({
      shareCardTemplates: z
        .array(
          z.object({
            id: z.string(),
            kind: z.enum(["document", "sandbox"]),
            name: z.record(z.string(), z.string()),
            description: z.record(z.string(), z.string()).optional(),
            size: z
              .object({ width: z.number(), height: z.number() })
              .optional(),
            options: z.array(z.unknown()).optional(),
            preview: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  artifact: z.object({
    url: z.string().trim().min(1),
    sha256: z
      .string()
      .trim()
      .regex(/^[0-9a-f]{64}$/),
    size: z.number().int().nonnegative(),
  }),
});

const registrySchema = z.object({
  specVersion: z.number().int(),
  name: z.string().optional(),
  updatedAt: z.string().optional(),
  plugins: z.array(registryEntrySchema).max(200),
});

type RegistryEntry = z.infer<typeof registryEntrySchema>;

function resolveUrl(base: string, relative: string): string {
  return new URL(relative, base).toString();
}

type DirectoryResult = {
  source: { id: string; name: string; url: string };
  entries: RegistryEntry[];
  /** Preview urls resolved against the directory url, keyed by plugin id. */
  previews: Record<string, string>;
  error?: string;
};

async function fetchDirectory(source: {
  id: string;
  name: string;
  url: string;
}): Promise<DirectoryResult> {
  try {
    const response = await safeOutboundFetch(source.url, {
      headers: { accept: "application/json" },
      maxResponseBytes: PLUGIN_DIRECTORY_MAX_BYTES,
      requireHttps: true,
      timeoutMs: PLUGIN_DIRECTORY_TIMEOUT_MS,
    });
    if (!response.ok) {
      return {
        source,
        entries: [],
        previews: {},
        error: `directory responded ${response.status}`,
      };
    }
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(response.body));
    } catch {
      return { source, entries: [], previews: {}, error: "invalid registry" };
    }
    const parsed = registrySchema.safeParse(json);
    if (!parsed.success) {
      return { source, entries: [], previews: {}, error: "invalid registry" };
    }
    const previews: Record<string, string> = {};
    for (const entry of parsed.data.plugins) {
      if (entry.preview) {
        previews[entry.id] = resolveUrl(source.url, entry.preview);
      }
    }
    return { source, entries: parsed.data.plugins, previews };
  } catch {
    return {
      source,
      entries: [],
      previews: {},
      error: "directory unreachable",
    };
  }
}

pluginsStoreApi.get("/store", async (c) => {
  try {
    const { db } = await ownerContext(c);
    const settings = await getPluginSettings(db);
    const sources = [DEFAULT_PLUGIN_SOURCE, ...settings.sources];
    const directories = await Promise.all(sources.map(fetchDirectory));
    const installedById = new Map(
      settings.installed.map((record) => [record.id, record]),
    );
    return c.json({
      sources: directories.map((directory) => ({
        id: directory.source.id,
        name: directory.source.name,
        url: directory.source.url,
        error: directory.error ?? null,
      })),
      entries: directories.flatMap((directory) =>
        directory.entries.map((entry) => ({
          ...entry,
          sourceId: directory.source.id,
          preview: directory.previews[entry.id] ?? null,
          // Card previews resolve against the same directory base, so the
          // admin UI can show what each card looks like before installing.
          contributes: entry.contributes
            ? {
                ...entry.contributes,
                shareCardTemplates: (
                  entry.contributes.shareCardTemplates ?? []
                ).map((card) => ({
                  ...card,
                  preview: card.preview
                    ? resolveUrl(directory.source.url, card.preview)
                    : null,
                })),
              }
            : entry.contributes,
          installedVersion: installedById.get(entry.id)?.version ?? null,
          installedSource: installedById.get(entry.id)?.source ?? null,
        })),
      ),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

pluginsStoreApi.put(
  "/sources",
  zValidator(
    "json",
    z.object({
      sources: z
        .array(
          z.object({
            id: z
              .string()
              .trim()
              .regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
            name: z.string().trim().min(1).max(80),
            url: z.string().trim().url().startsWith("https://"),
          }),
        )
        .max(20),
    }),
  ),
  async (c) => {
    try {
      const { db } = await ownerContext(c);
      const settings = await setPluginSettings(db, {
        sources: c.req.valid("json").sources,
      });
      invalidatePluginSettingsCache(db);
      return c.json({ sources: settings.sources });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

/** Write one package's files to R2 and record it as installed. */
async function installPackage(
  env: HonoBindings["Bindings"],
  db: Parameters<typeof getPluginSettings>[0],
  bytes: Uint8Array,
  source: string,
): Promise<{ settings: PluginSettings; installed: InstalledPluginRecord }> {
  const { manifest, files } = await readPluginPackage(bytes);
  const prefix = pluginAssetPrefix(manifest.id, manifest.version);
  await Promise.all(
    Object.entries(files).map(([relative, data]) =>
      env.ATTACHMENTS.put(
        `${prefix}${relative}`,
        data as unknown as ArrayBuffer,
      ),
    ),
  );
  const current = await getPluginSettings(db);
  const installed: InstalledPluginRecord = {
    id: manifest.id,
    version: manifest.version,
    source,
    manifest: manifest as unknown as Record<string, unknown>,
  };
  const rest = current.installed.filter((record) => record.id !== manifest.id);
  const settings = await setPluginSettings(db, {
    installed: [...rest, installed],
  });
  invalidatePluginSettingsCache(db);
  return { settings, installed };
}

pluginsStoreApi.post(
  "/install",
  zValidator(
    "json",
    z.object({
      id: z
        .string()
        .trim()
        .regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
      sourceId: z.string().trim().min(1).max(64).optional(),
    }),
  ),
  async (c) => {
    try {
      const { db } = await ownerContext(c);
      const { id, sourceId } = c.req.valid("json");
      const settings = await getPluginSettings(db);
      const sources = [DEFAULT_PLUGIN_SOURCE, ...settings.sources];
      const source = sourceId
        ? sources.find((candidate) => candidate.id === sourceId)
        : sources[0];
      if (!source) throw new ValidationError("Unknown directory source.");
      const directory = await fetchDirectory(source);
      const entry = directory.entries.find((candidate) => candidate.id === id);
      if (!entry) {
        throw new ValidationError("Plugin not found in the directory.");
      }
      if (entry.artifact.size > PLUGIN_PACKAGE_LIMITS.maxZipBytes) {
        throw new ValidationError("Package exceeds the download size limit.");
      }
      const artifactUrl = resolveUrl(source.url, entry.artifact.url);
      let response: SafeOutboundResponse;
      try {
        response = await safeOutboundFetch(artifactUrl, {
          maxResponseBytes: PLUGIN_PACKAGE_LIMITS.maxZipBytes,
          requireHttps: true,
          timeoutMs: PLUGIN_ARTIFACT_TIMEOUT_MS,
        });
      } catch (error) {
        if (error instanceof OutboundFetchError) {
          if (error.code === "response_too_large") {
            throw new ValidationError(
              "Package exceeds the download size limit.",
            );
          }
          throw new ValidationError("Package download failed.");
        }
        throw error;
      }
      if (!response.ok) {
        throw new ValidationError(
          `Package download failed (${response.status}).`,
        );
      }
      const bytes = response.body;
      if (bytes.byteLength > PLUGIN_PACKAGE_LIMITS.maxZipBytes) {
        throw new ValidationError("Package exceeds the download size limit.");
      }
      const digest = await sha256Hex(bytes);
      if (digest !== entry.artifact.sha256) {
        throw new ValidationError(
          "Package checksum does not match the directory entry.",
        );
      }
      const { installed } = await installPackage(c.env, db, bytes, source.id);
      return c.json({ installed });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

pluginsStoreApi.post("/upload", async (c) => {
  try {
    const { db } = await ownerContext(c);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength === 0) {
      throw new ValidationError("Upload an empty package.");
    }
    const { installed } = await installPackage(c.env, db, bytes, "local");
    return c.json({ installed });
  } catch (error) {
    return jsonError(c, error);
  }
});

pluginsStoreApi.delete("/:id", async (c) => {
  try {
    const { db } = await ownerContext(c);
    const id = c.req.param("id");
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) {
      throw new ValidationError("Invalid plugin id.");
    }
    const current = await getPluginSettings(db);
    const record = current.installed.find((candidate) => candidate.id === id);
    if (!record) {
      throw new ValidationError("That plugin is not installed.");
    }
    // Remove the assets first; the settings record only goes away once the
    // files are gone, so a failure here leaves a retryable state.
    const prefix = pluginAssetPrefix(record.id, record.version);
    let cursor: string | undefined;
    do {
      const page = await c.env.ATTACHMENTS.list({
        prefix,
        cursor,
        limit: 500,
      });
      const keys = page.objects.map((object) => object.key);
      if (keys.length > 0) {
        await c.env.ATTACHMENTS.delete(keys);
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    const settings = await setPluginSettings(db, {
      installed: current.installed.filter((entry) => entry.id !== id),
      enabledPlugins: current.enabledPlugins.filter((entry) => entry !== id),
      disabledPlugins: current.disabledPlugins.filter((entry) => entry !== id),
    });
    invalidatePluginSettingsCache(db);
    return c.json({ removed: true, id, installed: settings.installed });
  } catch (error) {
    return jsonError(c, error);
  }
});
