import { describe, expect, it } from "vitest";
import { getPublicUrl, getTrustedOrigins } from "./auth-env";
import type { FlareMoEnv } from "./env";

function envWith(fields: Partial<FlareMoEnv>): FlareMoEnv {
  return fields as FlareMoEnv;
}

describe("getPublicUrl", () => {
  it("accepts https origins and local http development hosts", () => {
    expect(
      getPublicUrl(
        envWith({ FLAREMO_PUBLIC_URL: "https://notes.example.com" }),
      ),
    ).toBe("https://notes.example.com");
    expect(
      getPublicUrl(envWith({ FLAREMO_PUBLIC_URL: "http://localhost:5573" })),
    ).toBe("http://localhost:5573");
  });

  it("rejects plain http outside local development and paths", () => {
    expect(() =>
      getPublicUrl(envWith({ FLAREMO_PUBLIC_URL: "http://notes.example.com" })),
    ).toThrow(/HTTPS/);
    expect(() =>
      getPublicUrl(
        envWith({ FLAREMO_PUBLIC_URL: "https://notes.example.com/app" }),
      ),
    ).toThrow(/without a path/);
  });
});

describe("getTrustedOrigins", () => {
  it("always includes the public URL and configured https origins", () => {
    expect(
      getTrustedOrigins(
        envWith({
          FLAREMO_PUBLIC_URL: "https://notes.example.com",
          FLAREMO_TRUSTED_ORIGINS:
            "https://app.example.com, http://localhost:5173",
        }),
      ),
    ).toEqual([
      "https://notes.example.com",
      "https://app.example.com",
      "http://localhost:5173",
    ]);
  });

  it("rejects plain http extra origins outside local development", () => {
    expect(() =>
      getTrustedOrigins(
        envWith({
          FLAREMO_PUBLIC_URL: "https://notes.example.com",
          FLAREMO_TRUSTED_ORIGINS: "http://app.example.com",
        }),
      ),
    ).toThrow(/HTTPS/);
  });

  it("rejects origins with a path", () => {
    expect(() =>
      getTrustedOrigins(
        envWith({
          FLAREMO_PUBLIC_URL: "https://notes.example.com",
          FLAREMO_TRUSTED_ORIGINS: "https://app.example.com/notes",
        }),
      ),
    ).toThrow(/without paths/);
  });
});
