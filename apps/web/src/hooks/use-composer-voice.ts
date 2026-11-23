import {
  type RefObject,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import { getCaptureStatus } from "@/api";
import { useI18n } from "@/i18n";
import { transcribeCapturedAudio } from "@/lib/audio-capture/batch";
import {
  CaptureController,
  type CaptureSnapshot,
} from "@/lib/audio-capture/controller";
import { createCaptureAudioSink } from "@/lib/audio-capture/encoder";
import { openMicrophone } from "@/lib/audio-capture/microphone";
import { joinFinalSentences } from "@/lib/audio-capture/plain-text";
import type { MemoCaptureInput } from "@/lib/local-memo-capture";

type UseComposerVoiceOptions = {
  /** Live draft; the finished session appends to its content. */
  draftRef: RefObject<MemoCaptureInput>;
  /** Latest draft writer, read through a ref by the merge effect above. */
  updateContentRef: RefObject<(content: string) => void>;
};

export type UseComposerVoiceResult = {
  capture: CaptureSnapshot;
  captureController: CaptureController;
  /** A session owns the composer: recording, transcribing, or lingering review. */
  voiceActive: boolean;
  /** Wall clock for the recording length, refreshed only while recording. */
  now: number;
};

/**
 * Quick voice capture: one streaming/batch ASR session per composer, wired the
 * same way as the capture page. The controller persists with the composer
 * (workspace filters keep it mounted) so a draft survives a visit to the
 * archive or trash, and a finished session flows straight into the draft.
 */
export function useComposerVoice({
  draftRef,
  updateContentRef,
}: UseComposerVoiceOptions): UseComposerVoiceResult {
  const { t } = useI18n();
  const [captureController] = useState(
    () =>
      new CaptureController({
        microphone: openMicrophone,
        status: getCaptureStatus,
        socket: () =>
          new WebSocket(
            `${location.origin.replace(/^http/, "ws")}/api/app/capture/ws`,
          ),
        // Batch ASR (rollout §3.3): used only when /status reports a batch
        // provider; the controller decides the mode per session.
        batch: {
          createSink: () => createCaptureAudioSink(),
          transcribe: (audio, input) =>
            transcribeCapturedAudio(audio, {
              language: input.language,
              startedAtMs: input.startedAtMs,
              onProgress: input.onProgress,
              signal: input.signal,
            }),
        },
      }),
  );
  const capture = useSyncExternalStore(
    captureController.subscribe,
    captureController.getSnapshot,
  );
  const voiceActive = capture.state !== "idle" && capture.state !== "error";
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!voiceActive) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [voiceActive]);
  useEffect(() => () => captureController.dispose(), [captureController]);

  // A finished session flows straight into the draft: review state carries
  // the final sentences, everything else collapses back to idle. The draft
  // writer goes through a ref so the effect never re-runs on every keystroke.
  useEffect(() => {
    if (capture.state === "error") {
      if (capture.error) toast.error(t(`capture.${capture.error}`));
      captureController.reset();
      return;
    }
    if (capture.state !== "review") return;
    const text = joinFinalSentences(capture.sentences);
    if (text) {
      const base = draftRef.current.content;
      const separator = base && !base.endsWith("\n") ? " " : "";
      const next = `${base}${separator}${text}`;
      updateContentRef.current(next);
    }
    captureController.reset();
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- draftRef/updateContentRef are useRef handles owned by the composer and passed in for exactly this reason — re-running on draft keystrokes would clobber the composed text.
  }, [capture.state, capture.sentences, capture.error, captureController, t]);

  return { capture, captureController, voiceActive, now };
}
