import { Link } from "@tanstack/react-router";
import { useI18n } from "@/i18n";

const TAB_CLASS =
  "flex h-7 items-center rounded-md px-2.5 text-[13px] font-medium text-muted-foreground outline-none transition-[color,background-color,box-shadow] hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/25";
const TAB_ACTIVE_CLASS =
  "!bg-card !text-foreground shadow-xs dark:!bg-input/40";

/**
 * The two ways of looking back — this day in past years, and a random walk —
 * share one sidebar entry ("Review"); this switch in the page header moves
 * between them. Same segmented look as the sidebar's year/month/week/day.
 */
export function ReviewTabs() {
  const { t } = useI18n();
  return (
    <nav
      aria-label={t("nav.review")}
      className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5 dark:bg-muted/60"
    >
      <Link
        activeProps={{ className: TAB_ACTIVE_CLASS, "aria-current": "page" }}
        className={TAB_CLASS}
        to="/review/daily"
      >
        {t("nav.dailyReview")}
      </Link>
      <Link
        activeProps={{ className: TAB_ACTIVE_CLASS, "aria-current": "page" }}
        className={TAB_CLASS}
        to="/review/walk"
      >
        {t("nav.randomWalk")}
      </Link>
    </nav>
  );
}
