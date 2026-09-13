#!/usr/bin/env node

import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CAPTURE_GATE_HEALTH_PATH,
  CAPTURE_GATE_HEALTH_VALUE,
  startCaptureAccessGate,
} from "./lib/capture-access-gate.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(repoRoot);

class TemporaryTunnelError extends Error {}

await run().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Phone Capture failed.",
  );
  process.exitCode = 1;
});

async function run() {
  const options = parseArguments(process.argv.slice(2));
  if (options.appPort === options.gatePort)
    throw new Error("Capture app and access-gate ports must be different.");
  await Promise.all([
    assertPortAvailable(options.appPort),
    assertPortAvailable(options.gatePort),
  ]);

  let appProcess;
  let tunnelProcess;
  let gate;
  let stopRequested = false;
  let cleanupPromise = Promise.resolve();
  const stopSessionProcesses = () => {
    const currentApp = appProcess;
    const currentTunnel = tunnelProcess;
    appProcess = undefined;
    tunnelProcess = undefined;
    cleanupPromise = cleanupPromise.then(() =>
      Promise.allSettled([stopChild(currentApp), stopChild(currentTunnel)]),
    );
    return cleanupPromise;
  };
  const stopProcesses = () => {
    const currentApp = appProcess;
    const currentTunnel = tunnelProcess;
    const currentGate = gate;
    appProcess = undefined;
    tunnelProcess = undefined;
    gate = undefined;
    cleanupPromise = cleanupPromise.then(() =>
      Promise.allSettled([
        stopChild(currentApp),
        stopChild(currentTunnel),
        currentGate?.close(),
      ]),
    );
    return cleanupPromise;
  };
  const onSignal = () => {
    stopRequested = true;
    void stopProcesses();
  };
  const launcherPid = process.ppid;
  const parentWatch = setInterval(() => {
    if (process.ppid !== launcherPid) onSignal();
  }, 1_000);
  parentWatch.unref();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    gate = await startCaptureAccessGate({
      notice:
        "这是 Mac mini 本地验收环境。保存内容只写入本机，不会进入正式 FlareMo。",
      port: options.gatePort,
      upstreamPort: options.appPort,
    });
    if (stopRequested) return;
    let recoveryCount = 0;
    while (!stopRequested) {
      try {
        let publicOrigin;
        let lastTunnelError;
        const tunnelAttempts = options.tunnelProvider === "cloudflare" ? 5 : 3;
        for (let attempt = 1; attempt <= tunnelAttempts; attempt += 1) {
          const tunnel = startTunnel(gate.url, options.tunnelProvider);
          tunnelProcess = tunnel.process;
          try {
            publicOrigin = await tunnel.origin;
            break;
          } catch (error) {
            lastTunnelError = error;
            await stopChild(tunnelProcess);
            tunnelProcess = undefined;
            if (stopRequested) return;
            if (attempt < tunnelAttempts)
              console.log(
                `Tunnel attempt ${attempt} did not become ready; retrying with a new URL...`,
              );
          }
        }
        if (!publicOrigin) {
          throw new TemporaryTunnelError(
            lastTunnelError instanceof Error
              ? lastTunnelError.message
              : "Temporary tunnel failed.",
          );
        }
        if (stopRequested) return;
        const app = startApp(options, publicOrigin);
        appProcess = app.process;
        await app.ready;
        if (stopRequested) return;
        await waitForPublicTunnel(publicOrigin, () => stopRequested);
        if (stopRequested) return;
        printAccess(
          publicOrigin,
          gate.accessKey(),
          recoveryCount === 0
            ? undefined
            : "Temporary phone access restored after tunnel interruption",
          options.persistRoot,
        );

        await waitForControl({
          appProcess,
          gate,
          publicOrigin,
          persistRoot: options.persistRoot,
          tunnelProcess,
          tunnelProvider: options.tunnelProvider,
        });
        break;
      } catch (error) {
        if (stopRequested) return;
        if (!(error instanceof TemporaryTunnelError)) throw error;
        recoveryCount += 1;
        await stopSessionProcesses();
        const retrySeconds = Math.min(30, 2 ** Math.min(recoveryCount, 5));
        console.error(`Temporary phone access interrupted: ${error.message}`);
        console.log(
          `Rebuilding the tunnel in ${retrySeconds} seconds. The access key and local D1 remain unchanged; press Ctrl+C to stop.`,
        );
        await waitForRetry(retrySeconds, () => stopRequested);
      }
    }
  } catch (error) {
    if (!stopRequested) throw error;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    clearInterval(parentWatch);
    await stopProcesses();
    console.log("Temporary Capture tunnel closed; access key revoked.");
  }
}

