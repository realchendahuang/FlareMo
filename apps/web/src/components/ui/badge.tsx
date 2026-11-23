import * as React from "react"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        // Tag chips and other quiet brand accents.
        brand:
          "bg-brand-100 text-brand-700 [a]:hover:bg-brand-200 dark:bg-brand-400/12 dark:text-brand-200 dark:[a]:hover:bg-brand-400/20",
        // Tag chip on reading surfaces: neutral, so a page of notes is not
        // dotted with brand color; the leading # carries the meaning.
        tag: "rounded-md bg-muted px-1.5 font-normal text-foreground/75 [a]:hover:text-foreground dark:bg-muted/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        // Status chips (role labels, stale markers). Same tint + ink recipe
        // as the Alert status variants.
        success: "bg-success/12 text-success-emphasis",
        warning: "bg-warning/14 text-warning-emphasis",
        info: "bg-info/12 text-info-emphasis",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    /** Replaces the default `<span>` element. */
    render?: React.ReactElement
  }) {
  return useRender({
    render,
    defaultTagName: "span",
    props: {
      "data-slot": "badge",
      "data-variant": variant,
      className: cn(badgeVariants({ variant }), className),
      ...props,
    },
  })
}

export { Badge, badgeVariants }
