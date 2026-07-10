import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";

const persistDir = ".wrangler-e2e";
const port = "18787";
const isWindows = process.platform === "win32";

rmSync(persistDir, { recursive: true, force: true });
run("pnpm", ["--filter", "@flaremo/web", "build"]);
run("pnpm", [
  "exec",
  "wrangler",
  "d1",
  "migrations",
  "apply",
  "DB",
  "--local",
  "--persist-to",
  persistDir,
]);

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
  ],
  {
    shell: isWindows,
    stdio: "inherit",
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

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
    shell: isWindows,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
