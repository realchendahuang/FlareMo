import { useMutation } from "@tanstack/react-query";
import { GlobeIcon, PinIcon, SparklesIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  createMemory,
  type Memory,
  pinMemory,
  unpinMemory,
  updateMemory,
} from "@/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n";
import { stripResourceName } from "@/lib/utils";
import { isRule } from "./memory-filters";

export function MemoryFormDialog({
  memory,
  open,
  onOpenChange,
  onSaved,
}: {
  memory?: Memory;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [content, setContent] = useState("");
  const [isCore, setIsCore] = useState(true);
  const [scopeType, setScopeType] = useState<"global" | "project">("global");
  const [scopeKey, setScopeKey] = useState("");

  useEffect(() => {
    if (open) {
      setContent(memory?.content ?? "");
      setIsCore(memory ? isRule(memory) : true);
      setScopeType(memory?.scope_type === "project" ? "project" : "global");
      setScopeKey(memory?.scope_key ?? "");
    }
  }, [open, memory]);

  // A proposal is decided in the inbox, and a retired row is history: only
  // live, decided memories can be pinned from here.
  const canToggleRule =
    !memory ||
    (memory.status === "active" && memory.verification !== "inferred");

  const saveMutation = useMutation({
    mutationFn: async () => {
      const trimmedContent = content.trim();
      const trimmedScopeKey = scopeKey.trim();
      const scope =
        scopeType === "project" && trimmedScopeKey ? "project" : "global";

      if (memory) {
        const id = stripResourceName(memory.id, "memories");
        // 铁律 is the lock, not the tier: the toggle pins or unpins, so the
        // rule the dialog shows is the rule the compiler hands to agents.
        const updated = await updateMemory(id, {
          content: trimmedContent,
          scope_type: scope,
          scope_key: scope === "project" ? trimmedScopeKey : undefined,
        });
        if (canToggleRule && isCore !== isRule(memory)) {
          return isCore ? pinMemory(id) : unpinMemory(id);
        }
        return updated;
      }

      return createMemory({
        content: trimmedContent,
        tier: isCore ? "core" : "normal",
        importance: isCore ? 80 : 50,
        lock: isCore,
        type: "semantic",
        kind: isCore ? "constraint" : "preference",
        scope_type: scope,
        scope_key: scope === "project" ? trimmedScopeKey : undefined,
      });
    },
    onSuccess: () => {
      toast.success(t("common.save"));
      onOpenChange(false);
      onSaved();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : t(memory ? "memory.updateFailed" : "memory.createFailed"),
      );
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {memory ? t("memory.editMemory") : t("memory.newMemory")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-1">
          <Textarea
            rows={4}
            value={content}
            placeholder={t("memory.contentPlaceholder")}
            onChange={(event) => setContent(event.target.value)}
            className="text-sm resize-none focus-visible:ring-1"
          />

          {canToggleRule && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t("memory.tier")}
              </span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setIsCore(true)}
                  className={`flex items-center justify-center gap-1.5 rounded-xl border py-2 px-3 text-xs transition-colors ${
                    isCore
                      ? "border-brand-500/80 bg-brand-500/10 text-brand-600 dark:text-brand-400 font-medium"
                      : "border-border/70 hover:bg-muted/50 text-muted-foreground"
                  }`}
                >
                  <PinIcon className="size-3.5 shrink-0" />
                  <span>{t("memory.filterCore")}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsCore(false)}
                  className={`flex items-center justify-center gap-1.5 rounded-xl border py-2 px-3 text-xs transition-colors ${
                    !isCore
                      ? "border-brand-500/80 bg-brand-500/10 text-brand-600 dark:text-brand-400 font-medium"
                      : "border-border/70 hover:bg-muted/50 text-muted-foreground"
                  }`}
                >
                  <SparklesIcon className="size-3.5 shrink-0" />
                  <span>{t("memory.kind.preference")}</span>
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("memory.scope")}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setScopeType("global")}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium border transition-colors ${
                  scopeType === "global"
                    ? "border-border bg-muted text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-muted/50"
                }`}
              >
                <GlobeIcon className="size-3" />
                <span>{t("memory.scope.global")}</span>
              </button>

              <button
                type="button"
                onClick={() => setScopeType("project")}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium border transition-colors ${
                  scopeType === "project"
                    ? "border-border bg-muted text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-muted/50"
                }`}
              >
                <span>{t("memory.scope.project")}</span>
              </button>
            </div>

            {scopeType === "project" && (
              <Input
                value={scopeKey}
                placeholder={t("memory.scopeKey")}
                onChange={(event) => setScopeKey(event.target.value)}
                className="h-8 text-xs mt-1"
              />
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            disabled={!content.trim() || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
