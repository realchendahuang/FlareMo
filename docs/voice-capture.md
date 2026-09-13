# Voice Capture

Capture adds an authenticated, foreground voice-to-note flow at `/capture`. The microphone opens only after **Start recording**. Keep the page visible, wait until it says **Recording**, then speak. Stop closes the microphone and waits for the final sentence, then opens an editor. Save produces an ordinary FlareMo note with the `voice` tag and private visibility by default.

No original audio is retained. Switching tabs, leaving, logout, or interruption stops capture. Reload never resumes recording automatically. Local text recovery is available in the same browser tab session; it is not a server backup. If IndexedDB is unavailable, Capture reports that recovery is unavailable but recording and direct Memo saving still work. Reconnection can leave transcript gaps, and incomplete final speech is not promoted into a confirmed sentence. Network and capacity failures can retry with bounded backoff; credential, quota, model and protocol failures stop immediately so the UI does not remain in a misleading reconnect loop.

The production Service Worker includes `/capture` in FlareMo's authenticated app-shell navigation policy. After a successful online app navigation, an installed PWA can reopen the interface and its local recovered text while offline. Starting recognition and saving to the server still require a working network connection.

## Configure a test environment

The deployment needs an external streaming ASR provider: Tencent Cloud or DashScope. The realtime-context reference contains a DashScope connection implementation; it does not supply an account credential. The status endpoint reports configuration readiness, not a successful cloud connection, account permission, or available quota. Reading status does not invoke an ASR service.

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

### DashScope

DashScope uses the Beijing endpoint and defaults to `qwen-audio-3.0-asr-flash-streaming`. Use a key authorized for this model/region.

For local development, add the following to the existing ignored `.dev.vars` without overwriting your authentication settings:

```dotenv
FLAREMO_ASR_PROVIDER=dashscope
FLAREMO_ASR_MODEL=qwen-audio-3.0-asr-flash-streaming
FLAREMO_ASR_DASHSCOPE_API_KEY=<your Beijing DashScope key>
```

Set `FLAREMO_PUBLIC_URL` to the exact origin used to open FlareMo, including the development port. Add any other explicit origins to `FLAREMO_TRUSTED_ORIGINS`; do not use a wildcard. Follow the normal [development/deployment setup](deploy.md) for D1, Better Auth, and the owner account. For Capture acceptance, run `pnpm capture:dev`; it serves `http://localhost:8790` by default and supports `--port`, `--persist-to`, and `--public-url` overrides. `--public-url` must be one exact HTTPS origin outside localhost. It configures Better Auth, secure cookies, and Capture's Origin check for an already-authorized tunnel or test domain while the runtime continues to listen only on localhost. It keeps the ordinary `.wrangler/state` account and Memo data, but runs the built Worker directly on workerd to avoid the current Wrangler local proxy WebSocket failure. Bare Miniflare has no Workers AI binding, so this command disables local semantic embedding while retaining the real D1 keyword, Chinese-substring and tag search paths. Restart it after changing code or variables.

For an existing authorized test deployment, configure the DashScope key through Cloudflare's secret UI or the Wrangler secret command for that deployment. Provider secrets must never appear in public Wrangler vars, browser storage/URLs, screenshots, Git, or chat. Both permanent and temporary credentials stay in the Worker. Tencent's protocol requires a signed upstream URL; that URL must never be logged or returned to the browser.

Before connecting Capture to a production FlareMo instance, run the dedicated readiness check. The first command validates the local Wrangler config: a real D1 UUID, an exact HTTPS canonical origin, `/api/*` Worker routing, an explicit provider, provider-specific public vars, and the absence of secret values in public `vars`. The second command additionally asks Wrangler for the remote Worker secret **names** and confirms the required names exist; it cannot read or print their values.

```bash
pnpm capture:production:check
pnpm capture:production:check -- --remote
```

The remote check requires an authenticated Wrangler session or `CLOUDFLARE_API_TOKEN`. A passing dry run alone is not production readiness because Wrangler accepts placeholder resource identifiers while only assembling an upload bundle.

A desktop can use its own localhost for microphone testing. A phone needs a reachable **HTTPS** origin and trusted certificate; the phone's localhost points to the phone. Match that HTTPS origin in FlareMo's trusted-origin settings. A private, trusted development tunnel or a separate test deployment can provide this address. Production publishing is a separate action.

