import { useQuery } from "@tanstack/react-query";
import { toPng } from "html-to-image";
import { DownloadIcon, Loader2Icon } from "lucide-react";
import { type CSSProperties, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { Memo } from "@/api";
import { getMemoStats } from "@/api";
import { WatercolorMemoryScene } from "@/components/share-image-watercolor-scene";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type TranslationKey, useI18n } from "@/i18n";
import { formatMemoTime } from "@/lib/memo";
import { cn } from "@/lib/utils";

/**
 * The "output" half of sharing (flomo's 生成分享图片): turn one memo into a
 * card image. Permission lives in the ⋯ visibility submenu — this dialog only
 * renders and exports, it never changes who can see the note.
 */

type ShareImageDialogProps = {
  memo: Memo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type TemplateId = "plain" | "daily" | "ticket";

const TEMPLATES: Array<{ id: TemplateId; labelKey: TranslationKey }> = [
  { id: "plain", labelKey: "share.template.plain" },
  { id: "daily", labelKey: "share.template.daily" },
  { id: "ticket", labelKey: "share.template.ticket" },
];

const literarySerif: CSSProperties = {
  fontFamily:
    '"Songti SC", "STSong", "Noto Serif CJK SC", "Noto Serif SC", Georgia, serif',
};

/** Card-image body: markdown flattened to the text a picture should carry. */
function shareBodyText(content: string) {
  return content
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/^- \[[ xX]\] /gm, "☐ ")
    .replace(/^#{1,3} /gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .trim();
}

type CardProps = {
  date: string;
  day: string;
  body: string;
  stats: string;
};

/** 票根: the newest reference, framed and perforated with a barcode strip. */
function TicketCard({ date, body, stats }: CardProps) {
  return (
    <div className="flex h-[420px] w-[340px] flex-col overflow-hidden rounded-lg border border-neutral-300 bg-white text-neutral-800 shadow-sm">
      <div className="flex items-center justify-between border-b border-neutral-200 px-7 py-4">
        <span className="text-sm text-neutral-500">{date}</span>
        <span className="text-xs font-semibold text-neutral-400">FlareMo</span>
      </div>
      <div className="relative">
        <div className="mx-7 border-t border-dashed border-neutral-300" />
        <span className="absolute top-1/2 -left-2 size-4 -translate-y-1/2 rounded-full bg-white" />
        <span className="absolute top-1/2 -right-2 size-4 -translate-y-1/2 rounded-full bg-white" />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-7 text-[15px] leading-7 whitespace-pre-wrap">
        {body}
      </div>
      <div className="flex items-end justify-between px-7 pb-5">
        <span className="text-xs text-neutral-400">{stats}</span>
        <span
          aria-hidden="true"
          className="h-6 w-24 text-neutral-700"
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg, currentColor 0 2px, transparent 2px 5px)",
            opacity: 0.35,
          }}
        />
      </div>
    </div>
  );
}

/** 明信片: a clear record above, a sparse watercolor memory below. */
function PostcardCard({ date, body, stats }: CardProps) {
  return (
    <div className="flex h-[420px] w-[340px] flex-col overflow-hidden rounded-[3px] border border-[#d4c7b4] bg-[#f6f0e5] text-[#34312d] shadow-[0_18px_46px_rgba(70,57,42,0.14)]">
      <div className="flex h-[210px] shrink-0 flex-col px-7 pt-6">
        <div className="flex items-center justify-between text-[9px] tracking-[0.18em] text-[#7d7468] uppercase">
          <span>Memory note</span>
          <span>{date}</span>
        </div>
        <div
          className="mt-6 min-h-0 overflow-hidden text-[15px] leading-7 tracking-[0.01em] whitespace-pre-wrap"
          style={literarySerif}
        >
          {body}
        </div>
      </div>
      <WatercolorMemoryScene stats={stats} />
    </div>
  );
}

