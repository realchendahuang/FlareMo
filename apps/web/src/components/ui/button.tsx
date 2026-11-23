import * as React from "react"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/*
 * Ember 2 button.
 *
 * One radius per size (rounded-lg = 10px; xs/sm step down with height), one
 * focus ring (3px ring at 25% + ring-colored border) and one disabled state
 * for every variant. `brand` is the primary CTA: solid ember with a hairline
 * top highlight. The logo gradient survives only as `gradient`, reserved for
 * the composer's send action.
 */
const buttonVariants = cva(
  "group/button relative inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,filter] duration-150 outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-45 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-foreground text-background shadow-xs hover:bg-foreground/88 dark:hover:bg-foreground/90",
        brand:
          "bg-primary text-primary-foreground shadow-[inset_0_1px_0_oklch(1_0_0/0.18),var(--shadow-xs)] hover:bg-[color-mix(in_oklch,var(--primary),black_7%)] dark:hover:bg-[color-mix(in_oklch,var(--primary),white_8%)]",
        gradient:
          "bg-brand-gradient text-[color:var(--brand-gradient-foreground)] shadow-[inset_0_1px_0_oklch(1_0_0/0.22),var(--shadow-sm)] hover:brightness-[1.05] active:brightness-95",
        outline:
          "border-input bg-card text-foreground shadow-xs hover:border-[color-mix(in_oklch,var(--input),var(--foreground)_12%)] hover:bg-muted/60 aria-expanded:bg-muted dark:bg-input/20 dark:hover:bg-input/40",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_6%)] aria-expanded:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_6%)]",
        ghost:
          "text-foreground/80 hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/60",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/16 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/18 dark:hover:bg-destructive/26 dark:focus-visible:ring-destructive/40",
        link: "h-auto! px-0! text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pe-2.5 has-data-[icon=inline-start]:ps-2.5",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-md px-2.5 text-[13px] has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-2 px-4 text-sm has-data-[icon=inline-end]:pe-3.5 has-data-[icon=inline-start]:ps-3.5",
        icon: "size-8",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-7 rounded-md",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  render,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    /** Replaces the default `<button>` element (e.g. `render={<a … />}`). */
    render?: React.ReactElement
  }) {
  return useRender({
    render,
    defaultTagName: "button",
    props: {
      "data-slot": "button",
      "data-variant": variant,
      "data-size": size,
      className: cn(buttonVariants({ variant, size, className })),
      ...props,
    },
  })
}

export { Button, buttonVariants }
