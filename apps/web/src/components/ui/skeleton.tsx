import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "animate-shimmer rounded-md bg-[linear-gradient(110deg,var(--muted)_35%,color-mix(in_oklab,var(--muted-foreground)_10%,var(--muted))_50%,var(--muted)_65%)] bg-[length:200%_100%]",
        className,
      )}
      {...props}
    />
  )
}

export { Skeleton }
