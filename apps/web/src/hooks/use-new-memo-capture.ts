import type { MemoVisibility } from "@flaremo/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createMemoCaptureClientId,
  createMemoCaptureInput,
  DEFAULT_NEW_MEMO_DRAFT_ID,
  enqueueMemoSubmission,
  isLocalMemoCaptureAvailable,
  isMemoCaptureEmpty,
  type MemoCaptureInput,
  type MemoDraft,
  type QueuedMemoSubmission,
  removeMemoDraft,
  restoreMemoDraft,
  saveMemoDraft,
} from "@/lib/local-memo-capture";

export type LocalCaptureStatus =
  | "restoring"
  | "ready"
  | "saving"
  | "unavailable";

export type UseNewMemoCaptureOptions = {
  draftId?: string;
  initialVisibility?: MemoVisibility;
  debounceMs?: number;
};

export type UseNewMemoCaptureResult = {
  draft: MemoCaptureInput;
  status: LocalCaptureStatus;
  isRestored: boolean;
  /** True only when a non-empty persisted draft replaced the initial state. */
  didRestoreStoredDraft: boolean;
  setContent: (content: string) => void;
  setVisibility: (visibility: MemoVisibility) => void;
  setTags: (tags: string[]) => void;
  setFiles: (files: File[]) => void;
  updateDraft: (
    updater:
      | MemoCaptureInput
      | ((current: MemoCaptureInput) => MemoCaptureInput),
  ) => void;
  discardDraft: () => Promise<void>;
  queueCurrentSubmission: () => Promise<QueuedMemoSubmission | null>;
  restoreDraft: () => Promise<MemoDraft | null>;
};

/**
 * Owns a new-memo composer state and persists it after a short quiet period.
 * It intentionally keeps working in memory if IndexedDB is unavailable (for
 * example in restrictive private browsing modes).
 */
export function useNewMemoCapture(
  options: UseNewMemoCaptureOptions = {},
): UseNewMemoCaptureResult {
  const draftId = options.draftId ?? DEFAULT_NEW_MEMO_DRAFT_ID;
  const debounceMs = options.debounceMs ?? 500;
  const initialVisibility = options.initialVisibility ?? "private";
  const [draft, setDraftState] = useState<MemoCaptureInput>(() =>
    emptyCapture(initialVisibility),
  );
  const [status, setStatus] = useState<LocalCaptureStatus>("restoring");
  const [restoredDraftId, setRestoredDraftId] = useState<string | null>(null);
  const [restoredStoredDraftId, setRestoredStoredDraftId] = useState<
    string | null
  >(null);
  const hasLocalChanges = useRef(false);
  const latestDraft = useRef(draft);
  const restoreRequest = useRef(0);
  const persistenceQueue = useRef<Promise<void>>(Promise.resolve());
  const isRestored = restoredDraftId === draftId;
  const didRestoreStoredDraft = restoredStoredDraftId === draftId;

  useEffect(() => {
    latestDraft.current = draft;
  }, [draft]);

  const updateDraft = useCallback(
    (
      updater:
        | MemoCaptureInput
        | ((current: MemoCaptureInput) => MemoCaptureInput),
    ) => {
      hasLocalChanges.current = true;
      setDraftState((current) => {
        const next = createMemoCaptureInput(
          typeof updater === "function" ? updater(current) : updater,
        );
        latestDraft.current = next;
        return next;
      });
    },
    [],
  );

  const enqueuePersistence = useCallback((operation: () => Promise<void>) => {
    const next = persistenceQueue.current
      .catch(() => undefined)
      .then(operation)
      .catch(() => undefined);
    persistenceQueue.current = next;
    return next;
  }, []);

  const restoreDraft = useCallback(async () => {
    const request = restoreRequest.current + 1;
    restoreRequest.current = request;
    const available = await isLocalMemoCaptureAvailable();
    const restored = available ? await restoreMemoDraft(draftId) : null;
    if (restoreRequest.current !== request) return null;
    const shouldApplyStoredDraft =
      restored !== null &&
      !isMemoCaptureEmpty(restored) &&
      !hasLocalChanges.current;
    if (restored && shouldApplyStoredDraft) {
      const next = createMemoCaptureInput(restored);
      latestDraft.current = next;
      setDraftState(next);
    }
    setStatus(available ? "ready" : "unavailable");
    setRestoredDraftId(draftId);
    setRestoredStoredDraftId(shouldApplyStoredDraft ? draftId : null);
    return restored;
  }, [draftId]);

  useEffect(() => {
    hasLocalChanges.current = false;
    void restoreDraft();
  }, [restoreDraft]);

  useEffect(() => {
    if (!isRestored) return;

    const snapshot = draft;
    const timeout = window.setTimeout(() => {
      void enqueuePersistence(async () => {
        setStatus("saving");
        if (isMemoCaptureEmpty(snapshot)) {
          const deleted = await removeMemoDraft(draftId);
          setStatus(deleted ? "ready" : "unavailable");
          return;
        }

        const saved = await saveMemoDraft(snapshot, draftId);
        setStatus(saved ? "ready" : "unavailable");
      });
    }, debounceMs);

    return () => window.clearTimeout(timeout);
  }, [debounceMs, draft, draftId, enqueuePersistence, isRestored]);

  const discardDraft = useCallback(async () => {
    hasLocalChanges.current = true;
    const next = emptyCapture(initialVisibility);
    latestDraft.current = next;
    setDraftState(next);
    setRestoredStoredDraftId(null);
    await enqueuePersistence(async () => {
      const deleted = await removeMemoDraft(draftId);
      setStatus(deleted ? "ready" : "unavailable");
    });
  }, [draftId, enqueuePersistence, initialVisibility]);

  const queueCurrentSubmission = useCallback(async () => {
    const queued = await enqueueMemoSubmission(latestDraft.current);
    if (!queued) setStatus("unavailable");
    return queued;
  }, []);

  return {
    draft,
    status,
    isRestored,
    didRestoreStoredDraft,
    setContent: (content) =>
      updateDraft((current) => ({ ...current, content })),
    setVisibility: (visibility) =>
      updateDraft((current) => ({ ...current, visibility })),
    setTags: (tags) => updateDraft((current) => ({ ...current, tags })),
    setFiles: (files) => updateDraft((current) => ({ ...current, files })),
    updateDraft,
    discardDraft,
    queueCurrentSubmission,
    restoreDraft,
  };
}

function emptyCapture(visibility: MemoVisibility): MemoCaptureInput {
  return {
    content: "",
    visibility,
    tags: [],
    files: [],
    clientId: createMemoCaptureClientId(),
  };
}
