import { spawn } from "node:child_process";

const commands = [
  ["node", ["./scripts/check-persistence-manifest.mjs"]],
  ["pnpm", ["format:check"]],
  ["pnpm", ["check"]],
  ["pnpm", ["test"]],
  ["pnpm", ["build"]],
  ["pnpm", ["test:e2e"]],
];

for (const [index, [command, args]] of commands.entries()) {
  try {
    await run(command, args);
  } catch (error) {
    console.error(
      `Failed at step ${index + 1}/${commands.length}: ${command} ${args.join(" ")}`,
    );
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(`${command} ${args.join(" ")} failed with exit code ${code}`),
      );
    });
  });
}
