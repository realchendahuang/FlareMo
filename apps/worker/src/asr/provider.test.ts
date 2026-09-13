import { afterEach, describe, expect, it, vi } from "vitest";
import { getConfiguredAsr } from "./provider";

const tencent = {
  FLAREMO_ASR_PROVIDER: "tencent",
  FLAREMO_ASR_TENCENT_APP_ID: "1234567890",
  FLAREMO_ASR_TENCENT_SECRET_ID: "test-secret-id",
  FLAREMO_ASR_TENCENT_SECRET_KEY: "test-secret-key",
};
afterEach(() => vi.unstubAllGlobals());
describe("Capture provider configuration", () => {
  it("selects either provider without opening a connection or checking paid APIs", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(getConfiguredAsr(tencent)?.id).toBe("tencent");
    expect(
      getConfiguredAsr({ FLAREMO_ASR_DASHSCOPE_API_KEY: "test-key" })?.id,
    ).toBe("dashscope");
    expect(
      getConfiguredAsr({
        FLAREMO_ASR_PROVIDER: "unknown",
        FLAREMO_ASR_DASHSCOPE_API_KEY: "test-key",
      }),
    ).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("requires all Tencent fields and does not silently switch to another provider", () => {
    for (const name of [
      "FLAREMO_ASR_TENCENT_APP_ID",
      "FLAREMO_ASR_TENCENT_SECRET_ID",
      "FLAREMO_ASR_TENCENT_SECRET_KEY",
    ] as const) {
      expect(
        getConfiguredAsr({
          ...tencent,
          [name]: " ",
          FLAREMO_ASR_DASHSCOPE_API_KEY: "test-key",
        }),
      ).toBeNull();
    }
    expect(
      getConfiguredAsr({ ...tencent, FLAREMO_ASR_TENCENT_APP_ID: "../wrong" }),
    ).toBeNull();
  });
  it("rejects stale DashScope, file-only, 8 kHz and short preview model configuration", () => {
    for (const model of [
      "qwen-audio-3.0-asr-flash-streaming",
      "16k_zh_en_2.0",
      "8k_zh",
      "Hy-ASR-3.0-preview",
    ]) {
      expect(
        getConfiguredAsr({ ...tencent, FLAREMO_ASR_MODEL: model }),
      ).toBeNull();
    }
    expect(
      getConfiguredAsr({ ...tencent, FLAREMO_ASR_MODEL: "16k_zh_en" })?.id,
    ).toBe("tencent");
  });
  it("validates Tencent hotword hints before enabling Capture", () => {
    expect(
      getConfiguredAsr({
        ...tencent,
        FLAREMO_ASR_TENCENT_HOTWORD_ID: "da3f5f5555cf11eda6da525400aec391",
      })?.id,
    ).toBe("tencent");
    expect(
      getConfiguredAsr({
        ...tencent,
        FLAREMO_ASR_TENCENT_HOTWORD_LIST: " FlareMo|11,语音记录|7 ",
      })?.id,
    ).toBe("tencent");
    for (const hotwordList of [
      "Flare Mo|11",
      "FlareMo|0",
      "FlareMo|12",
      "一二三四五六七八九十甲|10",
      Array.from({ length: 129 }, (_, index) => `term${index}|1`).join(","),
    ]) {
      expect(
        getConfiguredAsr({
          ...tencent,
          FLAREMO_ASR_TENCENT_HOTWORD_LIST: hotwordList,
        }),
      ).toBeNull();
    }
    expect(
      getConfiguredAsr({
        ...tencent,
        FLAREMO_ASR_TENCENT_HOTWORD_ID: "table-id",
        FLAREMO_ASR_TENCENT_HOTWORD_LIST: "FlareMo|11",
      }),
    ).toBeNull();
    expect(
      getConfiguredAsr({
        ...tencent,
        FLAREMO_ASR_TENCENT_HOTWORD_LIST: "FlareMo|100",
      }),
    ).toBeNull();
    expect(
      getConfiguredAsr({
        ...tencent,
        FLAREMO_ASR_MODEL: "16k_zh",
        FLAREMO_ASR_TENCENT_HOTWORD_LIST: "语音记录|100",
      })?.id,
    ).toBe("tencent");
  });
});
