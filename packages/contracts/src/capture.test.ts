import { describe, expect, it } from "vitest";
import {
  captureClientMessageSchema,
  captureServerMessageSchema,
} from "./capture";

describe("capture protocol", () => {
  it("rejects provider-specific browser messages", () => {
    expect(
      captureClientMessageSchema.safeParse({ header: { action: "run-task" } })
        .success,
    ).toBe(false);
    expect(
      captureClientMessageSchema.safeParse({
        type: "start",
        sampleRate: 16_000,
        encoding: "pcm_s16le",
      }).success,
    ).toBe(true);
  });

  it("validates normalized sentence events", () => {
    expect(
      captureServerMessageSchema.safeParse({
        type: "sentence",
        id: "s1",
        text: "hello",
        final: true,
        receivedAt: Date.now(),
      }).success,
    ).toBe(true);
    expect(
      captureServerMessageSchema.safeParse({
        type: "sentence",
        id: "s1",
        text: "",
        final: true,
        receivedAt: Date.now(),
      }).success,
    ).toBe(false);
  });

  it("carries a safe retry decision without provider diagnostics", () => {
    expect(
      captureServerMessageSchema.parse({
        type: "error",
        code: "ASR_UPSTREAM_FAILED",
        message: "Capture interrupted",
        retryable: false,
      }),
    ).toMatchObject({ retryable: false });
  });
});
