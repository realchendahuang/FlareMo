# Voice Capture

The instance owner can now configure shared provider credentials from Account. See [Owner-managed voice recognition](./voice-settings.md) for setup, precedence over these environment variables, encryption, permissions, and credential storage.

Voice input lives in the composer. The microphone button in the composer toolbar (and in the long-form canvas) opens a compact recording bar; speech is transcribed live and the text is inserted into the draft, where it is edited and sent like any typed note. The microphone opens only after the button is pressed. The button appears only when a speech provider is configured.

No original audio is retained. Switching tabs, leaving the page, logout, or interruption stops recording. Reconnection can leave transcript gaps, and incomplete final speech is not promoted into a confirmed sentence. Network and capacity failures can retry with bounded backoff; credential, quota, model and protocol failures stop immediately so the UI does not remain in a misleading reconnect loop.

The standalone `/capture` recording page was removed in v0.24.0: short dictation is covered by the composer, and long foreground recording in a browser tab (which stops when the phone locks or the tab is hidden) was not a reliable product. The Worker endpoints, provider adapters and settings below are unchanged and serve the composer.

## Configure a test environment

The deployment needs an external streaming ASR provider: Tencent Cloud, DashScope, or Volcano Engine (Doubao). The realtime-context reference contains a DashScope connection implementation; it does not supply an account credential. The status endpoint reports configuration readiness, not a successful cloud connection, account permission, or available quota. Reading status does not invoke an ASR service.

Credentials can be configured in the settings UI without any console access ([voice-settings.md](./voice-settings.md)); the `FLAREMO_ASR_*` variables below remain supported as deployment-level configuration and take precedence over the saved settings when they fully resolve.

### Tencent Cloud

Use the account's **AppID**, **SecretId** and **SecretKey**, with permission and quota for realtime speech recognition. An account that has successfully transcribed a recording file has not necessarily enabled realtime recognition. This is the Tencent Cloud account AppID, not a WeChat or TRTC SDKAppID. The [API key management page](https://console.cloud.tencent.com/cam/capi) and account information show the relevant credentials/ID.

Add these values to the existing ignored `.dev.vars`, preserving authentication settings:

```dotenv
FLAREMO_ASR_PROVIDER=tencent
FLAREMO_ASR_MODEL=16k_zh_en
FLAREMO_ASR_TENCENT_APP_ID=<Tencent Cloud account AppID>
FLAREMO_ASR_TENCENT_SECRET_ID=<SecretId>
FLAREMO_ASR_TENCENT_SECRET_KEY=<SecretKey>
# Optional: configure one of these, never both.
FLAREMO_ASR_TENCENT_HOTWORD_LIST=FlareMo|11,语音记录|7
# FLAREMO_ASR_TENCENT_HOTWORD_ID=<Tencent vocabulary ID>
```

The default engine is `16k_zh_en`, the documented realtime Chinese/English large-model engine. Without a model override, an explicit English session uses `16k_en_large`. Capture sends mono 16 kHz PCM. The Tencent adapter coalesces browser frames into Tencent's recommended 200 ms / 6,400-byte packets and flushes a shorter tail when stopping. Do not copy a recording-file engine such as `16k_zh_en_2.0`, an 8 kHz engine, or the 60-second `Hy-ASR-3.0-preview` engine into this configuration. When switching providers, replace or remove the previous `FLAREMO_ASR_MODEL` value as well.

