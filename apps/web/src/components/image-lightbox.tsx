import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  RotateCcwIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

const MIN_SCALE = 1;
const MAX_SCALE = 8;
/** One wheel notch / zoom-button step. */
const SCALE_STEP = 0.25;

export type LightboxImage = {
  src: string;
  alt?: string;
  downloadUrl?: string;
  filename?: string;
};

type ImageLightboxProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  images: LightboxImage[];
  index: number;
  onIndexChange?: (index: number) => void;
};

const TOOL_CLASS =
  "size-8 text-white/80 hover:bg-white/15 hover:text-white disabled:text-white/30";

/**
 * Full-surface image preview. At the fit scale the image fills the viewport
 * width but never grows past its own pixels (a small image stays sharp, a
 * tall screenshot stays readable by scrolling). Wheel or button zoom grows
 * it beyond the viewport and the overflow pans with native scroll. Several
 * images from one memo page with the side arrows or ←/→; clicking the dark
 * area around the image closes.
 */
export function ImageLightbox({
  open,
  onOpenChange,
  images,
  index,
  onIndexChange,
}: ImageLightboxProps) {
  const { t } = useI18n();
  const [scale, setScale] = useState(MIN_SCALE);
  // Set once the img loads; lets the fit width cap at the intrinsic width.
  const [intrinsic, setIntrinsic] = useState<{ w: number; h: number } | null>(
    null,
  );
  const viewportRef = useRef<HTMLDivElement>(null);
  const image = images[index];
  const count = images.length;

  // A new image (or a closed viewer) starts back at the fit view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset keyed on the shown image
  useEffect(() => {
    setScale(MIN_SCALE);
    setIntrinsic(null);
    viewportRef.current?.scrollTo({ top: 0, left: 0 });
  }, [open, image?.src]);

  const zoomTo = useCallback((next: number) => {
    setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, next)));
  }, []);

  const step = useCallback(
    (delta: number) => {
      if (count < 2) return;
      onIndexChange?.((index + delta + count) % count);
    },
    [count, index, onIndexChange],
  );

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.deltaY) return;
    event.preventDefault();
    setScale((current) => {
      const next =
        current * (event.deltaY < 0 ? 1 + SCALE_STEP : 1 / (1 + SCALE_STEP));
      return Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
    });
  }, []);

  if (!image) return null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md transition-opacity duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup
          className="fixed inset-0 z-50 flex flex-col p-3 outline-none select-none sm:p-4"
          initialFocus={viewportRef}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") step(-1);
            else if (event.key === "ArrowRight") step(1);
          }}
        >
          <div className="relative z-10 flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2 text-xs text-white/70">
              {count > 1 && (
                <span
                  className="shrink-0 tabular-nums text-white/90"
                  data-lightbox-counter
                >
                  {index + 1} / {count}
                </span>
              )}
              <span className="truncate">
                {image.filename ?? image.alt ?? ""}
              </span>
            </span>
            <div className="flex shrink-0 items-center gap-1">
              {/* Zoom is a pointer affordance; touch screens pinch. */}
              <div className="hidden items-center gap-1 [@media(pointer:fine)]:flex">
                <Button
                  aria-label={t("imageViewer.zoomOut")}
                  className={TOOL_CLASS}
                  disabled={scale <= MIN_SCALE}
                  size="icon-sm"
                  title={t("imageViewer.zoomOut")}
                  type="button"
                  variant="ghost"
                  onClick={() => zoomTo(scale - SCALE_STEP)}
                >
                  <ZoomOutIcon className="size-4" />
                </Button>
                <span className="min-w-10 text-center text-xs tabular-nums text-white/70">
                  {Math.round(scale * 100)}%
                </span>
                <Button
                  aria-label={t("imageViewer.zoomIn")}
                  className={TOOL_CLASS}
                  disabled={scale >= MAX_SCALE}
                  size="icon-sm"
                  title={t("imageViewer.zoomIn")}
                  type="button"
                  variant="ghost"
                  onClick={() => zoomTo(scale + SCALE_STEP)}
                >
                  <ZoomInIcon className="size-4" />
                </Button>
                <Button
                  aria-label={t("imageViewer.reset")}
                  className={TOOL_CLASS}
                  disabled={scale === MIN_SCALE}
                  size="icon-sm"
                  title={t("imageViewer.reset")}
                  type="button"
                  variant="ghost"
                  onClick={() => zoomTo(MIN_SCALE)}
                >
                  <RotateCcwIcon className="size-4" />
                </Button>
              </div>
              {image.downloadUrl && (
                <Button
                  aria-label={t("common.download")}
                  className={TOOL_CLASS}
                  render={
                    <a download={image.filename} href={image.downloadUrl} />
                  }
                  size="icon-sm"
                  title={t("common.download")}
                  variant="ghost"
                >
                  <DownloadIcon className="size-4" />
                </Button>
              )}
              <DialogPrimitive.Close
                render={
                  <Button
                    aria-label={t("common.close")}
                    className={TOOL_CLASS}
                    size="icon-sm"
                    title={t("common.close")}
                    type="button"
                    variant="ghost"
                  >
                    <XIcon className="size-4" />
                  </Button>
                }
              />
            </div>
          </div>

          <div className="relative mt-2 min-h-0 flex-1">
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes from the keyboard */}
            {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop click-to-close */}
            <div
              className={cn(
                "flex size-full overflow-auto outline-none",
                scale === MIN_SCALE && "cursor-zoom-out",
              )}
              onClick={(event) => {
                if (event.target === event.currentTarget) onOpenChange(false);
              }}
              onWheel={handleWheel}
              ref={viewportRef}
              tabIndex={-1}
            >
              <img
                alt={image.alt ?? image.filename ?? ""}
                className="m-auto block max-w-none cursor-default rounded-lg shadow-2xl"
                decoding="async"
                key={image.src}
                src={image.src}
                onLoad={(event) => {
                  const img = event.currentTarget;
                  if (img.naturalWidth) {
                    setIntrinsic({ w: img.naturalWidth, h: img.naturalHeight });
                  }
                }}
                style={
                  // Fit = viewport width capped at the image's own width;
                  // zoom multiplies that box. Height follows the ratio.
                  intrinsic
                    ? { width: `calc(${scale} * min(100%, ${intrinsic.w}px))` }
                    : { maxWidth: "100%" }
                }
              />
            </div>
            {count > 1 && (
              <>
                <Button
                  aria-label={t("imageViewer.previous")}
                  className="absolute start-1 top-1/2 size-10 -translate-y-1/2 rounded-full bg-black/40 text-white/90 hover:bg-black/60 hover:text-white sm:start-2"
                  size="icon"
                  title={t("imageViewer.previous")}
                  type="button"
                  variant="ghost"
                  onClick={() => step(-1)}
                >
                  <ChevronLeftIcon className="size-5 rtl:-scale-x-100" />
                </Button>
                <Button
                  aria-label={t("imageViewer.next")}
                  className="absolute end-1 top-1/2 size-10 -translate-y-1/2 rounded-full bg-black/40 text-white/90 hover:bg-black/60 hover:text-white sm:end-2"
                  size="icon"
                  title={t("imageViewer.next")}
                  type="button"
                  variant="ghost"
                  onClick={() => step(1)}
                >
                  <ChevronRightIcon className="size-5 rtl:-scale-x-100" />
                </Button>
              </>
            )}
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
