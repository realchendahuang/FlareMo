import { Link } from "@tanstack/react-router";
import {
  SEGMENT_TRACK_CLASS,
  SEGMENT_ACTIVE_CLASS as TAB_ACTIVE_CLASS,
  SEGMENT_CLASS as TAB_CLASS,
} from "@/components/nav-item-styles";
import { useI18n } from "@/i18n";

/**
 * The two ways of looking back — this day in past years, and a random walk —
 * share one sidebar entry ("Review"); this switch in the page header moves
 * between them. Same segmented look as the sidebar's year/month/week/day.
 */
export function ReviewTabs() {
  const { t } = useI18n();
  return (
    <nav aria-label={t("nav.review")} className={SEGMENT_TRACK_CLASS}>
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
