#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseJsonc, printParseErrorCode } from "jsonc-parser";
import {
  findMissingSecretNames,
  inspectCaptureProductionConfig,
  parseWranglerSecretNames,
} from "./lib/capture-production-config.mjs";

await run().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Capture production check failed.",
  );
  process.exitCode = 1;
});

async function run() {
  const options = parseArguments(process.argv.slice(2));
  const source = await readFile(options.configPath, "utf8").catch((error) => {
    throw new Error(
      `Cannot read Wrangler config ${options.configPath}: ${error.message}`,
    );
  });
  const parseErrors = [];
  const config = parseJsonc(source, parseErrors, { allowTrailingComma: true });
  if (parseErrors.length > 0) {
    throw new Error(
      `Cannot parse Wrangler config: ${parseErrors
        .map((error) => printParseErrorCode(error.error))
        .join(", ")}`,
    );
  }

  const result = inspectCaptureProductionConfig(config);
  if (result.errors.length > 0) {
    throw new Error(
      `Capture production configuration is incomplete:\n${result.errors
        .map((problem) => `- ${problem}`)
        .join("\n")}`,
    );
  }
  for (const warning of result.warnings) console.warn(`Warning: ${warning}`);

  if (!options.remote) {
    console.log(
      `Capture production config passed for ${result.provider}. Remote Worker secret names were not checked.`,
    );
    console.log(
      "Run `pnpm capture:production:check -- --remote` before deployment to verify required secret names.",
    );
    return;
  }

  const secretNames = await listRemoteSecretNames(options.configPath);
  const missing = findMissingSecretNames(result.requiredSecrets, secretNames);
  if (missing.length > 0) {
    throw new Error(
      `Required Worker secret names are missing:\n${missing
        .map((name) => `- ${name}`)
        .join("\n")}`,
    );
  }
  console.log(
    `Capture production readiness passed for ${result.provider}: config and ${result.requiredSecrets.length} required Worker secret names are present.`,
  );
}

function parseArguments(args) {
  let configPath = resolve("wrangler.jsonc");
  let remote = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--remote") {
      remote = true;
      continue;
    }
    if (argument === "--config") {
      const value = args[index + 1];
      if (!value) throw new Error("--config requires a path.");
      configPath = resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return { configPath, remote };
}

function listRemoteSecretNames(configPath) {
  const executable = resolve(
    "node_modules",
    ".bin",
    process.platform === "win32" ? "wrangler.cmd" : "wrangler",
  );
  return new Promise((resolveNames, reject) => {
    const child = spawn(
      executable,
      ["secret", "list", "--config", configPath, "--format", "json"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Wrangler could not list remote secret names (exit ${code ?? "unknown"}). ${stderr.trim()}`,
          ),
        );
        return;
      }
      try {
        resolveNames(parseWranglerSecretNames(JSON.parse(stdout)));
      } catch {
        reject(new Error("Wrangler returned an invalid secret-name response."));
      }
    });
  });
}
