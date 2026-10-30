import { ArrowRightIcon } from "lucide-react";
import type { MemoVisibility } from "@/api";
import {
  type ComposerPublishType,
  ComposerTypeMenu,
} from "@/components/composer/composer-type-menu";
import { ComposerVisibilityMenu } from "@/components/composer/composer-visibility-menu";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/i18n";

/**
 * Right half of the focus canvas' bottom bar: the memo/article type chooser,
 * the visibility menu (memo only), and the submit CTA (article only — memo
 * submit lives inside the visibility menu's send button).
 */
export function ComposerCanvasActions({
  publishType,
  isPending,
  isUploadingImages,
  voiceActive,
  canSubmit,
  showVisibility,
  visibility,
  onTypeChange,
  onVisibilityChange,
}: {
  publishType: ComposerPublishType;
  isPending: boolean;
  isUploadingImages: boolean;
  voiceActive: boolean;
  canSubmit: boolean;
  showVisibility: boolean;
  visibility: MemoVisibility;
  onTypeChange: (type: ComposerPublishType) => void;
  onVisibilityChange: (visibility: MemoVisibility) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex shrink-0 items-center gap-2">
      <ComposerTypeMenu
        type={publishType}
        disabled={isPending}
        onTypeChange={onTypeChange}
      />
      {publishType === "memo" && (
        <ComposerVisibilityMenu
          showVisibility={showVisibility}
          visibility={visibility}
          isPending={isPending}
          isUploadingImages={isUploadingImages}
          canSubmit={canSubmit}
          voiceActive={voiceActive}
          onVisibilityChange={onVisibilityChange}
        />
      )}
      {publishType === "article" && (
        <Button
          type="submit"
          variant="brand"
          className="h-7 gap-1.5 rounded-full px-3 text-xs font-medium"
          disabled={isPending || isUploadingImages || voiceActive}
        >
          {isPending ? (
            <Spinner className="size-3.5" />
          ) : (
            <>
              <span>{t("composer.action.toArticleEditor")}</span>
              <kbd className="hidden font-mono text-[10px] opacity-80 sm:inline-block">
                ⌘↵
              </kbd>
              <ArrowRightIcon className="size-3.5" />
            </>
          )}
        </Button>
      )}
    </div>
  );
}
