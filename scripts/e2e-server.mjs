import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";

const persistDir = ".wrangler-e2e";
const port = "18787";
const isWindows = process.platform === "win32";
const testPublicUrl = "http://127.0.0.1:18787";
const testBetterAuthSecret =
  "flaremo-e2e-better-auth-secret-never-use-in-production-2026";
const testBootstrapSecret =
  "flaremo-e2e-bootstrap-secret-never-use-in-production-2026";
const testBindings = [
  `FLAREMO_PUBLIC_URL:${testPublicUrl}`,
  // Wrangler's local proxy normalizes Better Auth's origin check to the
  // loopback host without the test port. This is an explicit E2E-only origin;
  // production remains limited to its configured canonical HTTPS origin.
  "FLAREMO_TRUSTED_ORIGINS:http://127.0.0.1",
  `BETTER_AUTH_SECRET:${testBetterAuthSecret}`,
  `FLAREMO_BOOTSTRAP_SECRET:${testBootstrapSecret}`,
];
const testProcessEnv = createTestProcessEnv();

rmSync(persistDir, { recursive: true, force: true });
run("pnpm", ["--filter", "@flaremo/web", "build"], testProcessEnv);
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
  testProcessEnv,
);

const server = spawn(
  "pnpm",
  [
    "exec",
    "wrangler",
    "dev",
    "--config",
    "./wrangler.jsonc",
    "--local",
    "--host",
    "127.0.0.1",
    "--port",
    port,
    "--persist-to",
    persistDir,
    "--log-level",
    "error",
    ...testBindings.flatMap((binding) => ["--var", binding]),
  ],
  {
    shell: isWindows,
    stdio: "inherit",
    env: testProcessEnv,
  },
);

let shuttingDown = false;
let forceStopTimer;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopServer("SIGTERM");
    forceStopTimer = setTimeout(() => stopServer("SIGKILL"), 5_000);
    forceStopTimer.unref();
  });
}

server.on("exit", (code) => {
  if (forceStopTimer) clearTimeout(forceStopTimer);
  rmSync(persistDir, { recursive: true, force: true });
  process.exit(shuttingDown ? 0 : (code ?? 1));
});

server.on("error", (error) => {
  console.error(error);
  rmSync(persistDir, { recursive: true, force: true });
  process.exit(1);
});

function stopServer(signal) {
  if (server.exitCode !== null || server.signalCode !== null) return;
  if (isWindows) {
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
    shell: isWindows,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function createTestProcessEnv() {
  // Keep the local E2E process independent from production credentials. Only
  // ordinary process plumbing is inherited; all auth bindings are injected
  // above from test-only constants.
  const allowedKeys = [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "TMP",
    "TEMP",
    "TERM",
    "LANG",
    "LC_ALL",
    "PNPM_HOME",
    "COREPACK_HOME",
  ];
  const env = Object.fromEntries(
    allowedKeys.flatMap((key) => {
      const value = process.env[key];
      return value === undefined ? [] : [[key, value]];
    }),
  );
  env.CI = "1";
  return env;
}
