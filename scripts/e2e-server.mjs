import { rmSync } from "node:fs";
import { E2E_PORT, startDevServer, stopDevServer } from "./lib/dev-server.mjs";

const persistDir = ".wrangler-e2e";
const testPublicUrl = `http://127.0.0.1:${E2E_PORT}`;
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

const server = startDevServer({
  persistDir,
  port: E2E_PORT,
  bindings: testBindings,
  env: testProcessEnv,
});

let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopDevServer(server);
  });
}

server.on("exit", (code) => {
  rmSync(persistDir, { recursive: true, force: true });
  process.exit(shuttingDown ? 0 : (code ?? 1));
});

server.on("error", (error) => {
  console.error(error);
  rmSync(persistDir, { recursive: true, force: true });
  process.exit(1);
});

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
