import {
  Archive,
  Brain,
  CalendarDays,
  Footprints,
  Inbox,
  ListChecks,
  Trash2,
  Zap,
} from "lucide-react";
import type { ShowcaseContent } from "@/content/showcase-i18n";
import { cn } from "@/lib/utils";
import {
  HEATMAP_TILES,
  type ShowcaseMenu,
  type ShowcaseTag,
  type TimeViewTab,
} from "./fixtures";

export type SidebarVariant = "desktop" | "drawer";

/** 侧栏 / 抽屉顶部共用的品牌标识（logo + 产品名） */
export function BrandMark() {
  return (
    <>
      <div className="flex size-6 items-center justify-center rounded-lg bg-brand-gradient text-white text-xs font-bold shadow-2xs">
        <span className="text-white font-extrabold text-[13px]">F</span>
      </div>
      <span className="font-bold text-sm text-ink tracking-tight">FlareMo</span>
    </>
  );
}

const STATS_GRID_CLASS: Record<SidebarVariant, string> = {
  desktop: "grid grid-cols-3 text-center py-1.5 border-y border-line/60",
  drawer:
    "grid grid-cols-3 text-center py-1.5 border-y border-line/60 bg-soft-surface/40 rounded-lg",
};

const STATS_VALUE_CLASS: Record<SidebarVariant, string> = {
  desktop: "text-base font-extrabold text-ink tabular-nums",
  drawer: "text-sm font-extrabold text-ink tabular-nums",
};

const HEATMAP_CARD_CLASS: Record<SidebarVariant, string> = {
  desktop: "rounded-xl border border-line/60 bg-surface/70 p-2.5 space-y-1.5",
  drawer: "rounded-xl border border-line/60 bg-surface/70 p-2 space-y-1",
};

const HEATMAP_GRID_CLASS: Record<SidebarVariant, string> = {
  desktop: "grid grid-flow-col grid-rows-6 gap-1 justify-between",
  drawer: "grid grid-flow-col grid-rows-6 gap-0.5 justify-between",
};

const HEATMAP_TILE_CLASS: Record<SidebarVariant, string> = {
  desktop: "size-2 rounded-[2px]",
  drawer: "size-1.5 rounded-[1px]",
};

const HEATMAP_TILE_HIGH_CLASS: Record<SidebarVariant, string> = {
  desktop: "bg-signal shadow-2xs",
  drawer: "bg-signal",
};

const NAV_CLASS: Record<SidebarVariant, string> = {
  desktop: "space-y-0.5 text-xs font-semibold",
  drawer: "space-y-0.5 font-semibold text-xs",
};

const NAV_BUTTON_CLASS: Record<SidebarVariant, string> = {
  desktop:
    "w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer",
  drawer:
    "w-full flex items-center justify-between px-2 py-1.5 rounded-lg transition-colors cursor-pointer",
};

const NAV_ICON_CLASS: Record<SidebarVariant, string> = {
  desktop: "size-4",
  drawer: "size-3.5",
};

const NAV_COUNT_CLASS: Record<SidebarVariant, string> = {
  desktop:
    "font-mono text-[10px] px-1.5 py-0.5 bg-line/60 rounded-full text-mist",
  drawer: "font-mono text-[9px] px-1 py-0.2 bg-line/60 rounded-full text-mist",
};

const QUICK_ITEM_CLASS: Record<SidebarVariant, string> = {
  desktop:
    "flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:text-ink hover:bg-wash transition-colors cursor-pointer",
  drawer:
    "w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:text-ink hover:bg-wash transition-colors cursor-pointer text-left",
};

const TAG_BUTTON_CLASS: Record<SidebarVariant, string> = {
  desktop:
    "w-full flex items-center justify-between px-2.5 py-1 rounded-lg text-xs transition-colors cursor-pointer",
  drawer:
    "w-full flex items-center justify-between px-2 py-1 rounded-lg text-xs transition-colors cursor-pointer",
};

const TAG_COUNT_CLASS: Record<SidebarVariant, string> = {
  desktop: "text-[10px] text-fog font-mono",
  drawer: "text-[9px] text-fog font-mono",
};