function startTunnel(gateUrl, provider) {
  if (provider === "localhost-run") return startLocalhostRunTunnel(gateUrl);
  return startCloudflareTunnel(gateUrl);
}

function startCloudflareTunnel(gateUrl) {
  const child = spawn(
    "cloudflared",
    [
      "tunnel",
      "--no-autoupdate",
      "--protocol",
      "quic",
      "--retries",
      "10",
      "--url",
      gateUrl,
      "--loglevel",
      "info",
    ],
    {
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  let publicOrigin;
  let registered = false;
  const origin = new Promise((resolveOrigin, rejectOrigin) => {
    const timeout = setTimeout(() => {
      rejectOrigin(
        new Error(
          "Cloudflare quick tunnel did not register an edge connection.",
        ),
      );
    }, 45_000);
    const resolveWhenReady = () => {
      if (!publicOrigin || !registered) return;
      clearTimeout(timeout);
      resolveOrigin(publicOrigin);
    };
    const consume = (chunk) => {
      output = `${output}${chunk}`.slice(-32_768);
      const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (match) publicOrigin = new URL(match[0]).origin;
      if (/Registered tunnel connection/i.test(output)) registered = true;
      resolveWhenReady();
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectOrigin(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      rejectOrigin(
        new Error(
          `Cloudflare quick tunnel exited before startup (code ${code ?? "unknown"}).`,
        ),
      );
    });
  });
  return { origin, process: child };
}

function startLocalhostRunTunnel(gateUrl) {
  const target = new URL(gateUrl);
  const child = spawn(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "ServerAliveInterval=30",
      "-o",
      "ServerAliveCountMax=3",
      "-o",
      "ExitOnForwardFailure=yes",
      "-R",
      `80:${target.hostname}:${target.port}`,
      "nokey@localhost.run",
      "--",
      "--output",
      "json",
    ],
    {
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  const origin = new Promise((resolveOrigin, rejectOrigin) => {
    const timeout = setTimeout(() => {
      rejectOrigin(
        new Error("localhost.run did not provide a public HTTPS URL."),
      );
    }, 30_000);
    const consume = (chunk) => {
      output = `${output}${chunk}`.slice(-32_768);
      const match = output.match(/https:\/\/[a-z0-9-]+\.lhr\.life/i);
      if (!match) return;
      clearTimeout(timeout);
      resolveOrigin(new URL(match[0]).origin);
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectOrigin(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      rejectOrigin(
        new Error(
          `localhost.run exited before startup (code ${code ?? "unknown"}).`,
        ),
      );
    });
  });
  return { origin, process: child };
}

function startApp(options, publicOrigin) {
  const args = [
    process.env.FLAREMO_CAPTURE_LOCAL_SCRIPT ??
      "./scripts/capture-local-server.mjs",
    "--port",
    String(options.appPort),
    "--persist-to",
    options.persistRoot,
    "--public-url",
    publicOrigin,
  ];
  if (options.reuseWebBuild) args.push("--reuse-web-build");
  if (options.reuseWorkerBundle)
    args.push("--reuse-worker-bundle", options.reuseWorkerBundle);
  if (options.skipMigrations) args.push("--skip-migrations");
  const child = spawn(process.execPath, args, {
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const ready = new Promise((resolveReady, rejectReady) => {
    const timeout = setTimeout(() => {
      rejectReady(
        new Error("FlareMo did not become ready within three minutes."),
      );
    }, 180_000);
    const consume = (chunk, destination) => {
      const text = String(chunk);
      destination.write(text);
      output = `${output}${text}`.slice(-16_384);
      if (!output.includes("Capture local server ready:")) return;
      clearTimeout(timeout);
      resolveReady();
    };
    child.stdout.on("data", (chunk) => consume(chunk, process.stdout));
    child.stderr.on("data", (chunk) => consume(chunk, process.stderr));
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectReady(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      rejectReady(
        new Error(`FlareMo exited before startup (code ${code ?? "unknown"}).`),
      );
    });
  });
  return { process: child, ready };
}

function waitForControl({
  appProcess,
  gate,
  publicOrigin,
  persistRoot,
  tunnelProcess,
  tunnelProvider,
}) {
  return new Promise((resolveControl, rejectControl) => {
    let buffer = "";
    let healthCheckRunning = false;
    let healthFailures = 0;
    let settled = false;
    let cleanup = () => {};
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) rejectControl(error);
      else resolveControl();
    };
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    const onData = (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const command = line.trim().toLowerCase();
        if (command === "r") {
          printAccess(
            publicOrigin,
            gate.rotate(),
            "Access key rotated",
            persistRoot,
          );
        } else if (command === "o") {
          gate.disableVerification();
          console.log(
            "Access-key verification disabled; anyone with the URL can reach FlareMo login.",
          );
          console.log(
            "Enter r to protect it with a new key, or q to close it.",
          );
        } else if (command === "x") {
          gate.revoke();
          console.log("Access key and all temporary browser sessions revoked.");
          console.log(
            "Enter r to generate a new key, or q to close the tunnel.",
          );
        } else if (command === "q") {
          finish();
        } else if (command) {
          console.log(
            "Commands: r = protect with a new key, o = disable key verification, x = revoke access, q = close tunnel",
          );
        }
      }
    };
    const onSignal = () => finish();
    const onAppExit = (code) =>
      finish(
        new Error(`FlareMo stopped unexpectedly (code ${code ?? "unknown"}).`),
      );
    const onTunnelExit = (code) =>
      finish(
        new TemporaryTunnelError(
          `Temporary tunnel stopped unexpectedly (code ${code ?? "unknown"}).`,
        ),
      );
    process.stdin.on("data", onData);
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    appProcess.once("exit", onAppExit);
    tunnelProcess.once("exit", onTunnelExit);
    const healthTimer = setInterval(async () => {
      if (healthCheckRunning || settled) return;
      healthCheckRunning = true;
      try {
        await checkPublicTunnel(publicOrigin);
        healthFailures = 0;
      } catch {
        healthFailures += 1;
        if (healthFailures >= 3)
          finish(
            new TemporaryTunnelError(
              `${tunnelProvider} stopped responding; creating a new URL.`,
            ),
          );
      } finally {
        healthCheckRunning = false;
      }
    }, 20_000);
    healthTimer.unref();
    cleanup = () => {
      clearInterval(healthTimer);
      process.stdin.off("data", onData);
      process.stdin.pause();
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      appProcess.off("exit", onAppExit);
      tunnelProcess.off("exit", onTunnelExit);
    };
  });
}

async function waitForPublicTunnel(publicOrigin, shouldStop = () => false) {
  let lastError;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    if (shouldStop()) return;
    try {
      await checkPublicTunnel(publicOrigin);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
    }
  }
  throw new TemporaryTunnelError(
    `Temporary tunnel is not reachable from the public internet: ${
      lastError instanceof Error ? lastError.message : "connection failed"
    }`,
  );
}

