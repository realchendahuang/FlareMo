import { PaperclipIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

// Stable React keys for `File` objects: pending attachments have no id yet and
// two picked files can share a name, so identity is tracked here instead.
const fileKeys = new WeakMap<File, string>();
let nextFileKey = 0;

function getFileKey(file: File) {
  const existing = fileKeys.get(file);
  if (existing) return existing;

  const key = `file-${nextFileKey}`;
  nextFileKey += 1;
  fileKeys.set(file, key);
  return key;
}

/**
 * Pending (not yet uploaded) attachments waiting on the draft. Each chip
 * removes exactly the file it shows, letting two same-named picks be
 * discarded independently.
 */
export function ComposerFileChips({
  files,
  isPending,
  onRemoveFile,
  className,
}: {
  files: File[];
  /** Placement overrides; the default inset matches the note composer. */
  className?: string;
  isPending: boolean;
  onRemoveFile: (file: File) => void;
}) {
  const { t } = useI18n();
  if (files.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-2 px-4 pb-2", className)}>
      {files.map((file) => (
        <div
          className="flex max-w-full items-center gap-2 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
          key={getFileKey(file)}
        >
          <PaperclipIcon className="size-3.5 shrink-0" />
          <span className="truncate">{file.name}</span>
          <Button
            aria-label={t("composer.removeFile", { filename: file.name })}
            disabled={isPending}
            size="icon-xs"
            type="button"
            variant="ghost"
            onClick={() => onRemoveFile(file)}
          >
            <XIcon />
          </Button>
        </div>
      ))}
    </div>
  );
}
