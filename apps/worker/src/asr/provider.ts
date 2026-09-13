import type { FlareMoEnv } from "../env";
import { createDashscopeProvider } from "./dashscope";
import { createTencentProvider } from "./tencent";
import type { StreamingAsrProvider } from "./types";

type AsrEnv = Pick<
  FlareMoEnv,
  | "FLAREMO_ASR_PROVIDER"
  | "FLAREMO_ASR_MODEL"
  | "FLAREMO_ASR_DASHSCOPE_API_KEY"
  | "FLAREMO_ASR_TENCENT_APP_ID"
  | "FLAREMO_ASR_TENCENT_HOTWORD_ID"
  | "FLAREMO_ASR_TENCENT_HOTWORD_LIST"
  | "FLAREMO_ASR_TENCENT_SECRET_ID"
  | "FLAREMO_ASR_TENCENT_SECRET_KEY"
>;

function normalizeHotwordId(value: string | undefined) {
  const id = value?.trim();
  if (!id) return undefined;
  return /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : null;
}

function normalizeHotwordList(value: string | undefined) {
  const configured = value?.trim();
  if (!configured) return undefined;
  const entries = configured.split(",");
  if (entries.length > 128) return null;
  const normalized: string[] = [];
  for (const entry of entries) {
    const parts = entry.split("|");
    if (parts.length !== 2) return null;
    const word = parts[0]?.trim() ?? "";
    const weight = parts[1]?.trim() ?? "";
    if (
      !word ||
      /\s/.test(word) ||
      new TextEncoder().encode(word).byteLength > 30 ||
      !/^(?:[1-9]|1[01]|100)$/.test(weight)
    )
      return null;
    normalized.push(`${word}|${weight}`);
  }
  return normalized.join(",");
}

// Configuration readiness only: this does not call a paid API or verify quota.
export function getConfiguredAsr(env: AsrEnv): {
  id: "dashscope" | "tencent";
  provider: StreamingAsrProvider;
} | null {
  const model = env.FLAREMO_ASR_MODEL?.trim() || undefined;
  switch (env.FLAREMO_ASR_PROVIDER ?? "dashscope") {
    case "dashscope": {
      const key = env.FLAREMO_ASR_DASHSCOPE_API_KEY?.trim();
      return key
        ? { id: "dashscope", provider: createDashscopeProvider(key, model) }
        : null;
    }
    case "tencent": {
      const appId = env.FLAREMO_ASR_TENCENT_APP_ID?.trim();
      const secretId = env.FLAREMO_ASR_TENCENT_SECRET_ID?.trim();
      const secretKey = env.FLAREMO_ASR_TENCENT_SECRET_KEY?.trim();
      const hotwordId = normalizeHotwordId(env.FLAREMO_ASR_TENCENT_HOTWORD_ID);
      const hotwordList = normalizeHotwordList(
        env.FLAREMO_ASR_TENCENT_HOTWORD_LIST,
      );
      if (!appId || !/^\d+$/.test(appId) || !secretId || !secretKey)
        return null;
      // Capture sends 16 kHz PCM; exclude file-only, 8 kHz and short preview engines.
      if (model && !/^16k_[a-zA-Z0-9_-]+$/.test(model)) return null;
      if (hotwordId === null || hotwordList === null) return null;
      // Tencent gives temporary hotwords precedence. Reject ambiguous config
      // rather than silently applying a different vocabulary than intended.
      if (hotwordId && hotwordList) return null;
      // Weight 100 is forced homophone replacement and is only documented for
      // selected Chinese engines. Keep it out of the default mixed model.
      if (hotwordList?.split(",").some((entry) => entry.endsWith("|100"))) {
        if (model !== "16k_zh") return null;
      }
      return {
        id: "tencent",
        provider: createTencentProvider({ appId, secretId, secretKey }, model, {
          hotwordId,
          hotwordList,
        }),
      };
    }
    default:
      return null;
  }
}
