import {
  chunkIdsForMemo,
  type FlaremoAccountArtifacts,
  memoryIdVector,
} from "@flaremo/domain";
import type { FlareMoEnv } from "./env";

/** Remove rebuildable objects that live outside D1. */
export async function cleanupFlaremoArtifacts(
  env: FlareMoEnv,
  artifacts: FlaremoAccountArtifacts,
): Promise<void> {
  if (env.ATTACHMENTS) {
    for (
      let offset = 0;
      offset < artifacts.attachmentR2Keys.length;
      offset += 500
    ) {
      await env.ATTACHMENTS.delete(
        artifacts.attachmentR2Keys.slice(offset, offset + 500),
      );
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
    {
      index: env.VECTORIZE_MEMORIES,
      ids: artifacts.memoryIds.map((id) => memoryIdVector(id)),
    },
  ];
  for (const target of targets) {
    if (!target.index) continue;
    for (let offset = 0; offset < target.ids.length; offset += 500) {
      const ids = target.ids.slice(offset, offset + 500);
      if (ids.length > 0) await target.index.deleteByIds(ids);
    }
  }
}
