import { BookOpenIcon, MessageSquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

export type ComposerPublishType = "memo" | "article";

export function ComposerTypeMenu({
  type,
  disabled,
  onTypeChange,
}: {
  type: ComposerPublishType;
  disabled?: boolean;
  onTypeChange: (type: ComposerPublishType) => void;
}) {
  const { t } = useI18n();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={t("composer.type.label")}
            className={cn(
              "h-7 gap-1.5 rounded-full border px-2.5 text-xs transition-colors",
              type === "article"
                ? "border-brand-500/40 bg-brand-50/60 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300 font-medium"
                : "border-border/60 bg-card text-muted-foreground hover:text-foreground",
            )}
            disabled={disabled}
            size="sm"
            type="button"
            variant="ghost"
          />
        }
      >
        {type === "article" ? (
          <BookOpenIcon data-icon="inline-start" className="size-3.5" />
        ) : (
          <MessageSquareIcon data-icon="inline-start" className="size-3.5" />
        )}
        {/* Icon-only on phones so the formatting tools keep the bar;
            the trigger's aria-label still names it. */}
        <span className="hidden sm:inline">
          {type === "article"
            ? t("composer.type.article")
            : t("composer.type.memo")}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => {
            if (type === "memo") return;
            onTypeChange("memo");
          }}
        >
          <MessageSquareIcon />
          {t("composer.type.memo")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            if (type === "article") return;
            onTypeChange("article");
          }}
        >
          <BookOpenIcon />
          {t("composer.type.article")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
