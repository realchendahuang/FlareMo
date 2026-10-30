import { CAPTURE_MAX_TEXT } from "@flaremo/contracts/constants";
import type { Dispatch, SetStateAction } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/i18n";
import type { LocalCapture } from "@/lib/audio-capture/local-session";

/**
 * The record → review hand-off form: transcript, tags, visibility and the
 * "save original audio" preference, plus the two exit actions (discard, save).
 * It is presentational — the draft state, the persistence and the save chain
 * stay with the page (use-capture-session / use-capture-submit).
 */
export function CaptureReviewForm({
  local,
  setLocal,
  saving,
  saveError,
  cleanupError,
  keepAudio,
  onKeepAudioChange,
  onDiscard,
  onSave,
}: {
  local: LocalCapture;
  setLocal: Dispatch<SetStateAction<LocalCapture>>;
  saving: boolean;
  saveError: boolean;
  cleanupError: boolean;
  keepAudio: boolean;
  onKeepAudioChange: (checked: boolean) => void;
  onDiscard: () => Promise<void>;
  onSave: () => Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-6 motion-safe:animate-rise">
      <label className="flex flex-col gap-2 text-sm font-medium">
        {t("capture.transcript")}
        <textarea
          aria-label={t("capture.transcript")}
          className="min-h-72 w-full resize-y rounded-xl border bg-card p-4 text-base leading-relaxed font-normal"
          maxLength={CAPTURE_MAX_TEXT}
          value={local.text}
          disabled={saving || cleanupError}
          onChange={(event) =>
            setLocal((value) => ({
              ...value,
              text: event.target.value,
            }))
          }
        />
        <span className="text-xs font-normal text-muted-foreground">
          {t("capture.charsUsed", {
            count: local.text.length.toLocaleString(),
            max: CAPTURE_MAX_TEXT.toLocaleString(),
          })}
        </span>
      </label>
      <label className="flex flex-col gap-2 text-sm">
        {t("capture.tags")}
        <input
          className="rounded-lg border bg-card p-3 text-base"
          value={local.tags.join(", ")}
          disabled={saving || cleanupError}
          onChange={(event) =>
            setLocal((value) => ({
              ...value,
              tags: event.target.value
                .split(",")
                .map((tag) => tag.trim().replace(/^#/, "").slice(0, 64))
                .slice(0, 20),
            }))
          }
        />
      </label>
      <label
        className="flex flex-col gap-2 text-sm"
        htmlFor="capture-visibility"
      >
        {t("capture.visibility")}
        <Select
          id="capture-visibility"
          value={local.visibility}
          disabled={saving || cleanupError}
          onChange={(event) =>
            setLocal((value) => ({
              ...value,
              visibility:
                event.target.value === "public" ? "public" : "private",
            }))
          }
        >
          <option value="private">{t("capture.private")}</option>
          <option value="public">{t("capture.public")}</option>
        </Select>
      </label>
      <div className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3">
        <span className="text-sm">{t("capture.keepAudio")}</span>
        <Switch
          checked={keepAudio}
          disabled={saving || cleanupError}
          onCheckedChange={onKeepAudioChange}
        />
      </div>
      {saveError && <p role="alert">{t("capture.saveFailed")}</p>}
      {cleanupError && <p role="alert">{t("capture.cleanupFailed")}</p>}
      <div className="flex gap-3">
        {!cleanupError && (
          <DiscardButton onDiscard={onDiscard} disabled={saving} />
        )}
        <Button
          className="flex-1"
          variant="brand"
          size="lg"
          disabled={saving || !local.text.trim()}
          onClick={() => void onSave()}
        >
          {saving && <Spinner data-icon="inline-start" />}
          {t(
            saving
              ? "capture.saving"
              : cleanupError
                ? "capture.retryCleanup"
                : "capture.save",
          )}
        </Button>
      </div>
    </div>
  );
}

export function DiscardButton({
  onDiscard,
  disabled = false,
}: {
  onDiscard: () => Promise<void>;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button variant="outline" disabled={disabled}>
            {t("capture.discard")}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("capture.discard")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("capture.discardConfirm")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => void onDiscard()}
          >
            {t("capture.discard")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