async function checkPublicTunnel(publicOrigin) {
  const response = await fetch(
    new URL(CAPTURE_GATE_HEALTH_PATH, publicOrigin),
    {
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (
    response.status !== 204 ||
    response.headers.get("x-flaremo-capture-gate") !== CAPTURE_GATE_HEALTH_VALUE
  )
    throw new Error(`unexpected health response ${response.status}`);
  await response.body?.cancel();
}

async function waitForRetry(seconds, shouldStop) {
  const deadline = Date.now() + seconds * 1_000;
  while (!shouldStop() && Date.now() < deadline) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
}

function printAccess(
  publicOrigin,
  accessKey,
  heading = "Temporary phone access ready",
  persistRoot,
) {
  console.log("");
  console.log(`=== ${heading} ===`);
  console.log(`URL: ${new URL("/capture", publicOrigin)}`);
  console.log(`Access key: ${accessKey}`);
  console.log(`Data: local D1 under ${persistRoot} (not production)`);
  console.log("r + Enter: protect with a new key and revoke existing sessions");
  console.log("o + Enter: disable access-key verification");
  console.log("x + Enter: revoke key and block all temporary access");
  console.log("q + Enter: close tunnel");
  console.log("FlareMo login is still required after the access key.");
  console.log("");
}

function parseArguments(arguments_) {
  const values = arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
  let appPort = 8790;
  let gatePort = 8791;
  let persistRoot = resolve(".wrangler/state");
  let reuseWebBuild = false;
  let reuseWorkerBundle;
  let skipMigrations = false;
  let tunnelProvider = "localhost-run";
  for (let index = 0; index < values.length; ) {
    const option = values[index];
    if (option === "--reuse-web-build") {
      reuseWebBuild = true;
      index += 1;
      continue;
    }
    if (option === "--skip-migrations") {
      skipMigrations = true;
      index += 1;
      continue;
    }
    const value = values[index + 1];
    if (!value) throw new Error(`Missing value for ${option ?? "argument"}.`);
    if (option === "--port") appPort = parsePort(value, "app");
    else if (option === "--gate-port") gatePort = parsePort(value, "gate");
    else if (option === "--persist-to") persistRoot = resolve(value);
    else if (option === "--reuse-worker-bundle")
      reuseWorkerBundle = resolve(value);
    else if (option === "--tunnel-provider") {
      if (!new Set(["cloudflare", "localhost-run"]).has(value))
        throw new Error(
          "Capture tunnel provider must be cloudflare or localhost-run.",
        );
      tunnelProvider = value;
    } else throw new Error(`Unknown Capture phone option: ${option}.`);
    index += 2;
  }
  return {
    appPort,
    gatePort,
    persistRoot,
    reuseWebBuild,
    reuseWorkerBundle,
    skipMigrations,
    tunnelProvider,
  };
}

function parsePort(value, label) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error(`Capture ${label} port must be between 1 and 65535.`);
  return port;
}

async function assertPortAvailable(port) {
  const server = createServer();
  server.unref();
  try {
    server.listen(port, "127.0.0.1");
    await once(server, "listening");
  } catch {
    throw new Error(`Local port ${port} is already in use.`);
  } finally {
    if (server.listening)
      await new Promise((resolveClose) => server.close(resolveClose));
  }
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === "win32") child.kill("SIGTERM");
    else process.kill(-child.pid, "SIGTERM");
  } catch {
    return;
  }
  const exited = once(child, "exit");
  let timeoutId;
  const timeout = new Promise((resolveTimeout) => {
    timeoutId = setTimeout(() => resolveTimeout(false), 5_000);
  });
  const didExit = await Promise.race([exited.then(() => true), timeout]);
  clearTimeout(timeoutId);
  if (didExit) return;
  try {
    if (process.platform === "win32") child.kill("SIGKILL");
    else process.kill(-child.pid, "SIGKILL");
  } catch {
    // The process exited between the timeout and forced cleanup.
  }
}
