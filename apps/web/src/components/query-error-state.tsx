import { CircleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/i18n";

/**
 * Shared "load failed" state with a retry button, matching the timeline's
 * standard so failed queries never render as empty data.
 */
export function QueryErrorState({
  isRetrying,
  onRetry,
  className,
}: {
  isRetrying?: boolean;
  onRetry: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <Empty className={className ?? "min-h-64 text-muted-foreground"}>
      <EmptyHeader>
        <EmptyMedia
          className="bg-destructive/10 text-destructive"
          variant="icon"
        >
          <CircleAlertIcon />
        </EmptyMedia>
        <EmptyTitle>{t("list.errorTitle")}</EmptyTitle>
        <EmptyDescription>{t("list.errorDescription")}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          disabled={isRetrying}
          size="sm"
          variant="outline"
          onClick={onRetry}
        >
          {isRetrying && <Spinner data-icon="inline-start" />}
          {t("common.retry")}
        </Button>
      </EmptyContent>
    </Empty>
  );
}
