import {
  CheckIcon,
  ChevronDownIcon,
  LayersIcon,
  LockIcon,
  UsersIcon,
} from "lucide-react";
import type { MemoSpace } from "@/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n";

/**
 * The timeline's space filter. The sidebar says where you are (memos,
 * archive, trash); this narrows whose notes that page shows. Without a shared
 * team there is only one space, so there is nothing to filter and it renders
 * nothing.
 */
export function ScopeSwitcher({
  activeSpace,
  team,
  onSpaceChange,
}: {
  activeSpace: MemoSpace;
  team: { id: string; name: string } | null;
  onSpaceChange: (space: MemoSpace) => void;
}) {
  const { t } = useI18n();
  if (!team) return null;

  const spaceItems = [
    { icon: LayersIcon, label: t("space.all"), value: "all" as const },
    { icon: LockIcon, label: t("space.personal"), value: "personal" as const },
    { icon: UsersIcon, label: t("space.team"), value: "team" as const },
  ];
  const activeItem =
    spaceItems.find((item) => item.value === activeSpace) ?? spaceItems[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={t("scope.label")}
            className="max-w-44 gap-1 text-muted-foreground hover:text-foreground data-[popup-open]:text-foreground"
            size="sm"
            variant="ghost"
          />
        }
      >
        <activeItem.icon data-icon="inline-start" />
        <span className="truncate">{activeItem.label}</span>
        <ChevronDownIcon className="size-3.5 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuGroup>
          {spaceItems.map((item) => (
            <DropdownMenuItem
              key={item.value}
              onClick={() => onSpaceChange(item.value)}
            >
              <item.icon />
              {item.label}
              {activeSpace === item.value && <CheckIcon className="ml-auto" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
