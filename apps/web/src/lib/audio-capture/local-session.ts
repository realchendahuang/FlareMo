import { type LocalCapture, localCaptureSchema } from "@flaremo/contracts";
import {
  createMemoCaptureClientId,
  getNewMemoDraftId,
  removeMemoDraft,
  restoreMemoDraft,
  saveMemoDraft,
} from "../local-memo-capture";

export type { LocalCapture };
export function captureDraftId(userId: string) {
  return `voice:${userId}:${getNewMemoDraftId()}`;
}
export function newLocalCapture(): LocalCapture {
  return {
    version: 1,
    clientId: createMemoCaptureClientId(),
    text: "",
    startedAt: Date.now(),
    duration: 0,
    tags: ["voice"],
    visibility: "private",
    gap: false,
  };
}
export async function loadCapture(id: string) {
  const draft = await restoreMemoDraft(id);
  if (!draft) return null;
  try {
    const parsed = localCaptureSchema.safeParse(JSON.parse(draft.content));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
/** Serial writes prevent an older draft from overwriting edits or reviving a deleted draft. */
export class CaptureDraftStore {
  private readonly id: string;
  private queue: Promise<unknown> = Promise.resolve();
  private hasPersistedDraft = false;
  constructor(id: string) {
    this.id = id;
  }
  markRecovered() {
    this.hasPersistedDraft = true;
  }
  save(value: LocalCapture) {
    const content = JSON.stringify(localCaptureSchema.parse(value));
    const next = this.queue.then(() =>
      saveMemoDraft(
        {
          content,
          visibility: "private",
          tags: ["voice"],
          files: [],
          clientId: value.clientId,
        },
        this.id,
      ),
    );
    this.queue = next.catch(() => null);
    return next.then((result) => {
      const persisted = Boolean(result);
      if (persisted) this.hasPersistedDraft = true;
      return persisted;
    });
  }
  clear() {
    const next = this.queue.then(async () => {
      if (
        (await removeMemoDraft(this.id)) ||
        (await removeMemoDraft(this.id))
      ) {
        this.hasPersistedDraft = false;
        return true;
      }
      // IndexedDB may be unavailable for the entire capture. In that case no
      // local draft was created, so a successful server save can still finish.
      return !this.hasPersistedDraft;
    });
    this.queue = next.catch(() => false);
    return next;
  }
}
