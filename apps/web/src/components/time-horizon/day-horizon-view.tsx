// ============================================================================
// 4. Day Horizon View (Classic 12-Hour Astronomical Timepiece - Bold & Intuitive)
// ============================================================================
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/i18n";
import { todayKey } from "@/lib/calendar-date";
import { buildHourCountMap } from "@/lib/time-horizon";
import { cn } from "@/lib/utils";
import type { DisplayMode } from "./shared";

type MemoItem = {
  id: string;
  create_time: string;
  content?: string;
};

// 12 Clock Positions: 12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11
const CLOCK_POSITIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

export function DayHorizonPureView({
  selectedDay,
  today = todayKey(),
  hourlyData,
  memos = [],
  isLoading,
  displayMode = "calendar",
  onJumpToTimeline,
  onHoverTip,
}: {
  selectedDay: string;
  today?: string;
  hourlyData: Array<{ date: string; hour: number; count: number }>;
  memos?: MemoItem[];
  isLoading: boolean;
  displayMode?: DisplayMode;
  onJumpToTimeline: (day: string) => void;
  onHoverTip: (tip: string | null) => void;
}) {
  const { t } = useI18n();
  const hourCountMap = useMemo(
    () => buildHourCountMap(hourlyData),
    [hourlyData],
  );

  const [hoveredPos, setHoveredPos] = useState<number | null>(null);

  const isViewingToday = selectedDay === today;

  // Real-time live date for authentic clock hands
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!isViewingToday) return;
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [isViewingToday]);

  // Real-time second sync for the satellite photon (0..60s continuous rotation)
  const [secondOffset, setSecondOffset] = useState(() => {
    const d = new Date();
    return d.getSeconds() + d.getMilliseconds() / 1000;
  });

  useEffect(() => {
    if (!isViewingToday) return;
    const syncTime = () => {
      const d = new Date();
      setSecondOffset(d.getSeconds() + d.getMilliseconds() / 1000);
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        syncTime();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [isViewingToday]);

  // If viewing a historical day, find the last active hour to dock the photon
  const lastActiveHour = useMemo(() => {
    if (isViewingToday) return null;
    for (let h = 23; h >= 0; h--) {
      if ((hourCountMap.get(h) ?? 0) > 0) return h;
    }
    return null;
  }, [isViewingToday, hourCountMap]);

  // Group memos by their local hour for informative hover tips
  const memosByHour = useMemo(() => {
    const map = new Map<number, MemoItem[]>();
    for (const m of memos) {
      const h = new Date(m.create_time).getHours();
      const list = map.get(h) ?? [];
      list.push(m);
      map.set(h, list);
    }
    return map;
  }, [memos]);

  const handleHoverPosition = (pos: number | null) => {
    setHoveredPos(pos);
    if (pos === null) {
      onHoverTip(null);
      return;
    }
    const hAm = pos;
    const hPm = pos + 12;
    const countAm = hourCountMap.get(hAm) ?? 0;
    const countPm = hourCountMap.get(hPm) ?? 0;
    const totalCount = countAm + countPm;

    const hourLabelAm = `${String(hAm).padStart(2, "0")}:00`;
    const hourLabelPm = `${String(hPm).padStart(2, "0")}:00`;

    const memosAm = memosByHour.get(hAm) ?? [];
    const memosPm = memosByHour.get(hPm) ?? [];
    const firstMemo = memosAm[0] ?? memosPm[0];
    const firstSnippet = firstMemo?.content
      ? firstMemo.content
          .replace(/[#*`~>-]/g, "")
          .trim()
          .slice(0, 30)
      : null;
    const snippetSuffix = firstSnippet ? ` · “${firstSnippet}”` : "";

    if (totalCount > 0) {
      const notes = (count: number) => t("explorer.notesCount", { count });
      if (countAm > 0 && countPm > 0) {
        onHoverTip(
          `${selectedDay} ${hourLabelAm} (${notes(countAm)}) · ${hourLabelPm} (${notes(countPm)})${snippetSuffix}`,
        );
      } else if (countAm > 0) {
        onHoverTip(
          `${selectedDay} ${hourLabelAm} · ${notes(countAm)}${snippetSuffix}`,
        );
      } else {
        onHoverTip(
          `${selectedDay} ${hourLabelPm} · ${notes(countPm)}${snippetSuffix}`,
        );
      }
    } else {
      onHoverTip(
        `${selectedDay} ${pos === 0 ? "12:00 / 00:00" : `${pos}:00`} · ${t("explorer.noRecords")}`,
      );
    }
  };

  // ── Precision Geometry (ViewBox: 0 0 210 210, Center: 105, 105) ───────────
  const cx = 105;
  const cy = 105;
  const rOrbit = 86; // Outer orbit track for satellite
  const rTickOut = 76; // Ticks outer edge
  const rTickInNormal = 65; // Normal tick inner edge (length = 11px)
  const rTickInCardinal = 60; // Cardinal tick inner edge (length = 16px)
  const rInnerGuide = 44; // Inner guide ring

  // ── 12-Hour Classic Clock Hands (时针与分针 - 粗壮清晰、自然直觉) ───────────
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentSecond = now.getSeconds();

  // 12-hour clock: 12 is at top (-90 deg), 3 is right (0 deg), 6 is bottom (90 deg), 9 is left (180 deg)
  const hourValue = isViewingToday
    ? (currentHour % 12) + currentMinute / 60
    : lastActiveHour !== null
      ? lastActiveHour % 12
      : 0;
  const hourDeg = (hourValue / 12) * 360 - 90;
  const hourRad = (hourDeg * Math.PI) / 180;

  // Minute hand: 60-minute cycle (360 deg)
  const minuteDeg = isViewingToday
    ? ((currentMinute + currentSecond / 60) / 60) * 360 - 90
    : -90;
  const minuteRad = (minuteDeg * Math.PI) / 180;

  return (
    <div className="flex h-full min-h-[180px] items-center justify-center px-1 py-1 select-none">
      <button
        type="button"
        className="relative flex items-center justify-center p-1 cursor-pointer transition-transform duration-200 hover:scale-[1.02]"
        onClick={() => onJumpToTimeline(selectedDay)}
        aria-label={t("explorer.viewDayInTimeline")}
      >
        <svg
          viewBox="0 0 210 210"
          className={cn(
            "w-[190px] h-[190px] sm:w-[204px] sm:h-[204px] select-none transition-opacity duration-200",
            isLoading && "opacity-50",
          )}
          aria-hidden="true"
        >
          <title>{t("explorer.classicClock")}</title>

          {/* ── 1. Inner Concentric Guide Ring (高对比度同心导轨) ───────── */}
          <circle
            cx={cx}
            cy={cy}
            r={rInnerGuide}
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="2.5 4"
            className="text-foreground/25 dark:text-foreground/35"
          />

          {/* ── 2. Outer Celestial Orbit Track (加粗天体虚线轨道) ───────── */}
          <circle
            cx={cx}
            cy={cy}
            r={rOrbit}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeDasharray="3 4.5"
            className="text-foreground/35 dark:text-foreground/45"
          />

          {/* ── 3. 12-Hour Precision Ticks (粗壮、清晰的名表级发丝刻度) ──── */}
          {CLOCK_POSITIONS.map((pos) => {
            const hAm = pos;
            const hPm = pos + 12;
            const countAm = hourCountMap.get(hAm) ?? 0;
            const countPm = hourCountMap.get(hPm) ?? 0;
            const totalCount = countAm + countPm;

            const isHovered = hoveredPos === pos;
            const isCardinal = pos % 3 === 0; // 12, 3, 6, 9

            // Angle: 12 at top (-90 deg), 3 right (0 deg), 6 bottom (90 deg), 9 left (180 deg)
            const angleDeg = (pos / 12) * 360 - 90;
            const angleRad = (angleDeg * Math.PI) / 180;
            const cos = Math.cos(angleRad);
            const sin = Math.sin(angleRad);

            const rIn = isCardinal ? rTickInCardinal : rTickInNormal;
            const x1 = cx + rIn * cos;
            const y1 = cy + rIn * sin;
            const x2 = cx + rTickOut * cos;
            const y2 = cy + rTickOut * sin;

            // Outer tip gem coordinates
            const xGem = cx + (rTickOut + 2) * cos;
            const yGem = cy + (rTickOut + 2) * sin;

            return (
              <g key={`pos-${pos}`}>
                {/* Visible Bold Tick */}
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  strokeLinecap="round"
                  className={cn(
                    "transition-all duration-150",
                    totalCount > 0
                      ? "stroke-brand-500 dark:stroke-brand-400 stroke-[3.5px] drop-shadow-[0_0_3px_var(--brand-500)]"
                      : isCardinal
                        ? "stroke-foreground/75 dark:stroke-foreground/80 stroke-[2.8px]"
                        : "stroke-foreground/35 dark:stroke-foreground/45 stroke-[1.8px]",
                    isHovered && "stroke-brand-500 stroke-[4px] brightness-125",
                  )}
                />

                {/* Illuminated Gem at Tip for Active Hours */}
                {totalCount > 0 && (
                  <g>
                    {/* Hover Pulse Halo */}
                    {isHovered && (
                      <circle
                        cx={xGem}
                        cy={yGem}
                        r="7"
                        fill="none"
                        stroke="var(--brand-500)"
                        strokeWidth="1.5"
                        className="opacity-60"
                      />
                    )}
                    {/* Luminous Core Gem */}
                    <circle
                      cx={xGem}
                      cy={yGem}
                      r={isHovered ? 4 : 3}
                      className="fill-brand-500 dark:fill-brand-400 filter drop-shadow-[0_0_5px_var(--brand-500)]"
                    />
                    <circle
                      cx={xGem}
                      cy={yGem}
                      r="1.2"
                      className="fill-white"
                    />
                  </g>
                )}

                {/* Expanded Invisible Click/Hover Target */}
                {/* biome-ignore lint/a11y/noStaticElementInteractions: Hour tick hover interaction */}
                <line
                  x1={cx + (rIn - 6) * cos}
                  y1={cy + (rIn - 6) * sin}
                  x2={cx + (rTickOut + 8) * cos}
                  y2={cy + (rTickOut + 8) * sin}
                  stroke="transparent"
                  strokeWidth="16"
                  className="cursor-pointer"
                  onMouseEnter={() => handleHoverPosition(pos)}
                  onMouseLeave={() => handleHoverPosition(null)}
                />
              </g>
            );
          })}

          {/* ── 4. Cardinal Clock Typography (12, 3, 6, 9 清晰醒目基准字) ─ */}
          {displayMode === "calendar" && (
            <>
              <text
                x={cx}
                y="14"
                textAnchor="middle"
                className="text-[10px] font-mono font-bold fill-foreground/80 dark:fill-foreground/90 select-none"
              >
                12
              </text>
              <text
                x="197"
                y={cy + 3.5}
                textAnchor="middle"
                className="text-[10px] font-mono font-bold fill-foreground/80 dark:fill-foreground/90 select-none"
              >
                3
              </text>
              <text
                x={cx}
                y="204"
                textAnchor="middle"
                className="text-[10px] font-mono font-bold fill-foreground/80 dark:fill-foreground/90 select-none"
              >
                6
              </text>
              <text
                x="13"
                y={cy + 3.5}
                textAnchor="middle"
                className="text-[10px] font-mono font-bold fill-foreground/80 dark:fill-foreground/90 select-none"
              >
                9
              </text>
            </>
          )}

          {/* ── 5. Classic Analog Clock Hands (加粗力量感时针与分针) ─────── */}
          <g>
            {/* Hour Hand (12-Hour Movement, length = 32px, stroke = 3.2px) */}
            <line
              x1={cx}
              y1={cy}
              x2={cx + 32 * Math.cos(hourRad)}
              y2={cy + 32 * Math.sin(hourRad)}
              strokeLinecap="round"
              className={cn(
                "stroke-foreground dark:stroke-foreground stroke-[3.2px] drop-shadow-2xs transition-transform duration-300",
                !isViewingToday && "opacity-40",
              )}
            />

            {/* Minute Hand (60-Minute Movement, length = 48px, stroke = 2px) */}
            <line
              x1={cx}
              y1={cy}
              x2={cx + 48 * Math.cos(minuteRad)}
              y2={cy + 48 * Math.sin(minuteRad)}
              strokeLinecap="round"
              className={cn(
                "stroke-foreground/85 dark:stroke-foreground/90 stroke-[2px] transition-transform duration-300",
                !isViewingToday && "opacity-40",
              )}
            />

            {/* Precision Center Pinion Cap */}
            <circle
              cx={cx}
              cy={cy}
              r="3.5"
              className="fill-foreground dark:fill-foreground"
            />
            <circle
              cx={cx}
              cy={cy}
              r="1.2"
              className="fill-background dark:fill-background"
            />
          </g>

          {/* ── 6. Orbital Satellite Photon (加亮高能流光微粒) ──────────── */}
          {isViewingToday ? (
            <g
              className="animate-satellite-orbit"
              style={{
                animationDelay: `-${secondOffset}s`,
                transformOrigin: `${cx}px ${cy}px`,
              }}
            >
              {/* Stardust Wake (3 Tapering Trailing Particles along rOrbit=86) */}
              <circle
                cx={cx + rOrbit * Math.sin((-12 * Math.PI) / 180)}
                cy={cy - rOrbit * Math.cos((-12 * Math.PI) / 180)}
                r="1.2"
                className="fill-brand-500/35 dark:fill-brand-400/40"
              />
              <circle
                cx={cx + rOrbit * Math.sin((-7.5 * Math.PI) / 180)}
                cy={cy - rOrbit * Math.cos((-7.5 * Math.PI) / 180)}
                r="1.8"
                className="fill-brand-500/60 dark:fill-brand-400/70"
              />
              <circle
                cx={cx + rOrbit * Math.sin((-3.5 * Math.PI) / 180)}
                cy={cy - rOrbit * Math.cos((-3.5 * Math.PI) / 180)}
                r="2.4"
                className="fill-brand-500 dark:fill-brand-400"
              />

              {/* Luminous Halo Aura */}
              <circle
                cx={cx}
                cy={cy - rOrbit}
                r="6"
                className="fill-brand-500/20 dark:fill-brand-400/25"
              />

              {/* Core Photon: High-Energy Brilliant Star */}
              <circle
                cx={cx}
                cy={cy - rOrbit}
                r="3"
                className="fill-brand-500 dark:fill-brand-300 filter drop-shadow-[0_0_5px_var(--brand-500)]"
              />
              <circle
                cx={cx}
                cy={cy - rOrbit}
                r="1.2"
                className="fill-white dark:fill-white"
              />
            </g>
          ) : lastActiveHour !== null ? (
            /* Docked Photon for Historical Days (Resting at last active note hour) */
            <g
              style={{
                transform: `rotate(${((lastActiveHour % 12) / 12) * 360}deg)`,
                transformOrigin: `${cx}px ${cy}px`,
              }}
            >
              {/* Stationed Beacon Halo */}
              <circle
                cx={cx}
                cy={cy - rOrbit}
                r="5"
                className="fill-brand-500/25 dark:fill-brand-400/30"
              />
              {/* Stationed Photon */}
              <circle
                cx={cx}
                cy={cy - rOrbit}
                r="2.6"
                className="fill-brand-500 dark:fill-brand-300 filter drop-shadow-[0_0_4px_var(--brand-500)]"
              />
              <circle cx={cx} cy={cy - rOrbit} r="1" className="fill-white" />
            </g>
          ) : null}
        </svg>
      </button>
    </div>
  );
}
