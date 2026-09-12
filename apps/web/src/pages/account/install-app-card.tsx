import { CheckCircleIcon, DownloadIcon, WifiOffIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePwaInstall } from "@/hooks/use-pwa";
import { useI18n } from "@/i18n";

/**
 * Account-page entry point for installing the PWA and a short explanation of
 * what installation buys the user. Chromium gets a real install button driven
 * by the stashed `beforeinstallprompt` event; iOS gets Add-to-Home-Screen
 * instructions, since Safari never exposes an install prompt.
 */
export function InstallAppCard() {
  const { t } = useI18n();
  const {
    canPromptInstall,
    isInstalled,
    promptInstall,
    shouldOfferInstall,
    dismissInstall,
  } = usePwaInstall();

  const isOfflineCapable =
    typeof navigator === "undefined" || "serviceWorker" in navigator;

  if (isInstalled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircleIcon className="size-4 text-primary" />
            {t("pwa.installedTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t("pwa.installedDescription")}
          </p>
        </CardContent>
      </Card>
    );
  }

  // Nothing to offer: an unsupported browser with no iOS fallback, or the user
  // previously dismissed the entry point. The offline capability note still
  // earns a card because it explains behavior users will observe anyway.
  if (!shouldOfferInstall) {
    if (!isOfflineCapable) return null;
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <WifiOffIcon className="size-4 text-muted-foreground" />
            {t("pwa.offlineTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t("pwa.offlineDescription")}
          </p>
        </CardContent>
      </Card>
    );
  }

  const handleInstall = async () => {
    const outcome = await promptInstall();
    if (outcome === "unavailable") {
      toast.error(t("pwa.installUnavailable"));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DownloadIcon className="size-4 text-primary" />
          {t("pwa.installTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {canPromptInstall ? t("pwa.installDescription") : t("pwa.iosHint")}
        </p>
        <div className="flex items-center gap-2">
          {canPromptInstall && (
            <Button size="sm" onClick={() => void handleInstall()}>
              <DownloadIcon data-icon="inline-start" />
              {t("pwa.installButton")}
            </Button>
          )}
          <Button
            className="ml-auto"
            size="sm"
            variant="ghost"
            onClick={dismissInstall}
          >
            {t("pwa.dismiss")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
