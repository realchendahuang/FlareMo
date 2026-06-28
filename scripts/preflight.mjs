import { spawn } from "node:child_process";

const commands = [
  ["pnpm", ["format:check"]],
  ["pnpm", ["check"]],
  ["pnpm", ["test"]],
  ["pnpm", ["build"]],
  ["pnpm", ["test:e2e"]],
];

for (const [command, args] of commands) {
  await run(command, args);
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
