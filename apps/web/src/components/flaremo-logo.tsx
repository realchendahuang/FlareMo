import { useBranding } from "@/branding";
import { cn } from "@/lib/utils";

type FlareMoLogoProps = {
  className?: string;
  labelClassName?: string;
  markClassName?: string;
};

/**
 * Instance logo + product name. Custom branding (set by the owner in the
 * admin panel) overrides the bundled FlareMo mark and label; an unset
 * branding falls back to the bundled assets so a fresh install looks
 * unchanged.
 */
export function FlareMoLogo({
  className,
  labelClassName,
  markClassName,
}: FlareMoLogoProps) {
  const { product, markLightUrl, markDarkUrl } = useBranding();
  const hover =
    "motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-spring motion-safe:group-hover/logo:rotate-[10deg]";
  return (
    <div
      className={cn("group/logo flex min-w-0 items-center gap-2", className)}
    >
      <img
        alt=""
        aria-hidden="true"
        className={cn("size-7 shrink-0 dark:hidden", hover, markClassName)}
        src={markLightUrl ?? "/brand/flaremo-mark-light-300.png"}
      />
      <img
        alt=""
        aria-hidden="true"
        className={cn(
          "hidden size-7 shrink-0 dark:block",
          hover,
          markClassName,
        )}
        src={markDarkUrl ?? markLightUrl ?? "/brand/flaremo-mark-dark-320.png"}
      />
      <span
        className={cn(
          "truncate font-heading text-sm font-semibold tracking-tight",
          labelClassName,
        )}
      >
        {product}
      </span>
    </div>
  );
}
