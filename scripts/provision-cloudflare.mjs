#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseJsonc, printParseErrorCode } from "jsonc-parser";

const PLACEHOLDER_DATABASE_IDS = new Set([
  "REPLACE_WITH_YOUR_D1_DATABASE_ID",
  "00000000-0000-0000-0000-000000000000",
]);
const DATABASE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_VECTOR_DIMENSIONS = 1024;
const DEFAULT_VECTOR_METRIC = "cosine";

export function isPlaceholderDatabaseId(value) {
  const id = String(value ?? "").trim();
  return !id || PLACEHOLDER_DATABASE_IDS.has(id) || !DATABASE_ID_RE.test(id);
}

export function resourcesFromConfig(config) {
  const database = config?.d1_databases?.[0];
  const bucket = config?.r2_buckets?.[0];
  const queues = [
    ...new Set(
      [
        ...(config?.queues?.producers ?? []).map((item) => item.queue),
        ...(config?.queues?.consumers ?? []).map((item) => item.queue),
      ].filter(Boolean),
    ),
  ];
  const indexes = (config?.vectorize ?? [])
    .map((item) => item.index_name)
    .filter(Boolean);
  const dimensions = Number.parseInt(
    String(config?.vars?.FLAREMO_EMBEDDING_DIMENSIONS ?? ""),
    10,
  );

  return {
    workerName: config?.name || "flaremo",
    databaseName: database?.database_name ?? "flaremo",
    databaseId: database?.database_id ?? "",
    bucketName: bucket?.bucket_name ?? "flaremo-attachments",
    queues,
    indexes,
    publicUrl: config?.vars?.FLAREMO_PUBLIC_URL ?? "",
    dimensions:
      Number.isInteger(dimensions) && dimensions > 0
        ? dimensions
        : DEFAULT_VECTOR_DIMENSIONS,
    metric: DEFAULT_VECTOR_METRIC,
  };
}

export function isPlaceholderPublicUrl(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return true;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return true;
    if (url.pathname !== "/" || url.search || url.hash || url.username) {
      return true;
    }
    return url.hostname.includes("example.");
  } catch {
    return true;
  }
}

export function workersDevOrigin(workerName, subdomain) {
  const name = String(workerName ?? "").trim();
  const host = String(subdomain ?? "")
    .trim()
    .toLowerCase();
  if (!name || !host) {
    throw new Error("Worker name and workers.dev subdomain are required.");
  }
  return `https://${name}.${host}.workers.dev`;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  await main().catch((error) => {
    console.error(
      error instanceof Error
        ? error.message
        : "Cloudflare resource provisioning failed.",
    );
    process.exit(1);
  });
}

async function main() {
  const skipResources = process.argv.includes("--skip-resources");
  const configPath = resolve("wrangler.jsonc");
  let source = readFileSync(configPath, "utf8");
  const resources = resourcesFromConfig(parseConfig(source, configPath));

  if (skipResources) {
    if (isPlaceholderDatabaseId(resources.databaseId)) {
      const existing = findD1(resources.databaseName);
      if (!existing) {
        throw new Error(
          `D1 ${resources.databaseName} does not exist. Re-run with resource provisioning enabled.`,
        );
      }
      source = patchDatabaseId(source, resources.databaseId, existing);
      writeFileSync(configPath, source);
    }
  } else {
    const databaseId = ensureD1(resources.databaseName, resources.databaseId);
    if (databaseId !== resources.databaseId) {
      source = patchDatabaseId(source, resources.databaseId, databaseId);
      writeFileSync(configPath, source);
      console.log(
        `Updated ${configPath} with D1 database_id for ${resources.databaseName}.`,
      );
    }

    ensureR2(resources.bucketName);
    for (const queue of resources.queues) ensureQueue(queue);
    for (const indexName of resources.indexes) {
      ensureVectorize(indexName, resources.dimensions, resources.metric);
    }
  }

  const publicUrl = await resolvePublicUrl(resources);
  if (publicUrl !== String(resources.publicUrl ?? "").trim()) {
    source = patchPublicUrl(source, resources.publicUrl, publicUrl);
    writeFileSync(configPath, source);
    console.log(`Using FLAREMO_PUBLIC_URL=${publicUrl}`);
  }

  console.log("Cloudflare resources are ready.");
}

function parseConfig(source, configPath) {
  const parseErrors = [];
  const config = parseJsonc(source, parseErrors, { allowTrailingComma: true });
  if (parseErrors.length > 0) {
    throw new Error(
      `Cannot parse ${configPath}: ${parseErrors
        .map((error) => printParseErrorCode(error.error))
        .join(", ")}`,
    );
  }
  return config;
}

function ensureD1(name, configuredId) {
  const existing = findD1(name);
  if (existing) {
    if (!isPlaceholderDatabaseId(configuredId) && existing !== configuredId) {
      throw new Error(
        `D1 database ${name} already exists as ${existing}, which does not match wrangler.jsonc.`,
      );
    }
    console.log(`D1 ${name} already exists.`);
    return existing;
  }

  const created = wrangler(["d1", "create", name]);
  if (created.status !== 0 && !isAlreadyExists(created.output)) {
    throw new Error(`Could not create D1 ${name}:\n${created.output}`);
  }
  const id = findD1(name);
  if (!id)
    throw new Error(`Created D1 ${name} but could not read its database_id.`);
  console.log(`Created D1 ${name}.`);
  return id;
}

function findD1(name) {
  const listed = wrangler(["d1", "list", "--json"]);
  if (listed.status !== 0) {
    throw new Error(`Could not list D1 databases:\n${listed.output}`);
  }
  const databases = parseJsonOutput(listed.output);
  const match = databases.find((item) => item?.name === name);
  return typeof match?.uuid === "string" ? match.uuid : "";
}

