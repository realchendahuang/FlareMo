import { ArchiveIcon, HashIcon, InboxIcon, Trash2Icon } from "lucide-react";
import type { ReactNode } from "react";
import type { MemoStatsResponse } from "@/api";
import { FlareMoLogo } from "@/components/flaremo-logo";
import { useI18n } from "@/i18n";
import { buildMonthLabels } from "@/lib/activity";
import { cn } from "@/lib/utils";

export type ExplorerView = "all" | "archived" | "trashed";

type FlareMoExplorerProps = {
  activeTag?: string;
  activeView: ExplorerView;
  footer?: ReactNode;
  headerAction?: ReactNode;
  stats: MemoStatsResponse;
  onTagChange: (tag?: string) => void;
  onViewChange: (view: ExplorerView) => void;
};

export function FlareMoExplorer({
  activeTag,
  activeView,
  footer,
  headerAction,
  stats,
  onTagChange,
  onViewChange,
}: FlareMoExplorerProps) {
  const { locale, t } = useI18n();
  const navItems = [
    {
      count: stats.counts.normal,
      icon: InboxIcon,
      label: t("view.timeline"),
      view: "all" as const,
    },
    {
      count: stats.counts.archived,
      icon: ArchiveIcon,
      label: t("view.archive"),
      view: "archived" as const,
    },
    {
      count: stats.counts.trashed,
      icon: Trash2Icon,
      label: t("view.trash"),
      view: "trashed" as const,
    },
  ];
  const activityTotal = stats.activity.reduce(
    (total, day) => total + day.count,
    0,
  );
  const monthLabels = buildMonthLabels(stats.activity, locale);

  return (
    <aside className="flex min-h-full flex-col px-3 py-4 text-sm">
      <header className="mb-5 flex items-center justify-between gap-2 px-1">
        <FlareMoLogo />
        {headerAction}
      </header>

      <section className="mb-4 grid grid-cols-3 gap-2 px-1 motion-safe:animate-rise">
        <StatCell label={t("explorer.records")} value={stats.counts.total} />
        <StatCell label={t("explorer.tags")} value={stats.tags.length} />
        <StatCell label={t("explorer.days")} value={stats.active_days} />
      </section>

      <section className="mb-5 px-1">
        <div
          aria-label={t("explorer.heatmapSummary", {
            count: activityTotal,
            days: stats.activity.length,
          })}
          className="grid grid-flow-col grid-rows-7 gap-1"
          data-testid="activity-heatmap"
          role="img"
        >
          {stats.activity.map((day, index) => (
            <div
              aria-hidden="true"
              className={cn(
                "aspect-square rounded-[3px] motion-safe:animate-fade motion-safe:transition-[opacity,transform] motion-safe:duration-150 hover:opacity-85 motion-safe:hover:scale-110",
                heatmapColor(day.count),
              )}
              key={day.date}
              style={{ animationDelay: `${index * 4}ms` }}
              title={t("explorer.heatmapDay", {
                count: day.count,
                date: day.date,
              })}
            />
          ))}
        </div>
        <div
          aria-hidden="true"
          className="mt-2 grid grid-cols-12 gap-1 px-1 text-xs text-muted-foreground"
        >
          {monthLabels.map((month) => (
            <span className="whitespace-nowrap" key={month.date}>
              {month.label}
            </span>
          ))}
        </div>
      </section>

      <nav aria-label={t("sidebar.navigation")} className="flex flex-col gap-1">
        {navItems.map((item) => (
          <button
            aria-current={activeView === item.view ? "page" : undefined}
            className={cn(
              "relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-left motion-safe:transition-[background-color,color,transform] motion-safe:duration-150",
              activeView === item.view
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground motion-safe:hover:translate-x-0.5",
            )}
            key={item.view}
            type="button"
            onClick={() => onViewChange(item.view)}
          >
            {activeView === item.view && (
              <span
                aria-hidden="true"
                className="bg-brand-gradient absolute top-2 bottom-2 left-0 w-[3px] rounded-full"
              />
            )}
            <item.icon />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            <span className="text-xs tabular-nums opacity-60">
              {item.count}
            </span>
          </button>
        ))}
      </nav>

      <section className="mt-5 flex flex-col gap-2 px-1">
        <div className="text-xs text-muted-foreground">
          {t("explorer.tags")}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {stats.tags.length > 0 ? (
            stats.tags.map((tag) => {
              const active = activeTag === tag.name;
              return (
                <button
                  className={cn(
                    "inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-xs motion-safe:transition-[background-color,color,transform] motion-safe:duration-150",
                    active
                      ? "bg-flame-100 font-medium text-flame-700 dark:bg-flame-400/12 dark:text-flame-200"
                      : "bg-muted text-muted-foreground hover:bg-flame-50 hover:text-flame-700 motion-safe:hover:-translate-y-px dark:hover:bg-flame-400/8 dark:hover:text-flame-200",
                  )}
                  key={tag.name}
                  type="button"
                  onClick={() => onTagChange(active ? undefined : tag.name)}
                >
                  <HashIcon />
                  <span className="truncate">{tag.name}</span>
                  {tag.count > 1 && (
                    <span className="tabular-nums opacity-60">{tag.count}</span>
                  )}
                </button>
              );
            })
          ) : (
            <div className="text-xs text-muted-foreground">
              {t("explorer.noTags")}
            </div>
          )}
        </div>
      </section>
      {footer && <div className="mt-auto px-1 pt-5 pb-1">{footer}</div>}
    </aside>
  );
}

function StatCell({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="font-heading text-2xl leading-none font-semibold tabular-nums">
        {value}
      </div>
      <div className="mt-1.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function heatmapColor(count: number) {
  if (count <= 0) return "bg-muted";
  if (count === 1) return "bg-primary/20";
  if (count === 2) return "bg-primary/40";
  if (count === 3) return "bg-primary/70";
  return "bg-primary";
}
