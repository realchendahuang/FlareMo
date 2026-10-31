import {
  ArchiveIcon,
  CheckIcon,
  ChevronDownIcon,
  LayersIcon,
  LockIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";
import type { MemoSpace } from "@/api";
import type { ExplorerView } from "@/components/flaremo-explorer";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

/**
 * flomo's "全部笔记 ▾": the note scope (and the low-frequency archive/trash
 * views) live in one dropdown at the top of the timeline, so the sidebar
 * carries navigation and tags only.
 */
export function ScopeSwitcher({
  activeSpace,
  activeView,
  team,
  onSpaceChange,
  onViewChange,
}: {
  activeSpace: MemoSpace;
  activeView: ExplorerView;
  team: { id: string; name: string } | null;
  onSpaceChange: (space: MemoSpace) => void;
  onViewChange: (view: ExplorerView) => void;
}) {
  const { t } = useI18n();
  // Without a shared team there is only one space, so "personal" would just
  // repeat "all": the menu shrinks to all / archive / trash.
  const spaceItems = [
    {
      icon: LayersIcon,
      label: t("space.all"),
      value: "all" as const,
    },
    ...(team
      ? [
          {
            icon: LockIcon,
            label: t("space.personal"),
            value: "personal" as const,
          },
          { icon: UsersIcon, label: t("space.team"), value: "team" as const },
        ]
      : []),
  ];
  const activeSpaceItem = spaceItems.find((item) => item.value === activeSpace);
  const viewSuffix =
    activeView === "archived"
      ? t("view.archive")
      : activeView === "trashed"
        ? t("view.trash")
        : null;

  const pickSpace = (space: MemoSpace) => {
    onSpaceChange(space);
    // Archives belong to a scope; switching scope returns to the timeline.
    if (activeView !== "all") onViewChange("all");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={t("scope.label")}
            className="h-9 max-w-56 gap-1 px-2 text-sm"
            variant="ghost"
          />
        }
      >
        <span className="truncate font-semibold">
          {activeSpaceItem ? activeSpaceItem.label : t("space.all")}
        </span>
        {viewSuffix && (
          <span className="text-muted-foreground font-normal">
            · {viewSuffix}
          </span>
        )}
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuGroup>
          {spaceItems.map((item) => (
            <DropdownMenuItem
              key={item.value}
              onClick={() => {
                if (activeSpace === item.value) onViewChange("all");
                else pickSpace(item.value);
              }}
            >
              <item.icon />
              {item.label}
              {activeSpace === item.value && activeView === "all" && (
                <CheckIcon className="ml-auto" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {(
            [
              ["archived", ArchiveIcon, t("view.archive")],
              ["trashed", Trash2Icon, t("view.trash")],
            ] as const
          ).map(([view, Icon, label]) => (
            <DropdownMenuItem key={view} onClick={() => onViewChange(view)}>
              <Icon />
              {label}
              {activeView === view && <CheckIcon className={cn("ml-auto")} />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