Tencent hotwords improve product names and domain terms without changing the browser protocol. `FLAREMO_ASR_TENCENT_HOTWORD_ID` selects a vocabulary created in Tencent's console/API. `FLAREMO_ASR_TENCENT_HOTWORD_LIST` sends a temporary list only to Tencent for each recognition stream; it never enters the browser, note, or application log. Configure only one. Each temporary entry is `word|weight`, comma-separated, with at most 128 entries and weight `1`-`11`. Weight `11` is useful for a small number of terms that must be recognized, but too many high-weight terms can reduce overall accuracy. Weight `100` is accepted only with the documented `16k_zh` engine because it forces homophone replacement. If neither variable is set, Tencent automatically applies the account's default vocabulary when one exists. See [Tencent hotwords](https://cloud.tencent.com/document/product/1093/40996).

For an existing authorized Cloudflare test deployment, put SecretId and SecretKey in Worker secrets using the dashboard or `pnpm exec wrangler secret put FLAREMO_ASR_TENCENT_SECRET_ID` and `pnpm exec wrangler secret put FLAREMO_ASR_TENCENT_SECRET_KEY`. The commands read values interactively; do not append secret values to command arguments. AppID, provider, model and a non-sensitive hotword ID can use Worker vars. Store a private temporary hotword list as a Worker secret. No extra server, SDK service, or database is required.

Check the account's realtime traffic region and realtime quota/postpaid settings. A Worker request originating outside mainland China may require Tencent's cross-border realtime service; a successful file-transcription request from Hong Kong does not establish that this is enabled. See [Tencent realtime protocol](https://cloud.tencent.com/document/product/1093/48982) and [regional billing/service rules](https://cloud.tencent.com/document/product/1093/35686). Account permissions, billing and actual network reachability still require live verification.

### Volcano Engine (Doubao)

Volcano Engine's 大模型流式语音识别 (`volc.bigasr.sauc`) speaks a binary-frame WebSocket protocol on `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async`. The adapter sends uncompressed JSON-framed PCM and expects the server to mirror that choice; the 200 ms frames arrive as `full server response` frames whose `definite` utterances map to final sentences. Silence windows report status `1013`, which is ignored rather than treated as a failure.

For local development, add the following to the existing ignored `.dev.vars` without overwriting your authentication settings:

```dotenv
FLAREMO_ASR_PROVIDER=volcengine
FLAREMO_ASR_VOLCENGINE_APP_ID=<AppID from the console>
FLAREMO_ASR_VOLCENGINE_ACCESS_TOKEN=<Access Token from the console>
# Optional: hourly billing (default) vs concurrent billing.
# FLAREMO_ASR_VOLCENGINE_RESOURCE_ID=volc.bigasr.sauc.duration
```

The AppID and Access Token come from the speech console's API key page. `volc.bigasr.sauc.duration` bills by audio hour and is the default; switch to `volc.bigasr.sauc.concurrent` only when the account holds a concurrency package. Optional boosting (hotword) and correct tables created in the console improve domain terms; both must exist in the same account.

### DashScope

DashScope uses the Beijing endpoint and defaults to `qwen-audio-3.0-asr-flash-streaming`. Use a key authorized for this model/region.

For local development, add the following to the existing ignored `.dev.vars` without overwriting your authentication settings:

```dotenv
FLAREMO_ASR_PROVIDER=dashscope
FLAREMO_ASR_MODEL=qwen-audio-3.0-asr-flash-streaming
FLAREMO_ASR_DASHSCOPE_API_KEY=<your Beijing DashScope key>
```

Set `FLAREMO_PUBLIC_URL` to the exact origin used to open FlareMo, including the development port. Add any other explicit origins to `FLAREMO_TRUSTED_ORIGINS`; do not use a wildcard. Follow the normal [development/deployment setup](deploy.md) for D1, Better Auth, and the owner account.

For an existing authorized test deployment, configure the DashScope key through Cloudflare's secret UI or the Wrangler secret command for that deployment. Provider secrets must never appear in public Wrangler vars, browser storage/URLs, screenshots, Git, or chat. Both permanent and temporary credentials stay in the Worker. Tencent's protocol requires a signed upstream URL; that URL must never be logged or returned to the browser.

Before connecting Capture to a production FlareMo instance, run the dedicated readiness check. The first command validates the local Wrangler config: a real D1 UUID, an exact HTTPS canonical origin, `/api/*` Worker routing, an explicit provider, provider-specific public vars, and the absence of secret values in public `vars`. The second command additionally asks Wrangler for the remote Worker secret **names** and confirms the required names exist; it cannot read or print their values.

```bash
pnpm capture:production:check
pnpm capture:production:check -- --remote
```

The remote check requires an authenticated Wrangler session or `CLOUDFLARE_API_TOKEN`. A passing dry run alone is not production readiness because Wrangler accepts placeholder resource identifiers while only assembling an upload bundle.

A desktop can use its own localhost for microphone testing. A phone needs a reachable **HTTPS** origin and trusted certificate; the phone's localhost points to the phone. Match that HTTPS origin in FlareMo's trusted-origin settings.

The existing optional Cloudflare `RATE_LIMITER` also protects paid ASR WebSocket starts in a separate bucket keyed by authenticated user ID. The default deployment setting allows 30 starts per minute per user, enough for the bounded reconnect schedule while limiting connection storms without grouping users behind a shared IP. Cloudflare enforces these counters per serving location, so provider account quota and billing limits still apply. Local environments without the binding keep working.

## Acceptance checklist

1. Log in with a provider configured. The composer toolbar shows the microphone button; without a provider it does not appear.
2. Press it, allow microphone access, wait for the recording state, then say: “这是 FlareMo 的一次语音记录测试。” Confirm words arrive while speaking.
3. Stop, confirm the final sentence lands in the draft and the system microphone indicator disappears, edit it and send. Verify the timeline, the `voice` tag filter and full-text search.
4. Deny permission, disconnect the network, switch tabs and log out while recording. Each case must report the interruption and release the microphone.

A successful typed or mocked transcript is not proof of live ASR; a real microphone → Worker → configured provider check remains recommended before production rollout.

## Automated checks

Provider adapters, the Worker bridge and the PCM pipeline are covered by Vitest (`apps/worker/src/**/capture*.test.ts`, `apps/web/src/lib/audio-capture/*.test.ts`). `pnpm capture:production:check` validates production configuration as described above.

See [design and resource ownership](voice-capture-design.md) for timeouts, protocol limits and tradeoffs. The Worker still enforces one hour per session, approximately 90,000 transcript characters, 4,000 finalized sentences, and 64 kB at each asynchronous send queue. Audio interrupted by a network gap is not replayed.
