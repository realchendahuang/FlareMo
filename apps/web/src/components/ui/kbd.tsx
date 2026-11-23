import type * as React from "react";

import { cn } from "@/lib/utils";

/*
 * Keyboard hint. One look for every shortcut in the product: a small key
 * cap on the card surface with a hairline and a 1px bottom lip, figures in
 * the UI face (Geist renders ⌘ ↵ ↑↓ crisply; a monospace stack falls back
 * to whatever the platform has and drifts per OS). 10–11px is allowed here
 * because a key cap carries symbols, never translated words.
 */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-[18px] min-w-[18px] shrink-0 select-none items-center justify-center gap-0.5 rounded-[5px] border border-border bg-card px-1 font-sans text-[11px] leading-none font-medium text-muted-foreground tabular-nums shadow-[inset_0_-1px_0_var(--border)] dark:bg-muted",
        className,
      )}
      {...props}
    />
  );
}

export { Kbd };
