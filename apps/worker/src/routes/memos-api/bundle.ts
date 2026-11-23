import {
  createAttachmentObjectKey,
  MAX_ATTACHMENT_BYTES,
} from "../../attachment-http";
import type { FlareMoEnv } from "../../env";
import { base64ToUint8Array } from "../../memos-compat/base64";

// btoa only accepts a "binary string", and concatenating one byte by byte
// for a 32 MiB attachment produces a giant intermediate string. Encode
// 8192 * 3 = 24576-byte chunks independently instead: every full chunk is a
// multiple of 3 bytes, so its base64 has no interior padding and the chunk
// outputs concatenate to exactly btoa(whole buffer).
const BASE64_CHUNK_BYTES = 24576;

export function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, offset + BASE64_CHUNK_BYTES);
    chunks.push(
      btoa(String.fromCharCode.apply(null, chunk as unknown as number[])),
    );
  }
  return chunks.join("");
}

export function sanitizeFilename(filename: string) {
  return (
    filename.replaceAll(/[^\p{L}\p{N}._-]/gu, "_").slice(0, 180) || "attachment"
  );
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

// Decoded-size estimate for a base64 attachment list; used to pre-check the
// storage quota before any object of the bundle is written to R2.
export function bundleAttachmentBytes(attachments: { data_base64?: string }[]) {
  return attachments.reduce(
    (sum, attachment) =>
      attachment.data_base64
        ? sum + Math.ceil((attachment.data_base64.length * 3) / 4)
        : sum,
    0,
  );
}

export type ImportBundleAttachment = {
  name: string;
  filename: string;
  content_type: string | null;
  data_base64?: string;
};

/**
 * Upload an import bundle's base64 attachment payloads to R2. Returns null
 * when an attachment exceeds the 25 MiB limit so the caller can emit the
 * exact 413 response the previous inline loops produced (an early return
 * that leaves keys already written untouched); keys written so far
 * accumulate into `writtenKeys` for caller-side failure cleanup.
 */
export async function importBundleUpload(
  env: FlareMoEnv,
  userId: string,
  attachments: readonly ImportBundleAttachment[],
  writtenKeys: string[],
): Promise<{
  r2Keys: Map<string, string>;
  r2Etags: Map<string, string | null>;
} | null> {
  const r2Keys = new Map<string, string>();
  const r2Etags = new Map<string, string | null>();
  for (const attachment of attachments) {
    if (!attachment.data_base64) continue;
    const bytes = base64ToUint8Array(attachment.data_base64);
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) return null;
    const objectKey = createAttachmentObjectKey(
      userId,
      attachment.filename,
      "imports",
    );
    const object = await env.ATTACHMENTS.put(objectKey, bytes, {
      httpMetadata: {
        contentType: attachment.content_type ?? "application/octet-stream",
      },
    });
    writtenKeys.push(objectKey);
    r2Keys.set(attachment.name, objectKey);
    r2Etags.set(attachment.name, object.httpEtag);
  }
  return { r2Keys, r2Etags };
}

export type BundleJsonEstimateInput = {
  version?: unknown;
  exported_at?: unknown;
  memos: readonly unknown[];
  attachments: readonly unknown[];
  relations: readonly unknown[];
  shares: readonly unknown[];
  projects?: readonly unknown[];
  tasks?: readonly unknown[];
  task_activity?: readonly unknown[];
};

const BUNDLE_ARRAY_KEYS = [
  "memos",
  "attachments",
  "relations",
  "shares",
  "projects",
  "tasks",
  "task_activity",
] as const;

/**
 * Measure the exact JSON byte length of an export bundle, stopping once
 * `maxBytes` is exceeded. Serializing the whole bundle in one `JSON.stringify`
 * creates a second 32+ MiB string (and the following TextEncoder allocates the
 * UTF-8 view), which is avoidable near the inline-export boundary.
 *
 * The empty-array envelope keeps property order, scalar escaping, brackets and
 * separators identical to `JSON.stringify(bundle)`. Each array record is then
 * serialized independently, so the whole result is exact without materializing
 * one giant string. Returning `maxBytes + 1` is a deliberate "over budget"
 * sentinel; callers only compare it with the limit.
 */
export function estimateBundleJsonBytes(
  bundle: BundleJsonEstimateInput,
  maxBytes = Number.POSITIVE_INFINITY,
) {
  const encoder = new TextEncoder();
  const envelope = {
    ...bundle,
    memos: [],
    attachments: [],
    relations: [],
    shares: [],
    projects: [],
    tasks: [],
    task_activity: [],
  };
  let total = encoder.encode(JSON.stringify(envelope)).byteLength;
  if (total > maxBytes) return maxBytes + 1;

  for (const key of BUNDLE_ARRAY_KEYS) {
    const values = bundle[key] ?? [];
    for (let index = 0; index < values.length; index += 1) {
      if (index > 0) total += 1; // array comma
      const record = JSON.stringify(values[index]) ?? "null";
      total += encoder.encode(record).byteLength;
      if (total > maxBytes) return maxBytes + 1;
    }
  }
  return total;
}
