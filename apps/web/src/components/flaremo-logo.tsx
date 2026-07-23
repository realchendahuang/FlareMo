import { cn } from "@/lib/utils";

type FlareMoLogoProps = {
  className?: string;
  labelClassName?: string;
  markClassName?: string;
};

export function FlareMoLogo({
  className,
  labelClassName,
  markClassName,
}: FlareMoLogoProps) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <img
        alt=""
        aria-hidden="true"
        className={cn("size-7 shrink-0 dark:hidden", markClassName)}
        src="/brand/flaremo-mark-light-300.png"
      />
      <img
        alt=""
        aria-hidden="true"
        className={cn("hidden size-7 shrink-0 dark:block", markClassName)}
        src="/brand/flaremo-mark-dark-320.png"
      />
      <span
        className={cn(
          "truncate font-heading text-sm font-semibold tracking-tight",
          labelClassName,
        )}
      >
        FlareMo
      </span>
    </div>
  );
}
