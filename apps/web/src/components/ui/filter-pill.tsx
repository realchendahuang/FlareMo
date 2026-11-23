import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type FilterPillProps = {
  active: boolean;
  label: ReactNode;
  count?: number | string;
  icon?: ReactNode;
  highlight?: boolean;
  onClick: () => void;
  className?: string;
  /** Sub pills have a subtle border in inactive state to differentiate secondary hierarchy while maintaining exact height/radius */
  variant?: "primary" | "sub";
};

/**
 * Unified pill button for filtering lists and switching category/project views.
 * Ensures consistent h-7 height, rounded-full radius, typography, and vertical alignment across all screens.
 */
export function FilterPill({
  active,
  label,
  count,
  icon,
  highlight,
  onClick,
  className,
  variant = "primary",
}: FilterPillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/25",
        active
          ? "border-foreground bg-foreground text-background"
          : variant === "sub"
            ? "border-dashed border-border bg-transparent text-muted-foreground hover:border-input hover:text-foreground"
            : "border-border bg-card text-muted-foreground hover:border-input hover:text-foreground",
        highlight && !active && "text-primary",
        className,
      )}
    >
      {icon}
      <span className="truncate max-w-[160px]">{label}</span>
      {count !== undefined && (
        <span
          className={cn(
            "text-[11px] tabular-nums",
            active ? "opacity-90" : "opacity-60",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
