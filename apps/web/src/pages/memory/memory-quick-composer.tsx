import { useMutation } from "@tanstack/react-query";
import {
  CornerDownLeftIcon,
  FolderIcon,
  GlobeIcon,
  PinIcon,
  SparklesIcon,
} from "lucide-react";
import { type KeyboardEvent, type RefObject, useEffect, useState } from "react";
import { toast } from "sonner";
import { createMemory, type Memory } from "@/api";
import { useI18n } from "@/i18n";
import { errorMessage } from "@/lib/error";
import { cn } from "@/lib/utils";
import { formatProjectName } from "./memory-filters";

export function MemoryQuickComposer({
  onCreated,
  inputRef,
  defaultScopeKey,
}: {
  onCreated: () => void;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  defaultScopeKey?: string | null;
}) {
  const { t } = useI18n();
  const [content, setContent] = useState("");
  const [isCore, setIsCore] = useState(true);
  const [scopeType, setScopeType] = useState<Memory["scope_type"]>(() =>
    defaultScopeKey ? "project" : "global",
  );
  const [scopeKey, setScopeKey] = useState(() => defaultScopeKey || "");
  const [isFocused, setIsFocused] = useState(false);

  // Follow the page's project context both ways: leaving a project view must
  // not keep silently filing new memories under that project.
  useEffect(() => {
    setScopeType(defaultScopeKey ? "project" : "global");
    setScopeKey(defaultScopeKey || "");
  }, [defaultScopeKey]);

  const createMutation = useMutation({
    mutationFn: () =>
      createMemory({
        content: content.trim(),
        type: "semantic",
        kind: isCore ? "constraint" : "preference",
        scope_type: scopeType,
        scope_key:
          scopeType === "global" ? undefined : scopeKey.trim() || undefined,
        tier: isCore ? "core" : "normal",
        importance: isCore ? 80 : 50,
        lock: isCore,
      }),
    onSuccess: () => {
      toast.success(
        isCore ? t("toast.memoryPinned") : t("toast.memoryConfirmed"),
      );
      setContent("");
      onCreated();
    },
    onError: (error) => {
      toast.error(errorMessage(error, t("memory.createFailed")));
    },
  });

  const handleSubmit = () => {
    const text = content.trim();
    if (!text || createMutation.isPending) return;
    createMutation.mutate();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      handleSubmit();
    }
  };

  const placeholder = defaultScopeKey
    ? t("memory.composerPlaceholderProject", {
        project: formatProjectName(defaultScopeKey),
      })
    : isCore
      ? t("memory.composerPlaceholderCore")
      : t("memory.composerPlaceholderPreference");

  return (
    <form
      className="group relative flex w-full flex-col rounded-xl border border-border bg-card shadow-xs motion-safe:animate-rise motion-safe:transition-[border-color,box-shadow] motion-safe:duration-200 focus-within:border-brand-400/60 focus-within:shadow-md focus-within:ring-2 focus-within:ring-brand-400/25"
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
    >
      <textarea
        ref={inputRef}
        rows={isFocused || content.trim() ? 3 : 2}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          if (!content.trim()) setIsFocused(false);
        }}
        placeholder={placeholder}
        readOnly={createMutation.isPending}
        className="w-full resize-none bg-transparent px-3.5 pt-3 pb-2 text-sm placeholder:text-muted-foreground/60 focus:outline-hidden leading-relaxed"
      />

      <div className="flex h-10 items-center justify-between gap-2 rounded-b-xl bg-card px-3 pb-2 pt-1 border-t border-border/30">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          <button
            type="button"
            title={t("memory.tier")}
            aria-pressed={isCore}
            onClick={() => setIsCore(!isCore)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium border transition-colors cursor-pointer",
              isCore
                ? "border-brand-500/30 bg-brand-500/10 text-brand-600 dark:text-brand-400"
                : "border-border/60 bg-muted/40 text-muted-foreground hover:bg-muted/70 hover:text-foreground",
            )}
          >
            {isCore ? (
              <>
                <PinIcon className="size-3.5 fill-current" />
                <span>{t("memory.coreShort")}</span>
              </>
            ) : (
              <>
                <SparklesIcon className="size-3.5" />
                <span>{t("memory.kind.preference")}</span>
              </>
            )}
          </button>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                if (scopeType === "global") {
                  setScopeType("project");
                } else {
                  setScopeType("global");
                  setScopeKey("");
                }
              }}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium border transition-colors cursor-pointer",
                scopeType === "project"
                  ? "border-border bg-muted text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-muted/50",
              )}
            >
              {scopeType === "project" ? (
                <>
                  <FolderIcon className="size-3" />
                  <span>{t("memory.scope.project")}</span>
                </>
              ) : (
                <>
                  <GlobeIcon className="size-3" />
                  <span>{t("memory.scope.global")}</span>
                </>
              )}
            </button>

            {scopeType === "project" && (
              <input
                type="text"
                value={scopeKey}
                onChange={(e) => setScopeKey(e.target.value)}
                placeholder="github:org/repo"
                className="h-7 w-28 sm:w-36 rounded-md border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:border-brand-500"
              />
            )}
          </div>
        </div>

        <button
          type="submit"
          disabled={!content.trim() || createMutation.isPending}
          className="flex size-7.5 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white shadow-xs transition-colors hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          title="Enter"
        >
          <CornerDownLeftIcon className="size-3.5" />
        </button>
      </div>
    </form>
  );
}
