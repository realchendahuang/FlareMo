import { ChevronRightIcon, type LucideIcon } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SettingsIconBadge({
  icon: Icon,
  className,
  color = "bg-muted text-muted-foreground",
}: {
  icon: LucideIcon;
  className?: string;
  color?: string;
}) {
  return (
    <div
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/40 transition-colors",
        color,
        className,
      )}
    >
      <Icon className="size-4" />
    </div>
  );
}

export function SettingsSectionGroup({
  title,
  footer,
  children,
  className,
}: {
  title?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {title && (
        <div className="px-3 text-xs font-medium text-muted-foreground">
          {title}
        </div>
      )}
      <div className="paper overflow-hidden rounded-xl border border-border/60 bg-card divide-y divide-border/40 shadow-xs">
        {children}
      </div>
      {footer && (
        <div className="px-3 text-xs text-muted-foreground leading-relaxed">
          {footer}
        </div>
      )}
    </div>
  );
}

export type SettingsRowProps = ComponentPropsWithoutRef<"div"> & {
  icon?: LucideIcon;
  iconColor?: string;
  label: ReactNode;
  description?: ReactNode;
  value?: ReactNode;
  action?: ReactNode;
  chevron?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  onClick?: () => void;
};

export function SettingsRow({
  icon: Icon,
  iconColor = "bg-muted text-muted-foreground",
  label,
  description,
  value,
  action,
  chevron,
  destructive,
  disabled,
  onClick,
  className,
  ...props
}: SettingsRowProps) {
  const content = (
    <>
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <SettingsIconBadge
            icon={Icon}
            color={
              destructive
                ? "border-destructive/20 bg-destructive/10 text-destructive"
                : iconColor
            }
          />
        )}
        <div className="min-w-0">
          <div
            className={cn(
              "text-sm font-medium leading-tight truncate",
              destructive ? "text-destructive" : "text-foreground",
            )}
          >
            {label}
          </div>
          {description && (
            <div className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
              {description}
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {value && (
          <span className="text-xs sm:text-sm text-muted-foreground truncate max-w-[140px] sm:max-w-[200px]">
            {value}
          </span>
        )}
        {action}
        {chevron && (
          <ChevronRightIcon className="size-4 text-muted-foreground/50 shrink-0" />
        )}
      </div>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "flex min-h-[46px] w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition-colors cursor-pointer hover:bg-accent/40 active:bg-accent/60",
          disabled && "opacity-60 pointer-events-none",
          destructive && "text-destructive",
          className,
        )}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-[46px] items-center justify-between gap-3 px-3.5 py-2.5 transition-colors",
        disabled && "opacity-60 pointer-events-none",
        destructive && "text-destructive",
        className,
      )}
      {...props}
    >
      {content}
    </div>
  );
}
