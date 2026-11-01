import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import {
  getReviewSettings,
  getTagHierarchy,
  type ReviewSettingsResponse,
  type TagHierarchyNode,
  updateReviewSettings,
} from "@/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import { errorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

/** Node names are already full paths (`写作/方法`). */
function flattenTags(nodes: TagHierarchyNode[]): string[] {
  return nodes.flatMap((node) => [node.name, ...flattenTags(node.children)]);
}

/**
 * What the daily review leaves out: whole tags (a diary, a to-do inbox) and
 * single notes muted from the review card. Every toggle saves at once; the
 * stack is rebuilt on close.
 */
export function ReviewSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: queryKeys.review.settings,
    queryFn: getReviewSettings,
    enabled: open,
    retry: false,
  });
  const tagsQuery = useQuery({
    queryKey: queryKeys.tagHierarchy.forSpace(undefined),
    queryFn: () => getTagHierarchy(undefined),
    enabled: open,
    staleTime: 30_000,
    retry: false,
  });
  const excluded = settingsQuery.data?.excluded_tags ?? [];
  const tags = useMemo(() => {
    const all = flattenTags(tagsQuery.data?.tags ?? []);
    // An excluded tag that no longer exists still shows, so it can be removed.
    return [...new Set([...excluded, ...all])];
  }, [tagsQuery.data, excluded]);

  const mutation = useMutation({
    mutationFn: updateReviewSettings,
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.review.settings });
      const previous = queryClient.getQueryData<ReviewSettingsResponse>(
        queryKeys.review.settings,
      );
      if (previous) {
        queryClient.setQueryData<ReviewSettingsResponse>(
          queryKeys.review.settings,
          {
            excluded_tags: input.excludedTags ?? previous.excluded_tags,
            muted_count: input.restoreMuted ? 0 : previous.muted_count,
          },
        );
      }
      return { previous };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.review.settings, data);
    },
    onError: (error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.review.settings, context.previous);
      }
      toast.error(errorMessage(error, t("toast.requestFailed")));
    },
  });

  const toggle = (tag: string) => {
    // Each request sends the whole tag list; a second toggle while the first
    // is in flight would race its snapshot and could restore the wrong set.
    if (mutation.isPending) return;
    const covered = excluded.some(
      (item) => item !== tag && tag.startsWith(`${item}/`),
    );
    if (covered) return;
    mutation.mutate({
      excludedTags: excluded.includes(tag)
        ? excluded.filter((item) => item !== tag)
        : [...excluded, tag],
    });
  };

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.review.all });
    }
  };

  const mutedCount = settingsQuery.data?.muted_count ?? 0;
  const loading = settingsQuery.isLoading || tagsQuery.isLoading;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("review.settingsTitle")}</DialogTitle>
          <DialogDescription>
            {t("review.settingsDescription")}
          </DialogDescription>
        </DialogHeader>

        <section className="flex flex-col gap-2.5">
          <h3 className="text-xs font-medium text-muted-foreground">
            {t("review.excludedTagsTitle")}
          </h3>
          {loading ? (
            <Skeleton className="h-16 w-full" />
          ) : tags.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("review.excludedTagsEmpty")}
            </p>
          ) : (
            <div className="-m-1 flex max-h-52 flex-wrap gap-1.5 overflow-y-auto p-1">
              {tags.map((tag) => {
                const active = excluded.includes(tag);
                const covered =
                  !active &&
                  excluded.some((item) => tag.startsWith(`${item}/`));
                return (
                  <button
                    aria-pressed={active || covered}
                    className={cn(
                      "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/25",
                      active
                        ? "border-foreground bg-foreground text-background"
                        : covered
                          ? "cursor-default border-border bg-muted text-muted-foreground line-through decoration-muted-foreground/50"
                          : "border-border bg-card text-muted-foreground hover:border-input hover:text-foreground",
                    )}
                    disabled={covered || mutation.isPending}
                    key={tag}
                    type="button"
                    onClick={() => toggle(tag)}
                  >
                    {active && <CheckIcon className="size-3" />}#{tag}
                  </button>
                );
              })}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {t("review.excludedTagsHint")}
          </p>
        </section>

        <section className="flex items-center justify-between gap-3 border-t border-border/60 pt-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-sm">{t("review.mutedTitle")}</p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {loading
                ? "\u00a0"
                : mutedCount > 0
                  ? t("review.mutedCount", { count: mutedCount })
                  : t("review.mutedNone")}
            </p>
          </div>
          <Button
            disabled={loading || mutedCount === 0 || mutation.isPending}
            size="sm"
            variant="outline"
            onClick={() => mutation.mutate({ restoreMuted: true })}
          >
            {t("review.mutedRestore")}
          </Button>
        </section>
      </DialogContent>
    </Dialog>
  );
}
