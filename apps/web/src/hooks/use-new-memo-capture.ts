import type { MemoVisibility } from "@flaremo/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createMemoCaptureClientId,
  createMemoCaptureInput,
  DEFAULT_NEW_MEMO_DRAFT_ID,
  isLocalMemoCaptureAvailable,
  isMemoCaptureEmpty,
  type MemoCaptureInput,
  removeMemoDraft,
  restoreMemoDraft,
  saveMemoDraft,
} from "@/lib/local-memo-capture";

export type UseNewMemoCaptureOptions = {
  draftId?: string;
  initialVisibility?: MemoVisibility;
  debounceMs?: number;
};

export type UseNewMemoCaptureResult = {
  draft: MemoCaptureInput;
  /** True only when a non-empty persisted draft replaced the initial state. */
  didRestoreStoredDraft: boolean;
  updateDraft: (
    updater:
      | MemoCaptureInput
      | ((current: MemoCaptureInput) => MemoCaptureInput),
  ) => void;
  discardDraft: () => Promise<void>;
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
        if (isMemoCaptureEmpty(snapshot)) {
          await removeMemoDraft(draftId);
          return;
        }
        await saveMemoDraft(snapshot, draftId);
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
      await removeMemoDraft(draftId);
    });
  }, [draftId, enqueuePersistence, initialVisibility]);

  return {
    draft,
    didRestoreStoredDraft,
    updateDraft,
    discardDraft,
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
