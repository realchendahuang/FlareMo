import { PauseIcon, PlayIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Toggle } from "@/components/ui/toggle";
import { useI18n } from "@/i18n";
import { formatClock } from "@/lib/transcript";
import { cn } from "@/lib/utils";
import { useReadingAudio } from "./reading-audio-provider";

const RATES = [1, 1.25, 1.5, 2];

/**
 * Sticky transport for a transcript read. It stays in view while the body
 * scrolls, which is the whole point of pairing audio with long text.
 */
export function ReadingAudioBar({ className }: { className?: string }) {
  const { t } = useI18n();
  const audio = useReadingAudio();
  if (!audio?.track) return null;

  const { track, playing, currentTime, duration, rate, follow } = audio;
  const max = duration > 0 ? duration : 1;

  return (
    <div
      className={cn(
        "sticky top-2 z-20 flex flex-col gap-1.5 rounded-xl border border-border/60 bg-card/95 px-3 py-2.5 shadow-sm backdrop-blur-md",
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        <Button
          aria-label={playing ? t("reading.pause") : t("reading.play")}
          className="shrink-0"
          onClick={audio.toggle}
          size="icon-sm"
          variant="brand"
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </Button>

        <span
          className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums"
          data-testid="reading-time"
        >
          {formatClock(currentTime)} / {formatClock(duration)}
        </span>

        <Slider
          aria-label={t("reading.seek")}
          className="mx-1 min-w-0 flex-1"
          max={max}
          onValueChange={([value]) => audio.seek(value)}
          step={1}
          value={[Math.min(currentTime, max)]}
        />

        <div className="flex shrink-0 items-center gap-1">
          {RATES.map((value) => (
            <Toggle
              aria-label={t("reading.rate", { rate: value })}
              className="h-6 min-w-8 px-1.5 font-mono text-[0.7rem] tabular-nums"
              key={value}
              onPressedChange={() => audio.setRate(value)}
              pressed={rate === value}
              size="sm"
            >
              {value}×
            </Toggle>
          ))}
          <Toggle
            aria-label={t("reading.follow")}
            className="h-6 px-2 text-[0.7rem]"
            onPressedChange={audio.setFollow}
            pressed={follow}
            size="sm"
          >
            {t("reading.followShort")}
          </Toggle>
        </div>
      </div>

      {audio.tracks.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {audio.tracks.map((item) => (
            <button
              className={cn(
                "max-w-56 truncate rounded-md px-2 py-0.5 text-[0.7rem] transition-colors",
                item.id === track.id
                  ? "bg-flame-50 text-flame-700 dark:bg-flame-400/12 dark:text-flame-200"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
              key={item.id}
              onClick={() => audio.selectTrack(item.id)}
              type="button"
            >
              {item.filename}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
