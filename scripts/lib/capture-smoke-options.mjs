import { resolve } from "node:path";

export const CAPTURE_LIVE_SMOKE_USAGE =
  "Usage: pnpm capture:live-smoke -- [--browser] [--allow-long] [--reference /absolute/path/reference.txt] [--max-cer 0..1] /absolute/path/to/mono-48k.f32";

export function parseCaptureLiveSmokeArguments(cliArguments) {
  const argumentsToParse =
    cliArguments[0] === "--" ? cliArguments.slice(1) : cliArguments;
  const seen = new Set();
  let inputPath;
  let referencePath;
  let maxCer;
  let browserMode = false;
  let allowLong = false;

  for (let index = 0; index < argumentsToParse.length; index += 1) {
    const argument = argumentsToParse[index];
    if (argument === "--browser" || argument === "--allow-long") {
      if (seen.has(argument)) throw new Error(`Duplicate option: ${argument}`);
      seen.add(argument);
      if (argument === "--browser") browserMode = true;
      else allowLong = true;
      continue;
    }
    if (argument === "--reference" || argument === "--max-cer") {
      if (seen.has(argument)) throw new Error(`Duplicate option: ${argument}`);
      seen.add(argument);
      const value = argumentsToParse[index + 1];
      if (!value || value.startsWith("--"))
        throw new Error(`Missing value for ${argument}.`);
      index += 1;
      if (argument === "--reference") referencePath = resolve(value);
      else {
        maxCer = Number(value);
        if (!Number.isFinite(maxCer) || maxCer < 0 || maxCer > 1)
          throw new Error("--max-cer must be a number from 0 to 1.");
      }
      continue;
    }
    if (argument.startsWith("--"))
      throw new Error(`Unknown option: ${argument}`);
    if (inputPath) throw new Error("Provide exactly one PCM fixture.");
    inputPath = resolve(argument);
  }

  if (!inputPath) return undefined;
  if (maxCer !== undefined && !referencePath)
    throw new Error("--max-cer requires --reference.");
  return { inputPath, referencePath, maxCer, browserMode, allowLong };
}
