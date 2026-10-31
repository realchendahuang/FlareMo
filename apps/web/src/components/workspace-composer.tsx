import type { MemoVisibility } from "@flaremo/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CloudOffIcon } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { MemoSpace } from "@/api";
import { MemoComposer } from "@/components/memo-composer";
import { useMemoMutations } from "@/hooks/use-memo-mutations";
import { useNewMemoCapture } from "@/hooks/use-new-memo-capture";
import { useI18n } from "@/i18n";
import { focusComposerInput } from "@/lib/composer-focus";
import {
  enqueueMemoSubmission,
  flushQueuedMemoSubmissions,
  getNewMemoDraftId,
  isBrowserOnline,
  isMemoCaptureEmpty,
  listQueuedMemoSubmissions,
  type MemoCaptureInput,
} from "@/lib/local-memo-capture";
import { fileScheduledTasks } from "@/lib/memo-schedule";
import {
  shouldContinueQueuedSubmissionAfterFailure,
  shouldQueueAfterFailure,
  validateMemoCaptureSubmission,
} from "@/lib/memo-submission";
import { queryKeys } from "@/lib/query-keys";

// The composer's send target defaults to the active space ("归属在创建时决定").
// An explicit pick is remembered per space so a member who publishes to the
// team keeps that habit without re-selecting on every visit.
const VISIBILITY_PREF_KEY = "flaremo.composer.visibility";

type VisibilityPref = Partial<Record<MemoSpace, MemoVisibility>>;

