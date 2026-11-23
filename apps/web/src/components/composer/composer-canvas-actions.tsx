import type { MemoVisibility } from "@/api";
import { ComposerVisibilityMenu } from "@/components/composer/composer-visibility-menu";

/**
 * Right half of the focus canvas' bottom bar: the same send control as the
 * inline composer (visibility menu + send). The canvas is a bigger room for
 * one note; articles start on the Articles page, so there is no second
 * destination to choose here.
 */
export function ComposerCanvasActions({
  isPending,
  isUploadingImages,
  voiceActive,
  canSubmit,
  showVisibility,
  visibility,
  onVisibilityChange,
}: {
  isPending: boolean;
  isUploadingImages: boolean;
  voiceActive: boolean;
  canSubmit: boolean;
  showVisibility: boolean;
  visibility: MemoVisibility;
  onVisibilityChange: (visibility: MemoVisibility) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <ComposerVisibilityMenu
        showVisibility={showVisibility}
        visibility={visibility}
        isPending={isPending}
        isUploadingImages={isUploadingImages}
        canSubmit={canSubmit}
        voiceActive={voiceActive}
        onVisibilityChange={onVisibilityChange}
      />
    </div>
  );
}
