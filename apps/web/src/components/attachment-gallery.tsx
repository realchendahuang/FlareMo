import { DownloadIcon, FileIcon } from "lucide-react";
import type { Attachment } from "@/api";

export function AttachmentGallery({
  attachments,
  compact = false,
}: {
  attachments: Attachment[];
  compact?: boolean;
}) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {attachments.map((attachment) => {
        const isImage = attachment.content_type?.startsWith("image/");
        const isAudio = attachment.content_type?.startsWith("audio/");
        return (
          <div
            className="overflow-hidden rounded-xl border bg-card transition-shadow duration-200 hover:shadow-sm"
            key={attachment.name}
          >
            {!compact && isImage && (
              <a href={attachment.download_url}>
                <img
                  alt={attachment.filename}
                  className="max-h-[32rem] w-full bg-muted object-contain motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out-expo motion-safe:hover:scale-[1.015]"
                  loading="lazy"
                  src={attachment.preview_url}
                />
              </a>
            )}
            {!compact && isAudio && (
              // biome-ignore lint/a11y/useMediaCaption: User-uploaded audio does not include a caption track.
              <audio className="w-full px-3 pt-3" controls preload="metadata">
                <source
                  src={attachment.preview_url}
                  type={attachment.content_type ?? undefined}
                />
              </audio>
            )}
            <a
              className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              href={attachment.download_url}
            >
              {isImage || isAudio ? <DownloadIcon /> : <FileIcon />}
              <span className="min-w-0 flex-1 truncate">
                {attachment.filename}
              </span>
              <span className="shrink-0 text-xs">
                {formatBytes(attachment.size)}
              </span>
            </a>
          </div>
        );
      })}
    </div>
  );
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
