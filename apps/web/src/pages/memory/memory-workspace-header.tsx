import { BrainIcon, EyeIcon, SearchIcon, XIcon } from "lucide-react";
import { HEADER_SEARCH_FIELD_CLASS } from "@/components/search-field-styles";
import { Button } from "@/components/ui/button";
import { WorkspacePageHeader } from "@/components/workspace/workspace-page-header";
import type { WorkspaceSidebarContent } from "@/components/workspace/workspace-sidebar";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

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
      icon={<BrainIcon className="size-4 shrink-0" />}
      title={t("memory.title")}
      actions={
        <>
          <div
            className={cn(
              HEADER_SEARCH_FIELD_CLASS,
              "w-36 gap-2 px-2.5 sm:w-52 md:w-60",
            )}
          >
            <SearchIcon className="size-3.5 shrink-0 text-muted-foreground transition-colors group-focus-within:text-foreground" />
            <input
              type="text"
              aria-label={t("memory.searchPlaceholder")}
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder={t("memory.searchPlaceholder")}
              className="w-full min-w-0 bg-transparent text-xs text-foreground outline-hidden placeholder:text-muted-foreground"
            />
            {query && (
              <Button
                type="button"
                aria-label={t("search.clear")}
                onClick={() => onQueryChange("")}
                className="-me-1.5 size-6 text-muted-foreground"
                size="icon-xs"
                title={t("search.clear")}
                variant="ghost"
              >
                <XIcon className="size-3.5" />
              </Button>
            )}
          </div>

          {/* Named, not a bare eye: what the agents actually receive. */}
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
            onClick={onOpenLens}
            title={t("memory.lensTitle")}
          >
            <EyeIcon data-icon="inline-start" />
            {t("memory.viewLens")}
          </Button>
        </>
      }
    />
  );
}
