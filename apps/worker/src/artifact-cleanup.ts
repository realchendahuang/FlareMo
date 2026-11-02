import { thumbnailKeyFor } from "@flaremo/contracts/constants";
import { chunkIdsForMemo, type FlaremoAccountArtifacts } from "@flaremo/domain";
import type { FlareMoEnv } from "./env";

/** Remove rebuildable objects that live outside D1. */
export async function cleanupFlaremoArtifacts(
  env: FlareMoEnv,
  artifacts: FlaremoAccountArtifacts,
): Promise<void> {
  if (env.ATTACHMENTS) {
    // The artifacts list carries originals only; previews share their key with
    // a derived suffix, so expand before deleting or they outlive the account.
    const keys = artifacts.attachmentR2Keys.flatMap((key) => [
      key,
      thumbnailKeyFor(key),
    ]);
    for (let offset = 0; offset < keys.length; offset += 500) {
      await env.ATTACHMENTS.delete(keys.slice(offset, offset + 500));
    }
  }

  const targets: Array<{
    index: VectorizeIndex | undefined;
    ids: string[];
  }> = [
    {
      index: env.VECTORIZE_MEMOS,
      ids: artifacts.memoIds.flatMap((id) => chunkIdsForMemo(id)),
    },
  ];
  for (const target of targets) {
    if (!target.index) continue;
    // Vectorize caps id-list operations at 100 ids per call.
    for (let offset = 0; offset < target.ids.length; offset += 100) {
      const ids = target.ids.slice(offset, offset + 100);
      if (ids.length > 0) await target.index.deleteByIds(ids);
    }
  }
}
