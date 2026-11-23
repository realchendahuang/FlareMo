import { Loader2Icon } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * The one loading indicator. Decorative by default (the surrounding button or
 * status text already says what is happening); pass `aria-label` when the
 * spinner is the only signal and it becomes a `role="status"` region.
 * Respects reduced motion: the icon stays still instead of spinning.
 */
export function Spinner({
  className,
  "aria-label": ariaLabel,
  ...props
}: ComponentProps<"svg">) {
  return (
    <Loader2Icon
      {...(ariaLabel
        ? { role: "status", "aria-label": ariaLabel }
        : { "aria-hidden": true })}
      className={cn("size-4 motion-safe:animate-spin", className)}
      data-slot="spinner"
      {...props}
    />
  );
}
