import { createDb } from "@flaremo/db";
import { readVoiceService } from "@flaremo/domain";
import { z } from "zod";
import type { FlareMoEnv } from "../env";
import { getConfiguredAsr } from "./provider";

export const voiceCredentialsSchema = z
  .object({
    provider: z.enum(["tencent", "dashscope"]),
    model: z.string().trim().max(128).default(""),
    appId: z.string().trim().max(128).default(""),
    secretId: z.string().trim().max(256).default(""),
    secretKey: z.string().trim().max(1024).default(""),
    apiKey: z.string().trim().max(1024).default(""),
  })
  .strict();
export type VoiceCredentials = z.infer<typeof voiceCredentialsSchema>;
const aad = new TextEncoder().encode("flaremo:voice-service:v1");
async function encryptionKey(secret: string | undefined) {
  if (!secret || secret.length < 32)
    throw new Error("Voice encryption key unavailable");
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
export async function sealVoiceCredentials(
  secret: string | undefined,
  value: VoiceCredentials,
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    await encryptionKey(secret),
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return JSON.stringify({
    v: 1,
    iv: Array.from(iv),
    data: Array.from(new Uint8Array(ciphertext)),
  });
}
export async function openVoiceCredentials(
  secret: string | undefined,
  envelope: string,
) {
  const value = JSON.parse(envelope);
  if (value.v !== 1) throw new Error("Invalid credential version");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(value.iv), additionalData: aad },
    await encryptionKey(secret),
    new Uint8Array(value.data),
  );
  return voiceCredentialsSchema.parse(
    JSON.parse(new TextDecoder().decode(plaintext)),
  );
}
export function configuredVoice(value: VoiceCredentials) {
  return getConfiguredAsr({
    FLAREMO_ASR_PROVIDER: value.provider,
    FLAREMO_ASR_MODEL: value.model,
    FLAREMO_ASR_TENCENT_APP_ID: value.appId,
    FLAREMO_ASR_TENCENT_SECRET_ID: value.secretId,
    FLAREMO_ASR_TENCENT_SECRET_KEY: value.secretKey,
    FLAREMO_ASR_DASHSCOPE_API_KEY: value.apiKey,
  });
}
export async function resolveVoiceService(env: FlareMoEnv) {
  const row = await readVoiceService(createDb(env.DB));
  if (!row) return null;
  if (!row.enabled || !row.ciphertext) return null;
  try {
    return configuredVoice(
      await openVoiceCredentials(env.FLAREMO_VOICE_CONFIG_KEY, row.ciphertext),
    );
  } catch {
    return null;
  } // Never silently fall back to environment credentials.
}
