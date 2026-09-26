import { useMutation } from "@tanstack/react-query";
import {
  CheckIcon,
  ChevronDownIcon,
  FolderIcon,
  GlobeIcon,
  Loader2Icon,
  PinIcon,
  PlusIcon,
  SendIcon,
  SparklesIcon,
} from "lucide-react";
import { type KeyboardEvent, type RefObject, useEffect, useState } from "react";
import { toast } from "sonner";
import { createMemory, type Memory } from "@/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n";
import { errorMessage } from "@/lib/error";
import { cn } from "@/lib/utils";
import { formatProjectName } from "./memory-filters";

export type MemoryQuickComposerProps = {
  onCreated: () => void;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  defaultScopeKey?: string | null;
  projects?: { key: string; displayName: string; count: number }[];
};

export function MemoryQuickComposer({
  onCreated,
  inputRef,
  defaultScopeKey,
  projects,
}: MemoryQuickComposerProps) {
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

  const activeProjectLabel =
    scopeType === "project" && scopeKey
      ? formatProjectName(scopeKey)
      : t("memory.scope.project");

  const placeholder =
    scopeType === "project" && scopeKey
      ? t("memory.composerPlaceholderProject", { project: activeProjectLabel })
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

      <div className="flex h-10 items-center justify-between gap-2 rounded-b-xl bg-card px-3 py-1 border-t border-border/30">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          {/* Tier Switcher */}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            title={t("memory.tier")}
            aria-pressed={isCore}
            onClick={() => setIsCore(!isCore)}
            className={cn(
              "h-7 gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors cursor-pointer",
              isCore
                ? "border-brand-500/35 bg-brand-500/10 text-brand-600 dark:text-brand-400"
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
          </Button>

          {/* Scope Switcher Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={cn(
                    "h-7 gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors cursor-pointer",
                    scopeType === "project"
                      ? "border-brand-500/35 bg-brand-500/10 text-brand-600 dark:text-brand-400"
                      : "border-border/60 bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                />
              }
            >
              {scopeType === "project" ? (
                <FolderIcon className="size-3.5 text-brand-500" />
              ) : (
                <GlobeIcon className="size-3.5" />
              )}
              <span className="truncate max-w-[140px]">
                {scopeType === "project"
                  ? activeProjectLabel
                  : t("memory.scope.global")}
              </span>
              <ChevronDownIcon className="size-3 opacity-60 ml-0.5" />
            </DropdownMenuTrigger>

            <DropdownMenuContent align="start" className="min-w-52">
              <DropdownMenuItem
                onClick={() => {
                  setScopeType("global");
                  setScopeKey("");
                }}
              >
                <GlobeIcon className="size-4" />
                <span className="flex-1">{t("memory.scope.global")}</span>
                {scopeType === "global" && (
                  <CheckIcon className="size-4 text-brand-500" />
                )}
              </DropdownMenuItem>

              {projects && projects.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[11px] text-muted-foreground px-2 py-1">
                    选择已有项目
                  </DropdownMenuLabel>
                  {projects.slice(0, 10).map((p) => (
                    <DropdownMenuItem
                      key={p.key}
                      onClick={() => {
                        setScopeType("project");
                        setScopeKey(p.key);
                      }}
                    >
                      <FolderIcon className="size-4 text-brand-500 shrink-0" />
                      <span className="flex-1 truncate">{p.displayName}</span>
                      <span className="text-[11px] text-muted-foreground tabular-nums opacity-60 mr-1">
                        {p.count}
                      </span>
                      {scopeType === "project" && scopeKey === p.key && (
                        <CheckIcon className="size-4 text-brand-500 shrink-0" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </>
              )}

              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  const custom = window.prompt(
                    "输入项目名称或绝对路径（例如 FlareMo 或 /Users/...）：",
                    scopeKey,
                  );
                  if (custom?.trim()) {
                    setScopeType("project");
                    setScopeKey(custom.trim());
                  }
                }}
              >
                <PlusIcon className="size-4" />
                <span>输入自定义项目…</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Send Button */}
        <Button
          type="submit"
          size="icon-sm"
          variant="brand"
          className="size-7.5 rounded-full shrink-0"
          disabled={!content.trim() || createMutation.isPending}
          aria-label={t("composer.send")}
        >
          {createMutation.isPending ? (
            <Loader2Icon className="size-3.5 motion-safe:animate-spin" />
          ) : (
            <SendIcon className="size-3.5 motion-safe:animate-scale-in" />
          )}
        </Button>
      </div>
    </form>
  );
}