function StatsGrid({
  variant,
  showcase,
  totalCount,
  tagList,
}: {
  variant: SidebarVariant;
  showcase: ShowcaseContent;
  totalCount: number;
  tagList: ShowcaseTag[];
}) {
  return (
    <div className={STATS_GRID_CLASS[variant]}>
      {[
        { id: "records", value: totalCount, label: showcase.ui.statsRecords },
        { id: "tags", value: tagList.length, label: showcase.ui.statsTags },
        { id: "days", value: 1, label: showcase.ui.statsDays },
      ].map((stat) => (
        <div key={stat.id}>
          <div className={STATS_VALUE_CLASS[variant]}>{stat.value}</div>
          <div className="text-xs text-mist">{stat.label}</div>
        </div>
      ))}
    </div>
  );
}

function TimeViewTabs({
  showcase,
  timeViewTab,
  onTimeViewTabChange,
}: {
  showcase: ShowcaseContent;
  timeViewTab: TimeViewTab;
  onTimeViewTabChange: (tab: TimeViewTab) => void;
}) {
  return (
    <div className="flex rounded-lg bg-soft-surface p-0.5 border border-line/60 text-xs font-semibold text-mist">
      {(["trend", "calendar"] as const).map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => onTimeViewTabChange(tab)}
          className={cn(
            "flex-1 py-1 rounded-md text-center transition-colors cursor-pointer",
            timeViewTab === tab
              ? "bg-surface text-signal-ink shadow-2xs font-bold"
              : "hover:text-ink",
          )}
        >
          {tab === "trend" ? showcase.ui.trend : showcase.ui.calendar}
        </button>
      ))}
    </div>
  );
}

function Heatmap({
  variant,
  showcase,
}: {
  variant: SidebarVariant;
  showcase: ShowcaseContent;
}) {
  const isDrawer = variant === "drawer";
  const tiles = isDrawer ? HEATMAP_TILES.slice(0, 48) : HEATMAP_TILES;

  return (
    <div className={HEATMAP_CARD_CLASS[variant]}>
      <div className={HEATMAP_GRID_CLASS[variant]}>
        {tiles.map((tile) => (
          <span
            key={isDrawer ? `mob-${tile.id}` : tile.id}
            className={cn(
              HEATMAP_TILE_CLASS[variant],
              tile.isHigh
                ? HEATMAP_TILE_HIGH_CLASS[variant]
                : tile.isMedium
                  ? "bg-signal/40"
                  : "bg-line/70 dark:bg-line/40",
            )}
          />
        ))}
      </div>
      <div className="flex justify-between text-xs text-fog font-mono px-0.5">
        {isDrawer ? (
          <>
            <span>{showcase.ui.months[1]}</span>
            <span>{showcase.ui.months[2]}</span>
            <span>{showcase.ui.months[3]}</span>
          </>
        ) : (
          showcase.ui.months.map((m) => <span key={m}>{m}</span>)
        )}
      </div>
    </div>
  );
}

function MenuNav({
  variant,
  showcase,
  totalCount,
  activeMenu,
  activeTag,
  onSelectMenu,
}: {
  variant: SidebarVariant;
  showcase: ShowcaseContent;
  totalCount: number;
  activeMenu: ShowcaseMenu;
  activeTag: string | null;
  onSelectMenu: (menu: ShowcaseMenu) => void;
}) {
  const items = [
    {
      menu: "timeline" as const,
      icon: Inbox,
      label: showcase.ui.timeline,
      count: totalCount,
      active: activeMenu === "timeline" && !activeTag,
      accent: true,
    },
    {
      menu: "archive" as const,
      icon: Archive,
      label: showcase.ui.archive,
      count: 0,
      active: activeMenu === "archive",
      accent: false,
    },
    {
      menu: "trash" as const,
      icon: Trash2,
      label: showcase.ui.trash,
      count: 0,
      active: activeMenu === "trash",
      accent: false,
    },
  ];

  return (
    <nav className={NAV_CLASS[variant]}>
      {items.map((item) => (
        <button
          key={item.menu}
          type="button"
          onClick={() => onSelectMenu(item.menu)}
          className={cn(
            NAV_BUTTON_CLASS[variant],
            item.active
              ? "bg-signal/15 text-signal-ink font-bold border border-signal/30"
              : "text-mist hover:text-ink hover:bg-wash",
          )}
        >
          <div className="flex items-center gap-2">
            <item.icon
              className={cn(
                NAV_ICON_CLASS[variant],
                item.accent ? "text-signal" : undefined,
              )}
            />
            <span>{item.label}</span>
          </div>
          <span className={NAV_COUNT_CLASS[variant]}>{item.count}</span>
        </button>
      ))}
    </nav>
  );
}

