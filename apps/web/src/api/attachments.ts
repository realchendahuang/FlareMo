import { createThumbnail } from "@/lib/upload/image-compression";
import { prepareUploadFile } from "@/lib/upload-compression";
import { apiRequest } from "./client";
import type { Attachment } from "./types";

/**
 * Reads an audio file's playback duration via a detached metadata probe so
 * uploads report it in the attachment payload and the reading player can show
 * the real length immediately. Best effort: any failure resolves undefined.
 */
async function readAudioDuration(file: File): Promise<number | undefined> {
  if (!file.type.toLowerCase().startsWith("audio/")) return undefined;
  const url = URL.createObjectURL(file);
  const audio = document.createElement("audio");
  return new Promise((resolve) => {
    const settle = (value: number | undefined) => {
      URL.revokeObjectURL(url);
      resolve(
        typeof value === "number" && Number.isFinite(value) && value > 0
          ? Math.round(value)
          : undefined,
      );
    };
    audio.preload = "metadata";
    audio.addEventListener("loadedmetadata", () => settle(audio.duration), {
      once: true,
    });
    audio.addEventListener("error", () => settle(undefined), { once: true });
    window.setTimeout(() => settle(undefined), 3000);
    audio.src = url;
  });
}

/**
 * Images report intrinsic dimensions alongside the upload so every render
 * site can reserve the right box before the bytes land (no scroll jump).
 * Mirrors readAudioDuration's philosophy: decoration, never a contract.
 */
async function readImageDimensions(
  file: File,
): Promise<{ width: number; height: number } | undefined> {
  if (!file.type.toLowerCase().startsWith("image/")) return undefined;
  try {
    const bitmap = await createImageBitmap(file);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions.width > 0 && dimensions.height > 0
      ? dimensions
      : undefined;
  } catch {
    return undefined;
  }
}

export async function uploadAttachment(input: {
  file: File;
  memo?: string;
  article?: string;
  clientId?: string;
}) {
  // Uploads go through the compression pipeline last (settings-gated, never
  // throws): probes below must read the actual bytes being uploaded.
  const file = await prepareUploadFile(input.file);
  const formData = new FormData();
  formData.set("file", file);
  if (input.memo) {
    formData.set("memo", input.memo);
  }
  if (input.article) {
    formData.set("article", input.article);
  }
  if (input.clientId) {
    formData.set("client_id", input.clientId);
  }
  const duration = await readAudioDuration(file);
  if (duration !== undefined) {
    formData.set("duration", String(duration));
  }
  const dimensions = await readImageDimensions(file);
  if (dimensions) {
    formData.set("width", String(dimensions.width));
    formData.set("height", String(dimensions.height));
  }
  // Best-effort card preview, generated from the bytes actually being uploaded
  // (i.e. after compression). A null result omits the part and the timeline
  // falls back to the original URL.
  const thumbnail = await createThumbnail(file).catch(() => null);
  if (thumbnail) {
    formData.set("thumbnail", thumbnail);
  }
  return apiRequest<Attachment>("/api/v1/attachments", {
    method: "POST",
    body: formData,
  });
}

/**
 * Replaces a memo's attachment binding list. Used to claim attachments that
 * were uploaded before their memo existed (inline image paste). The web
 * client's default legacy wire takes bare resource names here.
 */
export async function bindMemoAttachments(memo: string, names: string[]) {
  return apiRequest<{ attachments: Attachment[] }>(
    `/api/v1/memos/${encodeURIComponent(memo)}/attachments`,
    { method: "PATCH", body: JSON.stringify({ attachments: names }) },
  );
}