function ensureR2(name) {
  if (bucketExists(name)) {
    console.log(`R2 bucket ${name} already exists.`);
    return;
  }
  const created = wrangler(["r2", "bucket", "create", name], {
    allowFailure: true,
  });
  if (created.status === 0) {
    console.log(`Created R2 bucket ${name}.`);
    return;
  }
  if (isAlreadyExists(created.output)) {
    console.log(`R2 bucket ${name} already exists.`);
    return;
  }
  throw new Error(`Could not create R2 bucket ${name}:\n${created.output}`);
}

function bucketExists(name) {
  const listed = wrangler(["r2", "bucket", "list"], { allowFailure: true });
  if (listed.status !== 0) return false;
  return listedResourceExists(listed.output, name);
}

function ensureQueue(name) {
  if (queueExists(name)) {
    console.log(`Queue ${name} already exists.`);
    return;
  }
  const created = wrangler(["queues", "create", name], { allowFailure: true });
  if (created.status === 0) {
    console.log(`Created Queue ${name}.`);
    return;
  }
  if (isAlreadyExists(created.output)) {
    console.log(`Queue ${name} already exists.`);
    return;
  }
  throw new Error(`Could not create Queue ${name}:\n${created.output}`);
}

function queueExists(name) {
  const listed = wrangler(["queues", "list"], { allowFailure: true });
  if (listed.status !== 0) return false;
  return listedResourceExists(listed.output, name);
}

function ensureVectorize(name, dimensions, metric) {
  const listed = wrangler(["vectorize", "list", "--json"]);
  if (listed.status !== 0) {
    throw new Error(`Could not list Vectorize indexes:\n${listed.output}`);
  }
  const indexes = parseJsonOutput(listed.output);
  const existing = indexes.find((item) => item?.name === name);
  if (existing) {
    const existingDimensions = Number(
      existing.config?.dimensions ?? existing.dimensions,
    );
    if (existingDimensions && existingDimensions !== dimensions) {
      throw new Error(
        `Vectorize index ${name} exists with ${existingDimensions} dimensions; FlareMo needs ${dimensions}.`,
      );
    }
    console.log(`Vectorize index ${name} already exists.`);
    return;
  }

  const created = wrangler([
    "vectorize",
    "create",
    name,
    "--dimensions",
    String(dimensions),
    "--metric",
    metric,
  ]);
  if (created.status !== 0 && !isAlreadyExists(created.output)) {
    throw new Error(
      `Could not create Vectorize index ${name}:\n${created.output}`,
    );
  }
  console.log(`Created Vectorize index ${name} (${dimensions}, ${metric}).`);
}

function patchDatabaseId(source, previousId, nextId) {
  if (previousId && source.includes(previousId)) {
    return source.replace(previousId, nextId);
  }
  throw new Error(
    "Could not write the new D1 database_id into wrangler.jsonc.",
  );
}

function patchPublicUrl(source, previousUrl, nextUrl) {
  const needle = `"FLAREMO_PUBLIC_URL": ${JSON.stringify(previousUrl ?? "")}`;
  if (!source.includes(needle)) {
    throw new Error("Could not write FLAREMO_PUBLIC_URL into wrangler.jsonc.");
  }
  return source.replace(
    needle,
    `"FLAREMO_PUBLIC_URL": ${JSON.stringify(nextUrl)}`,
  );
}

async function resolvePublicUrl(resources) {
  if (!isPlaceholderPublicUrl(resources.publicUrl)) {
    return new URL(String(resources.publicUrl).trim()).origin;
  }
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !token) {
    throw new Error(
      "FLAREMO_PUBLIC_URL is empty. Set it to a custom domain, or provide CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN so the workers.dev origin can be derived.",
    );
  }
  const subdomain = await fetchWorkersSubdomain(accountId, token);
  if (!subdomain) {
    throw new Error(
      "This Cloudflare account has no workers.dev subdomain yet. Open Workers in the Cloudflare dashboard and create one, or set FLAREMO_PUBLIC_URL to your custom domain.",
    );
  }
  return workersDevOrigin(resources.workerName, subdomain);
}

async function fetchWorkersSubdomain(accountId, token) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const body = await response.json().catch(() => ({}));
  if (response.status === 404) return "";
  if (!response.ok) {
    const detail = body?.errors?.[0]?.message || `HTTP ${response.status}`;
    throw new Error(`Could not read workers.dev subdomain: ${detail}`);
  }
  const subdomain = body?.result?.subdomain;
  return typeof subdomain === "string" ? subdomain.trim() : "";
}

function parseJsonOutput(output) {
  const start = output.indexOf("[");
  const objectStart = output.indexOf("{");
  const jsonStart =
    start === -1
      ? objectStart
      : objectStart === -1
        ? start
        : Math.min(start, objectStart);
  if (jsonStart === -1) return [];
  const parsed = JSON.parse(output.slice(jsonStart));
  return Array.isArray(parsed)
    ? parsed
    : (parsed?.indexes ?? parsed?.result ?? parsed?.databases ?? []);
}

export function listedResourceExists(output, name) {
  const escaped = String(name).replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`, "m").test(output);
}

export function isAlreadyExists(output) {
  return /already exists|already been created|already taken|duplicate|conflict|a database with that name|code:\s*(7502|10004|10014|10073|11002|11009|409)\b/i.test(
    output,
  );
}

function wrangler(args, { allowFailure = false } = {}) {
  const result = spawnSync("pnpm", ["exec", "wrangler", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      CI: "true",
      WRANGLER_SEND_METRICS: "false",
    },
    input: "n\n",
    shell: process.platform === "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0 && !allowFailure) {
    return { status: result.status ?? 1, output };
  }
  return { status: result.status ?? 0, output };
}
