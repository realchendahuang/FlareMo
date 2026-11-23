# MiniMax speech-to-text (asr-1.0) — provider guide

Decision (2026-09-17): MiniMax is the voice-transcription provider for the kosx deployment and the first-class batch provider for the ASR layer. The streaming adapters (Volcano Engine / DashScope / Tencent) remain the live-transcription path for the composer's microphone; MiniMax covers every flow where the audio exists as a file before recognition starts. Its key is already staged in the kosx secret store as `FLAREMO_ASR_MINIMAX_API_KEY`, and `FLAREMO_VOICE_CONFIG_KEY` is set, so credentials saved through the settings UI are sealed as AES-GCM ciphertext.

## Provider facts (verified 2026-09-17)

- Endpoint: `POST https://api.minimaxi.com/v1/speech_to_text` (domestic) / `https://api.minimax.io/v1/speech_to_text` (international). Sync `multipart/form-data` upload, Bearer auth. No async job mode.
- Model `asr-1.0` returns sentence-level timestamps (`response_format=verbose_json` → `segments[]` with `start`/`end`/`speaker`) and optionally word-level ones (`timestamp_level=word`: character-level for Chinese, word-level for English). Speaker diarization (`n_speakers`) is included. `srt`/`vtt` response formats exist but we only consume `verbose_json`.
- Formats: `wav` / `mp3` / `flac` / `alac`(m4a) / `aac` / `opus` / `ogg` / `aiff`. **Bare PCM is rejected** — capture output must be wrapped in a WAV container.
- Hard limits per request: **500 seconds** and **50 MB**. Overflow returns 400 (duration) or 413 (size); there is no server-side truncation.
- `stream=true` streams only the text result as SSE while the full audio is still uploaded up front; it is mutually exclusive with `verbose_json`. Do not use it — pseudo-streaming is a worse UX than record-then-transcribe and buys nothing.
- Language: `language` header, BCP-47 (~20 languages). Auto-detect handles Chinese–English code-switching; sending an explicit hint (e.g. `zh`) is still the safe default for noisy recordings.

## Billing: Subscription Key vs pay-as-you-go key

Token Plan quota covers speech-to-text, deducted from the shared plan quota at catalog price (domestic ¥2.50/hour, international $0.38/hour). Two classes of keys exist and are **not interchangeable**:

| Key class | Where it comes from | What it does |
|---|---|---|
| Subscription Key | Console → Billing → Token Plan | Draws down Token Plan quota (monthly reset, no carry-over); falls back to purchased credits (365-day validity) |
| Pay-as-you-go key | Normal API key | Bills the account's cash balance directly |

The kosx secret must hold the Subscription Key. A pay-as-you-go key pasted in by mistake silently works but bills cash. There is no published per-endpoint coverage table; the authority is the STT doc ("Pay-as-you-go or subscribe to Token Plan") plus the Token Plan coverage list, whose exclusions (H3 video, Voice Design, Rapid Voice Cloning) do not include ASR. After the adapter lands, do one live transcription and confirm the plan usage bar moves, not the balance.

Plan quota resets monthly — a burst of transcriptions near month-end can exhaust it; the credits fallback covers the remainder. Budget check belongs in the deployment checklist, not in code.

## Integration design

A second provider contract sits beside `StreamingAsrProvider`, with MiniMax as its first implementation:

- **`BatchAsrProvider`**: `transcribe(audio: Blob, opts) → { segments: { start, end, text, speaker? }[] }`. Segments use the same millisecond timeline as streaming utterances, so both paths feed one memo-transcript format (audio attachment + clock-marked body) and one reading experience.
- **Capture flow when MiniMax is the only configured provider**: record → stop → transcribe. The client encodes its existing 16 kHz mono s16le PCM frames to ogg/opus in real time (WASM encoder) and uploads when the session ends — WAV (44-byte RIFF header) is the fallback if the encoder fails to initialize; MiniMax accepts both containers. The UI shows audio-ready / transcribing states. Live partial text stays a streaming-adapter feature; no pseudo-streaming.
- **Chunking for >500 s sessions**: client-side fixed-length slices (≤8 minutes) uploaded sequentially, with per-chunk time offsets stitched back into one timeline. VAD-aligned slicing is a later refinement, not a requirement.
- **Key handling**: the Worker proxies the upload (browser → Worker → MiniMax); the key never reaches the browser. Retry on 429/5xx with backoff; treat 400/413 as configuration errors surfaced to the user.
- **Configuration**: the voice panel gains a MiniMax option (API key + optional base URL for domestic/international endpoints). Existing precedence (complete `FLAREMO_ASR_*` env set wins over the D1 copy) and the encrypted envelope apply unchanged.
- **Usage metering**: record `asr_seconds` into the per-user usage system so the owner can attribute cost. Not blocking for the adapter itself.

## Kosx deployment checklist

1. ~~Stage the API key~~ — done: `FLAREMO_ASR_MINIMAX_API_KEY` is in the worker secret store.
2. ~~Encryption envelope~~ — done: `FLAREMO_VOICE_CONFIG_KEY` is set.
3. Land the `BatchAsrProvider` contract, MiniMax adapter, WAV wrapping, capture record-then-transcribe mode, and panel option.
4. `RATE_LIMITER` binding stays enabled (fail-open when absent is the known trap).
5. Live smoke: one short real recording through the composer's microphone, verify the transcript memo renders in the reading view, then check the Token Plan usage bar.

## Pitfalls summary

- Use the Subscription Key; the pay-as-you-go key bills cash.
- Never send bare PCM; wrap in WAV (or encode opus) before upload.
- 500 s / 50 MB per request — chunk long sessions and stitch offsets.
- `verbose_json`, `srt`/`vtt`, and `stream=true` are mutually exclusive; we take `verbose_json` only.
- Do not fake streaming on top of the batch API.
- Send a `language` hint; do not rely on auto-detect alone.
- The key must never reach the browser, logs, or git; UI shows masked tails only (same rules as other providers).
