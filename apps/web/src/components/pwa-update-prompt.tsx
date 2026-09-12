import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { usePwaUpdate } from "@/hooks/use-pwa";
import { useI18n } from "@/i18n";

const UPDATE_TOAST_ID = "flaremo-pwa-update";

/**
 * Global prompt for a newer deployed frontend. It renders nothing; it only
 * raises a persistent toast with an explicit action, so a background service
 * worker update never reloads the page while the user is mid-edit.
 */
export function PwaUpdatePrompt() {
  const { t } = useI18n();
  const { updateAvailable, applyUpdate } = usePwaUpdate();
  const shownRef = useRef(false);

  useEffect(() => {
    if (!updateAvailable || shownRef.current) return;
    shownRef.current = true;
    toast(t("pwa.updateAvailable"), {
      id: UPDATE_TOAST_ID,
      description: t("pwa.updateDescription"),
      duration: Number.POSITIVE_INFINITY,
      action: {
        label: t("pwa.updateNow"),
        onClick: () => applyUpdate(),
      },
    });
  }, [updateAvailable, applyUpdate, t]);

  return null;
}
