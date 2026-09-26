import { BrainIcon, EyeIcon, SearchIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkspacePageHeader } from "@/components/workspace/workspace-page-header";
import type { WorkspaceSidebarContent } from "@/components/workspace/workspace-sidebar";
import { useI18n } from "@/i18n";

export function MemoryWorkspaceHeader({
  query,
  onQueryChange,
  onOpenLens,
  ...header
}: {
  explorer: WorkspaceSidebarContent;
  mobileSheetOpen: boolean;
  setMobileSheetOpen: (open: boolean) => void;
  sidebarCollapsed: boolean;
  toggleSidebarCollapsed: () => void;
  query: string;
  onQueryChange: (q: string) => void;
  onOpenLens: () => void;
  isScrolled?: boolean;
}) {
  const { t } = useI18n();

  return (
    <WorkspacePageHeader
      {...header}
      icon={<BrainIcon className="size-4 shrink-0 text-brand-500" />}
      title={t("memory.title")}
      actions={
        <>
          <div className="group flex h-8.5 w-36 sm:w-52 md:w-60 items-center rounded-lg border border-border/60 bg-muted/40 px-2.5 text-xs text-muted-foreground transition-all hover:border-border hover:bg-accent/60 hover:text-foreground shadow-2xs focus-within:border-brand-500/80 focus-within:ring-2 focus-within:ring-brand-500/15 focus-within:bg-background">
            <SearchIcon className="size-3.5 shrink-0 text-muted-foreground group-focus-within:text-foreground" />
            <input
              type="text"
              aria-label={t("memory.searchPlaceholder")}
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder={t("memory.searchPlaceholder")}
              className="ml-2 w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-hidden"
            />
            {query && (
              <button
                type="button"
                aria-label={t("search.clear")}
                onClick={() => onQueryChange("")}
                className="ml-1 rounded p-0.5 hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                title={t("search.clear")}
              >
                <XIcon className="size-3" />
              </button>
            )}
          </div>

          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("memory.viewLens")}
            className="text-muted-foreground hover:text-foreground"
            onClick={onOpenLens}
            title={t("memory.viewLens")}
          >
            <EyeIcon className="size-4" />
          </Button>
        </>
      }
    />
  );
}
