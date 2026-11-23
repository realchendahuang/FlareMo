import type { ComponentProps, ReactElement, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * One composer tool: a quiet 28px ghost button whose icon sits in muted ink
 * and darkens on hover. The label is both the accessible name and a delayed
 * tooltip; when the action has a key binding the tooltip shows it too, so the
 * buttons teach the keyboard.
 */
export function ToolButton({
  label,
  shortcut,
  active,
  render,
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "render"> & {
  label: string;
  shortcut?: string;
  active?: boolean;
  render?: ReactElement;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        delay={450}
        render={
          <Button
            aria-keyshortcuts={shortcut}
            aria-label={label}
            aria-pressed={active}
            className={cn(
              "text-muted-foreground hover:text-foreground aria-pressed:bg-accent aria-pressed:text-primary",
              className,
            )}
            render={render}
            size="icon-sm"
            type={render ? undefined : "button"}
            variant="ghost"
            {...props}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut && (
          <span className="ms-2 font-mono opacity-60">{shortcut}</span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

export function ToolDivider({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("mx-1 h-4 w-px shrink-0 bg-border", className)}
    />
  );
}
