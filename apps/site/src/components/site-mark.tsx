type BrandMarkProps = {
  className?: string;
  /** When true, shows the wordmark next to the icon. */
  withWordmark?: boolean;
  /** Icon size in Tailwind classes. Defaults to size-7. */
  iconSize?: string;
  /** Override the icon source (dark variant). */
  iconSrc?: string;
  iconAlt?: string;
};

export function SiteMark({
  className,
  withWordmark = true,
  iconSize = "size-7",
  iconSrc = "/brand/flaremo-mark-light-300.png",
  iconAlt = "FlareMo",
}: BrandMarkProps) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <img alt={iconAlt} className={`${iconSize} shrink-0`} src={iconSrc} />
      {withWordmark ? (
        <span className="font-heading text-base font-semibold tracking-tight">
          FlareMo
        </span>
      ) : null}
    </span>
  );
}
