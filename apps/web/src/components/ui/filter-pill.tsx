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
        "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-all shrink-0 cursor-pointer select-none",
        active
          ? "bg-primary text-primary-foreground shadow-xs"
          : variant === "sub"
            ? "border border-border/50 bg-muted/30 text-muted-foreground hover:bg-muted hover:text-foreground"
            : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
        highlight && !active && "text-brand-500 font-semibold",
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