function QuickViews({
  variant,
  showcase,
  onSelect,
}: {
  variant: SidebarVariant;
  showcase: ShowcaseContent;
  onSelect?: () => void;
}) {
  const items = [
    { icon: Zap, label: showcase.ui.dailyReview },
    { icon: Footprints, label: showcase.ui.randomWalk },
    { icon: Brain, label: showcase.ui.memory },
    { icon: CalendarDays, label: showcase.ui.calendarView },
    { icon: ListChecks, label: showcase.ui.projects },
  ];

  return (
    <div className="pt-2 border-t border-line/40 space-y-0.5 text-xs text-mist">
      {items.map((item) =>
        variant === "drawer" ? (
          <button
            type="button"
            key={item.label}
            className={QUICK_ITEM_CLASS.drawer}
            onClick={onSelect}
          >
            <item.icon className="size-3.5 text-fog" />
            <span>{item.label}</span>
          </button>
        ) : (
          <div key={item.label} className={QUICK_ITEM_CLASS.desktop}>
            <item.icon className="size-3.5 text-fog" />
            <span>{item.label}</span>
          </div>
        ),
      )}
    </div>
  );
}

function TagList({
  variant,
  showcase,
  tagList,
  activeTag,
  onToggleTag,
}: {
  variant: SidebarVariant;
  showcase: ShowcaseContent;
  tagList: ShowcaseTag[];
  activeTag: string | null;
  onToggleTag: (name: string) => void;
}) {
  return (
    <div className="pt-2 border-t border-line/40 space-y-1">
      <div className="text-xs font-bold text-fog px-2">
        {showcase.ui.tagIndex}
      </div>
      <div className="space-y-0.5">
        {tagList.map((tag) => (
          <button
            type="button"
            key={tag.name}
            onClick={() => onToggleTag(tag.name)}
            className={cn(
              TAG_BUTTON_CLASS[variant],
              activeTag === tag.name
                ? "bg-signal/15 text-signal-ink font-bold"
                : "text-mist hover:text-ink hover:bg-wash",
            )}
          >
            <span>#{tag.name}</span>
            <span className={TAG_COUNT_CLASS[variant]}>{tag.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

type SidebarCommonProps = {
  showcase: ShowcaseContent;
  totalCount: number;
  tagList: ShowcaseTag[];
  activeMenu: ShowcaseMenu;
  activeTag: string | null;
  onSelectMenu: (menu: ShowcaseMenu) => void;
  onToggleTag: (name: string) => void;
};

export type DeviceSidebarProps = SidebarCommonProps &
  (
    | {
        variant: "desktop";
        timeViewTab: TimeViewTab;
        onTimeViewTabChange: (tab: TimeViewTab) => void;
      }
    | { variant: "drawer"; onClose: () => void }
  );

/** 桌面侧栏与手机抽屉共用的导航内容（尺寸 / 热力图密度 / 快捷项元素类型由 variant 决定） */
export function DeviceSidebar(props: DeviceSidebarProps) {
  const {
    showcase,
    totalCount,
    tagList,
    activeMenu,
    activeTag,
    onSelectMenu,
    onToggleTag,
  } = props;

  return (
    <>
      <StatsGrid
        variant={props.variant}
        showcase={showcase}
        totalCount={totalCount}
        tagList={tagList}
      />

      {props.variant === "desktop" ? (
        <div className="space-y-2">
          <TimeViewTabs
            showcase={showcase}
            timeViewTab={props.timeViewTab}
            onTimeViewTabChange={props.onTimeViewTabChange}
          />
          <Heatmap variant="desktop" showcase={showcase} />
        </div>
      ) : (
        <Heatmap variant="drawer" showcase={showcase} />
      )}

      <MenuNav
        variant={props.variant}
        showcase={showcase}
        totalCount={totalCount}
        activeMenu={activeMenu}
        activeTag={activeTag}
        onSelectMenu={onSelectMenu}
      />

      <QuickViews
        variant={props.variant}
        showcase={showcase}
        onSelect={props.variant === "drawer" ? props.onClose : undefined}
      />

      <TagList
        variant={props.variant}
        showcase={showcase}
        tagList={tagList}
        activeTag={activeTag}
        onToggleTag={onToggleTag}
      />
    </>
  );
}
