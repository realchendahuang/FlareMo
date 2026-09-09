/**
 * Shared local dev-server plumbing for scripts that need a full local
 * FlareMo stack: build the web app, apply D1 migrations into a dedicated
 * persist directory, then run `wrangler dev` against it.
 *
 * Consumers own the persist directory lifecycle (they decide when it is
 * created and removed) and the readiness contract: either poll HTTP
 * readiness themselves via `waitForHttpReady`, or hand the URL to another
 * supervisor (Playwright's webServer does this for e2e runs).
 */
import { spawn, spawnSync } from "node:child_process";

// Single source of truth for the local E2E port. It lives in this plain .mjs
// module because scripts/e2e-server.mjs runs under plain Node and cannot
// import the TypeScript fixtures in tests/e2e; tests/e2e/auth-fixture.ts
// re-exports it from here.
export const E2E_PORT = "18787";

const FORCE_KILL_DELAY_MS = 5_000;
const pendingForceKills = new WeakMap();

/**
 * Build @flaremo/web, apply local D1 migrations into `persistDir`, then
 * spawn `wrangler dev`. The child runs in its own process group on POSIX so
 * `stopDevServer` can tear down the whole pnpm -> wrangler -> workerd tree.
 */
export function startDevServer({
  persistDir,
  bindings = [],
  env = process.env,
  port,
  stdio = "inherit",
}) {
  run("pnpm", ["--filter", "@flaremo/web", "build"], env);
  run(
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      "--persist-to",
      persistDir,
    ],
    env,
  );

  const args = [
    "exec",
    "wrangler",
    "dev",
    "--config",
    "./wrangler.jsonc",
    "--local",
    "--host",
    "127.0.0.1",
  ];
  if (port !== undefined) {
    args.push("--port", port);
  }
  args.push(
    "--persist-to",
    persistDir,
    "--log-level",
    "error",
    ...bindings.flatMap((binding) => ["--var", binding]),
  );

  return spawn("pnpm", args, {
    detached: process.platform !== "win32",
    env,
    shell: process.platform === "win32",
    stdio,
  });
}

/**
 * Stop a server spawned by `startDevServer`: SIGTERM the process group, then
 * escalate to SIGKILL after a short grace period so a wedged workerd can
 * never outlive the caller. Safe to call more than once.
 */
export function stopDevServer(server) {
  if (hasExited(server)) return;
  signalChild(server, "SIGTERM");
  if (pendingForceKills.has(server)) return;
  const timer = setTimeout(() => {
    pendingForceKills.delete(server);
    if (hasExited(server)) return;
    signalChild(server, "SIGKILL");
  }, FORCE_KILL_DELAY_MS);
  timer.unref();
  pendingForceKills.set(server, timer);
}

/**
 * Poll `url` until it answers with an OK response, or throw after `timeoutMs`.
 */
export async function waitForHttpReady(
  url,
  { intervalMs = 500, timeoutMs = 120_000 } = {},
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep waiting.
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function hasExited(server) {
  return server.exitCode !== null || server.signalCode !== null;
}

function signalChild(server, signal) {
  if (process.platform === "win32") {
    server.kill(signal);
    return;
  }
  try {
    process.kill(-server.pid, signal);
  } catch {
    server.kill(signal);
  }
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env,
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
