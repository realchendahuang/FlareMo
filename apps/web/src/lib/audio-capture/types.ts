export type CaptureState =
  | "idle"
  | "requesting_permission"
  | "connecting"
  | "recording"
  | "reconnecting"
  | "stopping"
  | "review"
  | "saving"
  | "saved"
  | "error";

import type { CaptureSentenceEvent } from "@flaremo/contracts";

export type CaptureSentence = Omit<CaptureSentenceEvent, "type">;