/** KOSX: stark editorial type, inverted onto paper with one signal-orange hit. */
function KosxCard({ date, day, body, stats }: CardProps) {
  return (
    <div className="flex h-[420px] w-[340px] flex-col overflow-hidden rounded-[3px] border border-[#171717] bg-[#f4f2ec] text-[#111] shadow-[0_18px_46px_rgba(30,27,22,0.16)]">
      <div className="h-2 bg-[#ff5a1f]" />
      <div className="flex items-center justify-between px-7 pt-5 text-[9px] font-semibold tracking-[0.18em] uppercase">
        <span>KOSX.ai × FlareMo</span>
        <span>{date}</span>
      </div>
      <div className="mx-7 mt-4 flex items-end justify-between border-y-2 border-[#111] py-4">
        <span className="text-[31px] leading-[0.86] font-black tracking-[-0.055em]">
          BUILD
          <br />
          SOMETHING
          <br />
          REAL.
        </span>
        <span className="flex size-8 items-center justify-center bg-[#ff5a1f] text-lg font-bold text-white">
          ↗
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-7 py-5 text-[15px] leading-7 tracking-[0.01em] whitespace-pre-wrap">
        {body}
      </div>
      <div className="mx-7 flex items-end justify-between border-t border-[#111] pt-3 pb-5 text-[9px] tracking-[0.14em] uppercase">
        <span className="text-[#555]">{stats}</span>
        <span className="font-semibold">
          Field note / {day.padStart(2, "0")}
        </span>
      </div>
    </div>
  );
}

export function ShareImageDialog({
  memo,
  open,
  onOpenChange,
}: ShareImageDialogProps) {
  const { locale, t } = useI18n();
  const [template, setTemplate] = useState<TemplateId>("plain");
  const [isExporting, setIsExporting] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const [timeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const statsQuery = useQuery({
    queryKey: ["memo-stats", timeZone, "all"],
    queryFn: () => getMemoStats(timeZone),
    enabled: open,
    staleTime: 60_000,
  });
  const date = formatMemoTime(memo.display_time, locale);
  const day = useMemo(() => {
    const parsed = new Date(memo.display_time);
    return Number.isNaN(parsed.getTime()) ? "" : String(parsed.getDate());
  }, [memo.display_time]);
  const body = useMemo(() => shareBodyText(memo.content), [memo.content]);
  // The card shows real account stats, so while the query is in flight the
  // stats line stays blank rather than flashing "0 memos · 0 days" — and the
  // export button stays disabled so an early export cannot bake zeros into
  // the image.
  const stats =
    statsQuery.isPending || statsQuery.isError
      ? ""
      : t("share.imageStats", {
          count: statsQuery.data.counts.total,
          days: statsQuery.data.active_days,
        });

  const exportImage = async () => {
    const node = previewRef.current;
    if (!node) return;
    setIsExporting(true);
    try {
      const dataUrl = await toPng(node, { pixelRatio: 2 });
      const anchor = document.createElement("a");
      anchor.download = `flaremo-${memo.id}.png`;
      anchor.href = dataUrl;
      anchor.click();
    } catch {
      toast.error(t("share.exportFailed"));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t("share.imageTitle")}</DialogTitle>
          <DialogDescription>{t("share.imageSubtitle")}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-center py-2">
          <div ref={previewRef}>
            {template === "plain" && (
              <TicketCard body={body} date={date} day={day} stats={stats} />
            )}
            {template === "daily" && (
              <PostcardCard body={body} date={date} day={day} stats={stats} />
            )}
            {template === "ticket" && (
              <KosxCard body={body} date={date} day={day} stats={stats} />
            )}
          </div>
        </div>
        <fieldset
          aria-label={t("share.templateLabel")}
          className="flex justify-center gap-1.5 border-0 p-0"
        >
          {TEMPLATES.map((item) => (
            <button
              aria-pressed={template === item.id}
              className={cn(
                "rounded-md px-3 py-1 text-xs motion-safe:transition-colors",
                template === item.id
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              key={item.id}
              type="button"
              onClick={() => setTemplate(item.id)}
            >
              {t(item.labelKey)}
            </button>
          ))}
        </fieldset>
        <DialogFooter>
          <Button
            className="w-full sm:w-auto"
            disabled={isExporting || statsQuery.isPending}
            onClick={() => void exportImage()}
            type="button"
            variant="brand"
          >
            {isExporting ? (
              <Loader2Icon
                className="motion-safe:animate-spin"
                data-icon="inline-start"
              />
            ) : (
              <DownloadIcon data-icon="inline-start" />
            )}
            {isExporting ? t("share.exporting") : t("share.exportImage")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
