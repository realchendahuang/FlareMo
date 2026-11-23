import * as React from "react"

import { ChevronDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Native select styled to match the input token set. A styled native control
 * keeps keyboard/ARIA behaviour for free and avoids pulling a listbox
 * primitive into the bundle for what are almost always short option lists.
 */
function Select({
  className,
  children,
  ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative w-full" data-slot="select">
      <select
        className={cn(
          "h-8 w-full min-w-0 cursor-pointer appearance-none rounded-lg border border-input bg-card py-1 shadow-xs hover:border-[color-mix(in_oklch,var(--input),var(--foreground)_12%)] pr-8 pl-2.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/20 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
          className
        )
        }
        data-slot="select"
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 end-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  )
}

export { Select }
