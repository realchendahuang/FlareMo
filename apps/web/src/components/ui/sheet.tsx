import * as React from "react"
import { useDirection } from "@base-ui/react/direction-provider"
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/i18n"
import { XIcon } from "lucide-react"

export type SheetSide = "top" | "right" | "bottom" | "left" | "start" | "end"

/** Resolve logical sides for the CSS animation, which is physical. */
export function resolveSheetSide(
  side: SheetSide,
  direction: "ltr" | "rtl",
): Exclude<SheetSide, "start" | "end"> {
  if (side === "start") return direction === "rtl" ? "right" : "left"
  if (side === "end") return direction === "rtl" ? "left" : "right"
  return side
}

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Backdrop>) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-[oklch(0.22_0.012_60/0.22)] dark:bg-black/55 motion-safe:duration-250 ease-signal supports-backdrop-filter:backdrop-blur-xs motion-safe:data-open:animate-in motion-safe:data-open:fade-in-0 motion-safe:data-closed:animate-out motion-safe:data-closed:fade-out-0 motion-safe:data-closed:fill-mode-forwards",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Popup> & {
  /** Physical sides stay physical; start/end mirror with the DirectionProvider. */
  side?: SheetSide
  showCloseButton?: boolean
}) {
  const { t } = useI18n()
  const direction = useDirection()
  const resolvedSide = resolveSheetSide(side, direction)
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={resolvedSide}
        className={cn(
          "glass fixed z-50 flex flex-col gap-4 bg-popover bg-clip-padding text-sm text-popover-foreground shadow-lg motion-safe:transition motion-safe:duration-250 ease-signal data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm motion-safe:data-open:animate-in motion-safe:data-open:fade-in-0 motion-safe:data-[side=bottom]:data-open:slide-in-from-bottom-full motion-safe:data-[side=left]:data-open:slide-in-from-left-full motion-safe:data-[side=right]:data-open:slide-in-from-right-full motion-safe:data-[side=top]:data-open:slide-in-from-top-full motion-safe:data-closed:animate-out motion-safe:data-closed:fade-out-0 motion-safe:data-closed:fill-mode-forwards motion-safe:data-[side=bottom]:data-closed:slide-out-to-bottom-full motion-safe:data-[side=left]:data-closed:slide-out-to-left-full motion-safe:data-[side=right]:data-closed:slide-out-to-right-full motion-safe:data-[side=top]:data-closed:slide-out-to-top-full",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            render={
              <Button
                variant="ghost"
                // z-20: sticky panel headers inside the sheet would paint over it.
                className="absolute top-3 end-3 z-20 text-muted-foreground hover:text-foreground"
                size="icon-sm"
              >
                <XIcon />
                <span className="sr-only">{t("common.close")}</span>
              </Button>
            }
          />
        )}
      </SheetPrimitive.Popup>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-0.5 p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "font-heading text-base font-medium text-foreground",
        className
      )}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
