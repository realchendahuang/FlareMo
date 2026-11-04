import { MoreHorizontal } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import type { Memo, ShowcaseDevice } from "./fixtures";

const CARD_CLASS: Record<ShowcaseDevice, string> = {
  desktop:
    "rounded-2xl border bg-surface p-4 sm:p-5 space-y-2.5 transition-all duration-300 relative",
  mobile:
    "rounded-2xl border bg-surface p-3 space-y-2 text-xs transition-all duration-300",
};

const HIGHLIGHT_CLASS: Record<ShowcaseDevice, string> = {
  desktop: "border-signal/60 ring-2 ring-signal/20 bg-signal/5 shadow-md",
  mobile: "border-signal/60 ring-2 ring-signal/20 bg-signal/5",
};

const REST_CLASS: Record<ShowcaseDevice, string> = {
  desktop: "border-line/70 shadow-2xs hover:border-line",
  mobile: "border-line/70 shadow-2xs",
};

const META_GROUP_CLASS: Record<ShowcaseDevice, string> = {
  desktop: "flex items-center gap-2",
  mobile: "flex items-center gap-1.5",
};

const DOT_CLASS: Record<ShowcaseDevice, string> = {
  desktop:
    "size-4.5 rounded-full border-2 border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 shrink-0",
  mobile:
    "size-3.5 rounded-full border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 shrink-0",
};

const TIME_CLASS: Record<ShowcaseDevice, string> = {
  desktop: "text-xs text-mist font-medium",
  mobile: "text-xs text-mist",
};

const MENU_ICON_CLASS: Record<ShowcaseDevice, string> = {
  desktop: "size-3.5 text-fog",
  mobile: "size-3 text-fog",
};

const TITLE_CLASS: Record<ShowcaseDevice, string> = {
  desktop: "text-sm sm:text-base font-bold text-ink tracking-tight",
  mobile: "font-bold text-ink text-xs line-clamp-1",
};

const CONTENT_CLASS: Record<ShowcaseDevice, string> = {
  desktop: "text-xs sm:text-sm text-ink leading-relaxed whitespace-pre-line",
  mobile: "text-xs text-mist line-clamp-2 leading-relaxed",
};

const QUOTE_CLASS: Record<ShowcaseDevice, string> = {
  desktop:
    "rounded-r-xl border-l-2 border-signal bg-signal/10 p-3 text-xs text-ink leading-relaxed",
  mobile:
    "border-l-2 border-signal/70 pl-2 text-xs text-ink/80 bg-wash/60 py-1 rounded-r-md",
};

type MemoCardProps = {
  memo: Memo;
  variant: ShowcaseDevice;
  isHighlighted: boolean;
  recordPrefix: string;
};

/** 桌面 / 手机共用的笔记卡（密度、排版与标签行样式由 variant 决定） */
export function MemoCard({
  memo,
  variant,
  isHighlighted,
  recordPrefix,
}: MemoCardProps) {
  const isMobile = variant === "mobile";

  return (
    <motion.article
      layout
      initial={
        isMobile
          ? { opacity: 0, y: -16, scale: 0.97 }
          : { opacity: 0, y: -20, scale: 0.96 }
      }
      animate={{
        opacity: 1,
        y: 0,
        scale: 1,
        transition: {
          type: "spring",
          stiffness: 350,
          damping: 25,
        },
      }}
      exit={{ opacity: 0, scale: 0.9 }}
      className={cn(
        CARD_CLASS[variant],
        isHighlighted ? HIGHLIGHT_CLASS[variant] : REST_CLASS[variant],
      )}
    >
      {/* 卡片头部 */}
      <div className="flex items-center justify-between">
        <div className={META_GROUP_CLASS[variant]}>
          <span className={DOT_CLASS[variant]} />
          <span className={TIME_CLASS[variant]}>{memo.timeLabel}</span>
        </div>
        {isMobile ? (
          <MoreHorizontal
            aria-hidden="true"
            className={MENU_ICON_CLASS.mobile}
          />
        ) : (
          <div className="flex items-center gap-2">
            <MoreHorizontal
              aria-hidden="true"
              className={MENU_ICON_CLASS.desktop}
            />
          </div>
        )}
      </div>

      {/* 笔记标题 */}
      {isMobile ? (
        <div className={TITLE_CLASS.mobile}>{memo.title}</div>
      ) : (
        <div className={TITLE_CLASS.desktop}>{memo.title}</div>
      )}

      {/* 笔记内容 */}
      <p className={CONTENT_CLASS[variant]}>{memo.content}</p>

      {/* 引用样式块 */}
      {memo.quote ? (
        <div className={QUOTE_CLASS[variant]}>{memo.quote}</div>
      ) : null}

      {/* 标签行 */}
      {memo.tags.length > 0 &&
        (isMobile ? (
          <div className="flex flex-wrap gap-1 pt-1 border-t border-line/40">
            {memo.tags.map((t) => (
              <span
                key={t}
                className="rounded-full bg-flame-50 dark:bg-flame-950/50 px-2 py-0.5 text-xs text-flame-600 dark:text-flame-400 font-medium"
              >
                #{t}
              </span>
            ))}
          </div>
        ) : (
          <div className="text-xs text-signal-ink font-medium">
            {memo.tags.map((t) => `#${t}`).join(" ")}
          </div>
        ))}

      {/* 卡片底部操作栏（仅桌面端） */}
      {!isMobile && (
        <div className="flex items-center justify-between pt-1 border-t border-line/40 text-xs text-fog font-mono">
          <span>
            {recordPrefix} {memo.orderNumber}
          </span>
          <div className="flex gap-1.5">
            {memo.tags.map((t) => (
              <span
                key={t}
                className="rounded-full bg-soft-surface px-2 py-0.5 text-xs text-mist"
              >
                #{t}
              </span>
            ))}
          </div>
        </div>
      )}
    </motion.article>
  );
}

type MemoCardListProps = {
  memos: Memo[];
  variant: ShowcaseDevice;
  lastSyncedId: string | null;
  recordPrefix: string;
};

/** 笔记流容器：两端的卡片间距不同，其余交给 MemoCard */
export function MemoCardList({
  memos,
  variant,
  lastSyncedId,
  recordPrefix,
}: MemoCardListProps) {
  return (
    <div className={variant === "mobile" ? "space-y-2.5" : "space-y-3"}>
      <AnimatePresence initial={false}>
        {memos.map((memo) => (
          <MemoCard
            key={memo.id}
            memo={memo}
            variant={variant}
            isHighlighted={memo.id === lastSyncedId}
            recordPrefix={recordPrefix}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
