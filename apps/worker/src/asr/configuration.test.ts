import { describe, expect, it } from "vitest";
import { openVoiceCredentials, sealVoiceCredentials } from "./configuration";

const key = "test-only-encryption-key-with-at-least-32-characters";
const value = {
  provider: "tencent" as const,
  model: "",
  appId: "1234",
  secretId: "test-id",
  secretKey: "test-sensitive-value",
  apiKey: "",
};
describe("voice credential encryption", () => {
  it("uses fresh nonces, round trips and never stores plaintext", async () => {
    const a = await sealVoiceCredentials(key, value);
    const b = await sealVoiceCredentials(key, value);
    expect(a).not.toEqual(b);
    expect(a).not.toContain(value.secretKey);
    expect(await openVoiceCredentials(key, a)).toEqual(value);
    await expect(openVoiceCredentials(`${key}-wrong`, a)).rejects.toThrow();
    const tampered = JSON.parse(a);
    tampered.data[0] ^= 1;
    await expect(
      openVoiceCredentials(key, JSON.stringify(tampered)),
    ).rejects.toThrow();
  });
  it("requires an independent encryption secret", async () => {
    await expect(sealVoiceCredentials(undefined, value)).rejects.toThrow();
  });
});
