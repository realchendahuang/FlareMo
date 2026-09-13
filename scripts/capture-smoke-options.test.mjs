import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { parseCaptureLiveSmokeArguments } from "./lib/capture-smoke-options.mjs";

test("parses a scored browser smoke run independent of option order", () => {
  assert.deepEqual(
    parseCaptureLiveSmokeArguments([
      "--",
      "--max-cer",
      "0.15",
      "audio.f32",
      "--browser",
      "--reference",
      "reference.txt",
    ]),
    {
      inputPath: resolve("audio.f32"),
      referencePath: resolve("reference.txt"),
      maxCer: 0.15,
      browserMode: true,
      allowLong: false,
    },
  );
});

test("requires a reference when enforcing CER", () => {
  assert.throws(
    () => parseCaptureLiveSmokeArguments(["--max-cer", "0.1", "audio.f32"]),
    /requires --reference/,
  );
});

test("rejects unknown, duplicate, missing, and out-of-range options", () => {
  assert.throws(
    () => parseCaptureLiveSmokeArguments(["--unknown", "audio.f32"]),
    /Unknown option/,
  );
  assert.throws(
    () =>
      parseCaptureLiveSmokeArguments(["--browser", "--browser", "audio.f32"]),
    /Duplicate option/,
  );
  assert.throws(
    () => parseCaptureLiveSmokeArguments(["--reference"]),
    /Missing value/,
  );
  assert.throws(
    () => parseCaptureLiveSmokeArguments(["--max-cer", "1.1", "audio.f32"]),
    /number from 0 to 1/,
  );
  assert.equal(parseCaptureLiveSmokeArguments([]), undefined);
});
