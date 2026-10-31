import { useQuery } from "@tanstack/react-query";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { compileMemory } from "@/api";
import { QueryErrorState } from "@/components/query-error-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import type { ProjectCount } from "./memory-filters";

/**
 * The 随身小抄: exactly what an agent receives when it asks for this
 * context, rendered by the same compiler as MCP `memory_compile`. Picking a
 * project adds that project's memories on top of the global ones.
 */
export function MemoryLensDialog({
  open,
  onOpenChange,
  projects,
  defaultProject,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectCount[];
  defaultProject?: string | null;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [project, setProject] = useState(defaultProject ?? "");

  useEffect(() => {
    if (open) setProject(defaultProject ?? "");
  }, [open, defaultProject]);

  const compileQuery = useQuery({
    queryKey: ["memories", "compile", project],
    queryFn: () => compileMemory({ project_key: project || undefined }),
    enabled: open,
    staleTime: 5_000,
  });

  const compiled = compileQuery.data?.compiled;
  const included = compiled?.included_items.length ?? 0;
  const truncated = compiled?.truncated_items ?? [];
  const payload = included > 0 ? (compiled?.system_prompt_payload ?? "") : "";

  const handleCopy = async () => {
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      toast.success(t("toast.copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("toast.copyFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("memory.lensTitle")}</DialogTitle>
          <DialogDescription>{t("memory.lensDescription")}</DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-3">
          {projects.length > 0 && (
            <div className="w-full sm:w-64">
              <Select
                aria-label={t("memory.lensContext")}
                value={project}
                onChange={(event) => setProject(event.target.value)}
              >
                <option value="">{t("memory.lensGlobal")}</option>
                {projects.map((p) => (
                  <option key={p.key} value={p.key}>
                    {t("memory.lensInProject", { project: p.displayName })}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {compileQuery.isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : compileQuery.isError ? (
            <QueryErrorState
              className="min-h-40 text-muted-foreground"
              isRetrying={compileQuery.isFetching}
              onRetry={() => void compileQuery.refetch()}
            />
          ) : payload ? (
            <>
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span className="tabular-nums">
                  {t("memory.lensStats", {
                    count: included,
                    tokens: compiled?.estimated_tokens ?? 0,
                  })}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleCopy()}
                >
                  {copied ? (
                    <CheckIcon data-icon="inline-start" />
                  ) : (
                    <CopyIcon data-icon="inline-start" />
                  )}
                  {t("memory.lensCopy")}
                </Button>
              </div>
              <pre className="max-h-[360px] overflow-y-auto rounded-lg border border-border/70 bg-muted/30 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground/90">
                {payload}
              </pre>
              {(truncated.length > 0 || compiled?.pinned_overflow) && (
                <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                  <span>
                    {compiled?.pinned_overflow
                      ? t("memory.lensPinnedOverflow")
                      : t("memory.lensTruncated", { count: truncated.length })}
                  </span>
                  {truncated.slice(0, 3).map((item) => (
                    <span className="truncate ps-3" key={item.id}>
                      · {item.content}
                    </span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-border/70 p-8 text-center text-xs text-muted-foreground">
              {t("memory.lensEmpty")}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
