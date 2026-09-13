export type AsrSessionOptions = {
  sampleRate: 16000;
  language?: "auto" | "zh" | "en";
};
export type AsrSentence = {
  id: string;
  text: string;
  final: boolean;
  startedAt?: number;
  endedAt?: number;
};
export type AsrFailureReason =
  | "authentication"
  | "quota"
  | "configuration"
  | "capacity"
  | "network"
  | "protocol"
  | "timeout"
  | "provider";
export class AsrProviderError extends Error {
  constructor(
    readonly reason: AsrFailureReason,
    readonly retryable: boolean,
  ) {
    super("ASR connection failed");
    this.name = "AsrProviderError";
  }
}
export const ASR_MAX_BUFFERED_BYTES = 64_000;
export function sendAsrAudio(socket: WebSocket, data: ArrayBuffer) {
  if (socket.bufferedAmount + data.byteLength > ASR_MAX_BUFFERED_BYTES)
    throw new AsrProviderError("capacity", true);
  socket.send(data);
}
export type AsrConnection = {
  sendAudio(data: ArrayBuffer): void;
  /** Resolves only after the provider has delivered all final results. */
  finish(): Promise<void>;
  close(): void;
};
export type StreamingAsrProvider = {
  /** Resolves only when audio can be sent. Abort also closes a pending upgrade. */
  connect(
    options: AsrSessionOptions,
    onSentence: (sentence: AsrSentence) => void,
    onError: (error: AsrProviderError) => void,
    signal: AbortSignal,
  ): Promise<AsrConnection>;
};
