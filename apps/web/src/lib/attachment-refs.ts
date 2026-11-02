/**
 * Inline body images reference attachments through the Memos-compatible
 * `/file/attachments/{id}/{filename}` bridge. The parsing and token-injection
 * helpers live in `@flaremo/contracts` so the app, the share renderer, and the
 * article renderer cannot drift.
 */
import { extractReferencedAttachmentIds } from "@flaremo/contracts";

export {
  extractReferencedAttachmentIds,
  injectShareTokenIntoFileUrls,
} from "@flaremo/contracts";

/**
 * Intrinsic pixel dimensions reported at upload time (see
 * parseAttachmentDimensions on the worker). Older attachments carry no
 * dimensions; callers fall back to natural sizing for those.
 */
export function attachmentImageDimensions<
  T extends { payload?: Record<string, unknown> | null },
>(attachment: T): { width: number; height: number } | undefined {
  const width = attachment.payload?.width;
  const height = attachment.payload?.height;
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined;
  }
  return { width, height };
}

/**
 * Builds a lookup from a `/file/attachments/` URL to the referenced
 * attachment's dimensions, for giving markdown body images an intrinsic box.
 */
export function createImageDimensionResolver<
  T extends { name: string; payload?: Record<string, unknown> | null },
>(
  attachments: T[],
): (src: string) => { width: number; height: number } | undefined {
  const byId = new Map<string, { width: number; height: number }>();
  for (const attachment of attachments) {
    const dimensions = attachmentImageDimensions(attachment);
    if (dimensions) {
      byId.set(attachment.name.replace(/^attachments\//, ""), dimensions);
    }
  }
  return (src: string) => {
    // Non-global copy: a global regex's exec is stateful (lastIndex), and the
    // shared matcher is owned by matchAll callers.
    const match = /\/file\/attachments\/([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(src);
    return match ? byId.get(match[1]) : undefined;
  };
}

/**
 * Attachments already referenced by the body are shown inline, so the gallery
 * keeps only the rest. Unreferenced attachments — an audio file, a photo the
 * author never placed — must not vanish.
 */
export function filterUnreferencedAttachments<T extends { name: string }>(
  attachments: T[],
  content: string,
): T[] {
  const referenced = extractReferencedAttachmentIds(content);
  return attachments.filter(
    (attachment) =>
      !referenced.has(attachment.name.replace(/^attachments\//, "")),
  );
}