After external access has been explicitly authorized, `capture:phone` starts a temporary HTTPS tunnel, an in-memory access-key gate, and FlareMo with the tunnel's exact HTTPS origin:

```bash
pnpm capture:phone
```

The default provider is localhost.run because it uses ordinary SSH connectivity and works on networks that block Cloudflare Tunnel edge port 7844. Use `pnpm capture:phone -- --tunnel-provider cloudflare` when Cloudflare Quick Tunnel is reachable. The command prints the URL, a random shared key, and the local D1 data directory only in its console. The access page also identifies this as a local acceptance environment so it cannot be mistaken for production. The key stays in memory and is exchanged by POST; it is not stored in source, configuration, browser URLs, or FlareMo. A successful entry creates a four-hour secure, HttpOnly browser session. Enter `r` to generate a new key and invalidate existing gate sessions, `o` to disable the outer key check, `x` to revoke the key and block all temporary access, or `q` to close the tunnel. Disabling the outer check makes the FlareMo login reachable to anyone with the URL; Better Auth remains required. Re-enter `r` at any time to restore key protection. The launcher checks a dedicated, non-sensitive public health endpoint every 20 seconds. If the tunnel process exits or three consecutive checks fail, it stops only the failed tunnel and origin-bound local Worker, then rebuilds them with bounded backoff while preserving the in-memory access key and local D1. The console prints the restored URL; browser gate sessions remain usable when the provider restores the same hostname, while a new hostname requires entering the same key again. A local Worker/configuration failure still exits immediately. The command does not change production and does not affect another Cloudflare named tunnel.

Keep the process running for the phone test, use only its displayed HTTPS URL, and press `q` when acceptance ends. Each restart gets a new quick-tunnel hostname and key. Do not add wildcard origins. Because the HTTPS public URL enables secure session cookies, perform the phone login through that HTTPS URL rather than through localhost.

The existing optional Cloudflare `RATE_LIMITER` also protects paid ASR WebSocket starts in a separate bucket keyed by authenticated user ID. The default deployment setting allows 30 starts per minute per user, enough for the bounded reconnect schedule while limiting connection storms without grouping users behind a shared IP. Cloudflare enforces these counters per serving location, so provider account quota and billing limits still apply. Local environments without the binding keep working.

## Acceptance checklist

1. Open `/capture` while logged in. The microphone indicator stays off until Start. When configured, Capture also appears in workspace navigation.
2. Press Start, allow microphone access, wait for Recording, then say: “这是 FlareMo 的一次语音记录测试。” Confirm words arrive while speaking.
3. Speak for five minutes; verify partial text updates and completed sentences appear once. Finish with a distinctive final sentence, immediately press Stop, and confirm that sentence appears in the editor and the system microphone indicator disappears.
4. Edit a sentence, keep Private, save, and verify the detail page, timeline, `voice` tag filter and full-text search. If semantic search is enabled, wait for normal indexing and verify it too.
5. Make another capture, stop, edit, then reload. Explicitly restore the draft; verify edits and duration survived and the microphone is off. Discard and reload; the draft must not reappear.
6. Deny permission, disconnect the network, switch tabs, navigate away, and log out. Each case must accurately report the interruption and release the microphone. Retry or save captured text as appropriate.
7. Optional product validation: repeat a 30-minute foreground session on desktop and a real phone. Check Wi-Fi/cellular switching, lock/unlock and incoming-call interruption. This is follow-up evidence for production readiness, not a PR merge gate. Background recording is not promised.

A successful typed or mocked transcript is not proof of live ASR. The PR gate is the automated local microphone simulation plus Worker/provider contract coverage and deployment dry run below. A real microphone → Worker → configured ASR provider smoke test remains recommended before production rollout, but is optional for merging this implementation.

## Automated checks

Run `pnpm verify` and `pnpm deploy:dry-run`. Install the matching Chromium once with `pnpm exec playwright install chromium` if needed. The capture browser tests use a generated microphone and simulated ASR transport; auth, AudioWorklet, IndexedDB and memo/FTS APIs are real local components. The synthetic 30-minute PCM test verifies sample counts and bounded frames, not 30 minutes of real-time phone operation.

