import { SendIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

/**
 * The round send control shared by every composer (timeline, focus canvas,
 * memory). A quiet grey disc while there is nothing to send, lit with the
 * brand gradient once there is; the paper plane lifts a pixel on hover.
 * `disabled` covers transient locks (uploading, recording) on top of
 * `canSubmit`, which alone decides lit vs idle.
 */
export function SendButton({
  canSubmit,
  isPending = false,
  disabled = false,
  className,
}: {
  canSubmit: boolean;
  isPending?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <Button
      aria-label={t("composer.send")}
      className={cn(
        "group/send size-8 rounded-full disabled:opacity-100",
        !canSubmit &&
          "disabled:bg-none disabled:bg-muted disabled:text-muted-foreground/60 disabled:shadow-none",
        className,
      )}
      disabled={isPending || disabled || !canSubmit}
      size="icon-sm"
      type="submit"
      variant="gradient"
    >
      {isPending ? (
        <Spinner />
      ) : (
        <SendIcon
          className={cn(
            "-translate-x-px translate-y-px motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-signal group-hover/send:translate-x-px group-hover/send:-translate-y-px",
            canSubmit && "motion-safe:animate-scale-in",
          )}
          key={canSubmit ? "lit" : "idle"}
        />
      )}
    </Button>
  );
}