function readVisibilityPref(): VisibilityPref {
  try {
    const raw = localStorage.getItem(VISIBILITY_PREF_KEY);
    const parsed = raw ? (JSON.parse(raw) as VisibilityPref) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeVisibilityPref(pref: VisibilityPref) {
  try {
    localStorage.setItem(VISIBILITY_PREF_KEY, JSON.stringify(pref));
  } catch {
    // Persistence is best-effort; the in-memory choice still applies.
  }
}

// Keep draft updates and upload progress inside the capture boundary. This
// component stays mounted across workspace filters so drafts and offline
// synchronization survive a visit to the archive or trash.
export const WorkspaceComposer = memo(function WorkspaceComposer({
  visible,
  composeRequested,
  space,
  hasTeam,
  tags,
  captureAvailable,
}: {
  visible: boolean;
  composeRequested: boolean;
  space: MemoSpace;
  hasTeam: boolean;
  tags?: Array<{ name: string; count: number }>;
  captureAvailable?: boolean;
}) {
  const { t } = useI18n();
  const navigate = useNavigate({ from: "/" });
  const [newMemoDraftId] = useState(getNewMemoDraftId);
  const [visibilityPref, setVisibilityPref] =
    useState<VisibilityPref>(readVisibilityPref);
  const spaceDefault: MemoVisibility =
    hasTeam && space === "team" ? "protected" : "private";
  const preferredVisibility = visibilityPref[space] ?? spaceDefault;
  const capture = useNewMemoCapture({
    draftId: newMemoDraftId,
    initialVisibility: preferredVisibility,
  });
  const { createMemoAsync, isCreatingMemo, handleMutationError } =
    useMemoMutations();
  const queryClient = useQueryClient();
  // A scheduled memo files its to-dos as tasks once the memo exists. The
  // memo is the durable part: a task failure is reported, never rolled back
  // into a lost note. Returns the toast the send should show.
  const createMemoAndSchedule = useCallback(
    async (submission: MemoCaptureInput) => {
      const memo = await createMemoAsync(submission);
      if (!submission.schedule) return { memo, message: t("toast.saved") };
      try {
        const count = await fileScheduledTasks(
          memo.name,
          submission.content,
          submission.schedule,
        );
        void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
        void queryClient.invalidateQueries({ queryKey: ["projects"] });
        return {
          memo,
          message:
            count > 0 ? t("toast.scheduledTasks", { count }) : t("toast.saved"),
        };
      } catch {
        toast.error(t("toast.scheduleFailed"));
        return { memo, message: undefined };
      }
    },
    [createMemoAsync, queryClient, t],
  );
  // A quiet, persistent notice while offline or while notes wait in the
  // local queue; the toasts alone vanish and leave the user guessing.
  const [online, setOnline] = useState(isBrowserOnline);
  const [queuedCount, setQueuedCount] = useState(0);
  const refreshQueuedCount = useCallback(async () => {
    try {
      setQueuedCount((await listQueuedMemoSubmissions()).length);
    } catch {
      setQueuedCount(0);
    }
  }, []);
  useEffect(() => {
    void refreshQueuedCount();
    const sync = () => setOnline(isBrowserOnline());
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, [refreshQueuedCount]);
  const isQueueFlushing = useRef(false);
  const isQueueFlushPending = useRef(false);
  const isCaptureSubmitting = useRef(false);
  const restoredDraftNotified = useRef(false);
  const [isCaptureSubmissionPending, setIsCaptureSubmissionPending] =
    useState(false);

  // Following the space into a different corpus retargets an untouched draft.
  // A draft with content keeps the visibility its author already chose.
  const lastVisibilitySource = useRef(preferredVisibility);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retarget on preference change, not on every draft keystroke; the capture object is stable across renders
  useEffect(() => {
    if (lastVisibilitySource.current === preferredVisibility) return;
    lastVisibilitySource.current = preferredVisibility;
    if (!isMemoCaptureEmpty(capture.draft)) return;
    capture.updateDraft((current) => ({
      ...current,
      visibility: preferredVisibility,
    }));
  }, [preferredVisibility]);

  const flushQueuedCaptures = useCallback(async () => {
    if (!isBrowserOnline()) return;
    // An "online" event that lands while a flush is running (e.g. the mount
    // flush) must schedule another pass instead of being swallowed.
    if (isQueueFlushing.current) {
      isQueueFlushPending.current = true;
      return;
    }

    isQueueFlushing.current = true;
    try {
      let submitted = 0;
      let failed = 0;
      do {
        isQueueFlushPending.current = false;
        const result = await flushQueuedMemoSubmissions(
          async (submission) => (await createMemoAndSchedule(submission)).memo,
          {
            shouldContinueAfterFailure:
              shouldContinueQueuedSubmissionAfterFailure,
          },
        );
        submitted += result.submittedIds.length;
        failed += result.failedIds.length;
      } while (isQueueFlushPending.current && isBrowserOnline());
      if (submitted > 0) {
        toast.success(t("toast.queueSynced"));
      }
      if (failed > 0) {
        toast.error(t("toast.queueNeedsAttention", { count: failed }));
      }
    } finally {
      isQueueFlushing.current = false;
      void refreshQueuedCount();
    }
  }, [createMemoAndSchedule, refreshQueuedCount, t]);

  useEffect(() => {
    void flushQueuedCaptures();
    const handleOnline = () => void flushQueuedCaptures();
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [flushQueuedCaptures]);

  useEffect(() => {
    if (!capture.didRestoreStoredDraft || restoredDraftNotified.current) return;
    restoredDraftNotified.current = true;
    toast.success(t("toast.draftRestored"));
  }, [capture.didRestoreStoredDraft, t]);

  // The PWA "new note" shortcut lands on `/?compose=1`. Focus the composer and
  // strip the flag so a later reload does not steal focus again.
  useEffect(() => {
    if (!composeRequested || !visible) return;
    focusComposerInput();
    void navigate({
      replace: true,
      search: (current) => ({ ...current, compose: undefined }),
    });
  }, [composeRequested, navigate, visible]);

  const handleCaptureSubmit = async (input: MemoCaptureInput) => {
    if (isCaptureSubmitting.current) return;

    isCaptureSubmitting.current = true;
    setIsCaptureSubmissionPending(true);
    const submission = {
      ...input,
      content: input.content || t("toast.untitledAttachment"),
    };
    try {
      const validationError = validateMemoCaptureSubmission(submission, t);
      if (validationError) {
        handleMutationError(validationError);
        throw validationError;
      }

      if (!isBrowserOnline()) {
        const queued = await enqueueMemoSubmission(submission);
        if (!queued) {
          const error = new Error(t("toast.offlineStorageUnavailable"));
          handleMutationError(error);
          throw error;
        }
        await capture.discardDraft();
        void refreshQueuedCount();
        toast.success(t("toast.queuedForSync"));
        return;
      }

      try {
        const { message } = await createMemoAndSchedule(submission);
        await capture.discardDraft();
        if (message) toast.success(message);
      } catch (error) {
        if (!shouldQueueAfterFailure(error)) {
          handleMutationError(error);
          throw error;
        }

        const queued = await enqueueMemoSubmission(submission);
        if (!queued) {
          handleMutationError(error);
          throw error;
        }
        await capture.discardDraft();
        void refreshQueuedCount();
        toast.success(t("toast.queuedForSync"));
      }
    } finally {
      isCaptureSubmitting.current = false;
      setIsCaptureSubmissionPending(false);
    }
  };

  if (!visible) return null;
  const showOfflineNotice = !online || queuedCount > 0;
  return (
    <>
      {showOfflineNotice && (
        <div
          className="flex items-center gap-2 rounded-lg border border-dashed border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground motion-safe:animate-rise"
          role="status"
        >
          <CloudOffIcon aria-hidden="true" className="size-3.5 shrink-0" />
          {queuedCount > 0
            ? t("composer.offlinePending", { count: queuedCount })
            : t("composer.offlineNotice")}
        </div>
      )}
      <MemoComposer
        draft={capture.draft}
        isPending={isCreatingMemo || isCaptureSubmissionPending}
        showVisibility={hasTeam}
        tags={tags}
        captureAvailable={captureAvailable}
        onDraftChange={capture.updateDraft}
        onVisibilityChange={(visibility) => {
          setVisibilityPref((current) => {
            const next = { ...current, [space]: visibility };
            writeVisibilityPref(next);
            return next;
          });
        }}
        onSubmit={handleCaptureSubmit}
      />
    </>
  );
});