For PR review, attach the outputs of `pnpm verify`, `pnpm deploy:dry-run`, and `git diff --check`, and confirm that no provider keys or local state are included. Live Tencent/DashScope credentials, public tunnel access, physical-phone behavior and real-time ASR accuracy are optional follow-up checks and do not block this PR.

For an additional mobile WebKit compatibility check, install the matching runtime once with `pnpm exec playwright install webkit`, then run `pnpm test:capture:webkit`. This uses Playwright's iPhone device profile and browser-provided mock microphone to exercise Start, AudioWorklet PCM, transcript, Stop, microphone release, Review, ordinary Memo save/search, and horizontal layout bounds. It does not represent Safari's physical microphone permission, an installed iPhone PWA, lock-screen suspension, calls, or network handoff; those remain real-device acceptance items.

For a repeatable live-provider smoke test, provide a non-sensitive raw mono 48 kHz little-endian Float32 fixture up to two minutes long:

```bash
pnpm capture:live-smoke -- /absolute/path/to/mono-48k.f32
```

The smoke test uses the ASR settings from the ignored `.dev.vars`, but creates a random test account in a fresh in-memory D1 database. It generates the same Worker deployment bundle used by the dry run, starts it directly on the project's Miniflare/workerd runtime, sends the fixture at real speed through the authenticated same-origin FlareMo WebSocket, waits for finalized provider text, saves it through the normal private `voice` Memo API, confirms tagged keyword search, and disposes the temporary database. Running workerd directly avoids a current `wrangler dev` local proxy failure that can close nested WebSocket traffic with code 1006; the Worker, Better Auth, D1, and provider adapters are unchanged. The smoke test does not touch the ordinary local development account or Memo data. Short-run JSON includes the full transcript; long-run JSON reports the character count and a short preview. Use synthetic or otherwise non-sensitive audio. This is evidence for the Worker/provider integration, not a substitute for microphone, phone, or interruption acceptance.

Add `--browser` to exercise the built Capture page as well:

```bash
pnpm capture:live-smoke -- --browser /absolute/path/to/mono-48k.f32
```

Add a UTF-8 reference transcript to measure normalized Chinese character error rate (CER) and word error rate (WER). Receipt timestamps, punctuation, whitespace, Unicode width and letter case are excluded from the comparison. The JSON output includes edit counts and denominator sizes so results remain auditable. CER is the primary Chinese ASR metric. Use `--max-cer` to turn an agreed fixture threshold into a failing regression check; it requires `--reference` and accepts a value from 0 to 1.

```bash
pnpm capture:live-smoke -- --browser \
  --reference /absolute/path/to/reference.txt \
  --max-cer 0.15 \
  /absolute/path/to/mono-48k.f32
```

Browser mode streams the fixture into a temporary WAV using fixed-size buffers, with three seconds of leading silence and ten seconds of unsent trailing silence so the test can stop before the fake device ends. It launches Chromium and verifies explicit Start, AudioWorklet use, the requested active duration, WebSocket connection count, finalized text in Review, microphone release, an editor change, private `voice` Memo save, and tagged search. When the provider includes relative sentence-end timestamps, the JSON also reports sample count, P95, maximum final-sentence latency, and whether the observed maximum is below the 10-second V1 target. Latency measures provider sentence end to Worker receipt. Accuracy is measured only when `--reference` is supplied, and neither result is a deployed-region or population guarantee. The temporary WAV, browser profile, Memo, account, and in-memory D1 database are removed after the run. This covers the complete desktop browser integration with a deterministic audio source; separate browser tests cover reconnect gaps, foreground loss, session logout, ScriptProcessor fallback, and IndexedDB-unavailable saving, but none of them replace real-phone interruption acceptance.

Fixtures are capped at two minutes by default to bound accidental provider use. Add `--allow-long` only for an intentional 5-to-60-minute stability run; the long mode still enforces the product's one-hour session limit:

```bash
pnpm capture:live-smoke -- --browser --allow-long /absolute/path/to/mono-48k.f32
```

See [design and resource ownership](voice-capture-design.md) for timeouts, protocol limits and tradeoffs. Current limits are one hour per session, approximately 90,000 transcript characters, 4,000 finalized sentences, and 64 kB at each asynchronous send queue. Audio interrupted by a network gap is not replayed.
