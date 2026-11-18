import { CircleAlertIcon, DownloadIcon, FileIcon } from "lucide-react";
import { useState } from "react";
import type { Attachment } from "@/api";
import { ImageLightbox, type LightboxImage } from "@/components/image-lightbox";
import { useI18n } from "@/i18n";
import { attachmentImageDimensions } from "@/lib/attachment-refs";
import { cn, formatBytes } from "@/lib/utils";

function toLightboxImage(attachment: Attachment): LightboxImage {
  return {
    src: attachment.preview_url,
    alt: attachment.filename,
    downloadUrl: attachment.download_url,
    filename: attachment.filename,
  };
}

function GalleryItem({ attachment }: { attachment: Attachment }) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  const isAudio = attachment.content_type?.startsWith("audio/");
  return (
    <div
      className="overflow-hidden rounded-xl border border-border/60 bg-card transition-shadow duration-200 hover:border-border hover:shadow-xs"
      key={attachment.name}
    >
      {isAudio &&
        (failed ? (
          <p className="flex items-center gap-2 bg-muted/40 px-3 py-3 text-xs text-muted-foreground">
            <CircleAlertIcon className="size-4 shrink-0" />
            {t("reading.audioUnavailable")}
          </p>
        ) : (
          // biome-ignore lint/a11y/useMediaCaption: User-uploaded audio does not include a caption track.
          <audio className="w-full px-3 pt-3" controls preload="metadata">
            <source
              src={attachment.preview_url}
              onError={() => setFailed(true)}
              type={attachment.content_type ?? undefined}
            />
          </audio>
        ))}
      <a
        className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:bg-muted/60 focus-visible:text-foreground"
        href={attachment.download_url}
      >
        {isAudio ? (
          <DownloadIcon className="size-4 shrink-0" />
        ) : (
          <FileIcon className="size-4 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">{attachment.filename}</span>
        <span className="shrink-0 text-xs tabular-nums">
          {formatBytes(attachment.size)}
        </span>
      </a>
    </div>
  );
}

/**
 * One image tile. A lone image keeps its own shape (capped in height); two or
 * more become square tiles, cropped to fill, so a note with several photos
 * reads as one compact grid instead of a tall stack.
 */
function ImageTile({
  attachment,
  tiled,
  onOpen,
}: {
  attachment: Attachment;
  tiled: boolean;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  const dimensions = attachmentImageDimensions(attachment);
  if (failed) {
    return (
      <p
        className={cn(
          "flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-4 text-xs text-muted-foreground",
          tiled && "aspect-square justify-center px-2 text-center",
        )}
      >
        <CircleAlertIcon className="size-4 shrink-0" />
        {!tiled && t("attachment.unavailable")}
      </p>
    );
  }
  return (
    <button
      aria-label={attachment.filename}
      className={cn(
        "block cursor-zoom-in overflow-hidden rounded-lg border border-border/60 bg-muted outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25",
        tiled ? "aspect-square w-full" : "w-fit max-w-full",
      )}
      type="button"
      onClick={onOpen}
    >
      <img
        alt={attachment.filename}
        className={cn(
          "motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out-expo motion-safe:hover:scale-[1.015]",
          tiled
            ? "size-full object-cover"
            : "h-auto max-h-[28rem] w-auto max-w-full object-contain",
        )}
        height={dimensions?.height}
        loading="lazy"
        onError={() => setFailed(true)}
        src={attachment.thumbnail_url ?? attachment.preview_url}
        style={
          !tiled && dimensions
            ? { aspectRatio: `${dimensions.width} / ${dimensions.height}` }
            : undefined
        }
        width={dimensions?.width}
      />
    </button>
  );
}

/**
 * A memo's attachments: images as a grid (up to three across, two across for
 * two or four so the grid stays square), then audio and files as rows.
 */
export function AttachmentGallery({
  attachments,
}: {
  attachments: Attachment[];
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (attachments.length === 0) return null;
  const images = attachments.filter((item) =>
    item.content_type?.startsWith("image/"),
  );
  const others = attachments.filter(
    (item) => !item.content_type?.startsWith("image/"),
  );
  const tiled = images.length > 1;
  const twoAcross = images.length === 2 || images.length === 4;
  return (
    <div className="flex flex-col gap-2">
      {images.length > 0 && (
        <div
          className={cn(
            tiled && "grid gap-1.5",
            tiled &&
              (twoAcross ? "max-w-sm grid-cols-2" : "max-w-md grid-cols-3"),
          )}
        >
          {images.map((attachment, index) => (
            <ImageTile
              attachment={attachment}
              key={attachment.name}
              tiled={tiled}
              onOpen={() => setOpenIndex(index)}
            />
          ))}
        </div>
      )}
      {images.length > 0 && (
        <ImageLightbox
          images={images.map(toLightboxImage)}
          index={Math.min(openIndex ?? 0, images.length - 1)}
          open={openIndex !== null}
          onIndexChange={setOpenIndex}
          onOpenChange={(open) => {
            if (!open) setOpenIndex(null);
          }}
        />
      )}
      {others.map((attachment) => (
        <GalleryItem attachment={attachment} key={attachment.name} />
      ))}
    </div>
  );
}
