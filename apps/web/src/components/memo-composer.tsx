import {
  HashIcon,
  ImageIcon,
  ListIcon,
  Loader2Icon,
  PaperclipIcon,
  SendIcon,
  XIcon,
} from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n";
import type { MemoCaptureInput } from "@/lib/local-memo-capture";
import { extractTags } from "@/lib/memo";

type MemoComposerProps = {
  draft: MemoCaptureInput;
  isPending: boolean;
  onDraftChange: (draft: MemoCaptureInput) => void;
  onSubmit: (input: MemoCaptureInput) => Promise<void>;
};

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

export function MemoComposer({
  draft,
  isPending,
  onDraftChange,
  onSubmit,
}: MemoComposerProps) {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canSubmit = Boolean(draft.content.trim() || draft.files.length > 0);

  // The composer grows with the draft instead of scrolling, up to a cap.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure the height whenever the draft text changes.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 320)}px`;
  }, [draft.content]);

  const updateContent = (content: string) =>
    onDraftChange({
      ...draft,
      content,
      tags: extractTags(content),
    });
  const appendText = (value: string) => {
    updateContent(
      `${draft.content}${draft.content && !draft.content.endsWith("\n") ? " " : ""}${value}`,
    );
  };
  const submit = async () => {
    if (!canSubmit) {
      return;
    }
    try {
      await onSubmit(draft);
    } catch {
      // The mutation owns user-facing error feedback; keep the draft intact.
    }
  };

  return (
    <form
      className="group relative flex w-full flex-col rounded-xl border border-border bg-card shadow-xs motion-safe:animate-rise motion-safe:transition-[border-color,box-shadow] motion-safe:duration-200 focus-within:border-flame-400/60 focus-within:shadow-md focus-within:ring-2 focus-within:ring-flame-400/25"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Textarea
        aria-label={t("composer.ariaLabel")}
        className="min-h-32 resize-none overflow-y-auto rounded-t-xl border-0 px-4 pt-4 pb-2 text-[15px] leading-7 shadow-none focus-visible:ring-0"
        disabled={isPending}
        id="flaremo-composer-input"
        placeholder={t("composer.placeholder")}
        ref={textareaRef}
        value={draft.content}
        onChange={(event) => updateContent(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
        }}
      />
      {draft.files.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pb-2">
          {draft.files.map((file) => (
            <div
              className="flex max-w-full items-center gap-2 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
              key={getFileKey(file)}
            >
              <PaperclipIcon />
              <span className="truncate">{file.name}</span>
              <Button
                aria-label={t("composer.removeFile", { filename: file.name })}
                disabled={isPending}
                size="icon-xs"
                type="button"
                variant="ghost"
                onClick={() =>
                  onDraftChange({
                    ...draft,
                    files: draft.files.filter((item) => item !== file),
                  })
                }
              >
                <XIcon />
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex h-10 items-center justify-between gap-2 rounded-b-xl bg-card px-3 pb-1">
        <div className="flex min-w-0 items-center gap-1">
          <Button
            aria-label={t("composer.addTag")}
            disabled={isPending}
            size="icon-sm"
            type="button"
            variant="ghost"
            onClick={() => appendText("#")}
          >
            <HashIcon />
          </Button>
          <Button asChild disabled={isPending} size="icon-sm" variant="ghost">
            <label
              aria-label={t("composer.addAttachment")}
              htmlFor="flaremo-attachment-input"
            >
              <ImageIcon />
              <Input
                className="hidden"
                id="flaremo-attachment-input"
                multiple
                type="file"
                disabled={isPending}
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  if (files.length === 0) return;
                  onDraftChange({
                    ...draft,
                    files: [...draft.files, ...files],
                  });
                }}
              />
            </label>
          </Button>
          <div className="hidden h-4 w-px bg-border sm:block" />
          <Button
            aria-label={t("composer.bulletList")}
            disabled={isPending}
            size="icon-sm"
            type="button"
            variant="ghost"
            onClick={() => appendText("- ")}
          >
            <ListIcon />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            className="size-8 rounded-lg px-0"
            disabled={isPending || !canSubmit}
            size="icon-sm"
            type="submit"
            variant="brand"
          >
            {isPending ? (
              <Loader2Icon className="animate-spin" data-icon="inline-start" />
            ) : (
              <SendIcon
                className="motion-safe:animate-scale-in"
                data-icon="inline-start"
              />
            )}
            <span className="sr-only">{t("common.save")}</span>
          </Button>
        </div>
      </div>
    </form>
  );
}
