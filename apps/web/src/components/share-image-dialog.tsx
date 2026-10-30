import { resolveOptionValues } from "@flaremo/plugins";
import { useQuery } from "@tanstack/react-query";
import { toPng } from "html-to-image";
import { DownloadIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { Memo } from "@/api";
import { getMemoStats, getPublicPluginSettings } from "@/api";
import { useBranding } from "@/branding";
import { ShareCardDocumentView } from "@/components/share-card-document";
import {
  type ShareCardSandboxHandle,
  ShareCardSandboxHost,
} from "@/components/share-card-sandbox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { type TranslationKey, useI18n } from "@/i18n";
import { formatMemoTime } from "@/lib/memo";
import {
  loadCardPayload,
  type ShareCardView,
  visibleCardViews,
} from "@/lib/plugin-cards";
import { cn } from "@/lib/utils";

/**
 * The "output" half of sharing (flomo's 生成分享图片): turn one memo into a
 * card image. Cards come from the plugin platform: bundled cards compile in
 * from `plugins/`; store-installed cards load their payload from the
 * instance's asset endpoint on selection. `document` cards render in-app from
 * data; `sandbox` cards run in an opaque-origin iframe and hand back a PNG.
 * Permission lives in the ⋯ visibility submenu — this dialog only renders and
 * exports.
 */

type ShareImageDialogProps = {
  memo: Memo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Card-image body: markdown flattened to the text a picture should carry. */
export function shareBodyText(content: string) {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/^- \[[ xX]\] /gm, "☐ ")
    .replace(/^#{1,3} /gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Label a card shows in the picker. Contributions carry their own localized
 * table; the legacy keys cover card ids that shipped with core i18n entries
 * before the plugin platform.
 */
const LEGACY_TEMPLATE_LABEL_KEYS: Record<string, TranslationKey> = {
  plain: "share.template.plain",
  daily: "share.template.daily",
  ticket: "share.template.ticket",
};

function useDarkMode() {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, {
      attributeFilter: ["class"],
      attributes: true,
    });
    return () => observer.disconnect();
  }, []);
  return dark;
}

function resolveCardLabel(
  card: ShareCardView,
  locale: string,
  t: (key: TranslationKey) => string,
): string {
  const localized =
    card.name[locale] ?? card.name["en-US"] ?? Object.values(card.name)[0];
  if (localized) return localized;
  const legacyKey = LEGACY_TEMPLATE_LABEL_KEYS[card.id];
  return legacyKey ? t(legacyKey) : card.id;
}

export function ShareImageDialog({
  memo,
  open,
  onOpenChange,
}: ShareImageDialogProps) {
  const { locale, t } = useI18n();
  const branding = useBranding();
  const dark = useDarkMode();
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const sandboxRef = useRef<ShareCardSandboxHandle>(null);
  const [timeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const statsQuery = useQuery({
    queryKey: ["memo-stats", timeZone, "all"],
    queryFn: () => getMemoStats(timeZone),
    enabled: open,
    staleTime: 60_000,
  });
  // Instance plugin configuration drives the picker; the dialog renders the
  // bundled defaults immediately and swaps to the configured set when the
  // public endpoint responds, so opening the dialog never blocks on a fetch.
  const pluginsQuery = useQuery({
    queryKey: ["plugin-settings"],
    queryFn: getPublicPluginSettings,
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const cards = useMemo(
    () => visibleCardViews(pluginsQuery.data ?? null),
    [pluginsQuery.data],
  );

  // The active card can disappear when the template list changes (plugin
  // disabled or hidden); fall back to the instance default, then the first.
  const configuredDefault = pluginsQuery.data?.cards.default ?? null;
  const defaultCard =
    (configuredDefault &&
      cards.find((candidate) => candidate.id === configuredDefault)?.id) ||
    cards[0]?.id ||
    null;
  const card =
    (templateId && cards.find((candidate) => candidate.id === templateId)) ||
    cards.find((candidate) => candidate.id === defaultCard) ||
    cards[0];

  // Bundled payloads are already in memory; installed ones load per
  // selection and cache by (plugin, version, card).
  const payloadQuery = useQuery({
    queryKey: [
      "plugin-card-payload",
      card?.pluginId ?? "",
      card?.pluginVersion ?? "",
      card?.id ?? "",
    ],
    queryFn: () => loadCardPayload(card as ShareCardView),
    enabled: open && !!card,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const payload = payloadQuery.data ?? null;

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

  const cardData = useMemo(
    () => ({
      body,
      date,
      day,
      stats,
      locale,
      brand: {
        product: branding.product,
        markLight: branding.markLightUrl,
        markDark: branding.markDarkUrl,
      },
    }),
    [body, branding, date, day, locale, stats],
  );

  const optionValues = useMemo(
    () =>
      resolveOptionValues(
        card?.options,
        card ? pluginsQuery.data?.cards.options?.[card.id] : undefined,
      ),
    [card, pluginsQuery.data],
  );

  const exportImage = async () => {
    if (!card || !payload) return;
    setIsExporting(true);
    try {
      let dataUrl: string | null = null;
      if (payload.kind === "sandbox") {
        dataUrl = (await sandboxRef.current?.exportPng()) ?? null;
        if (!dataUrl) toast.error(t("share.exportFailed"));
      } else {
        const targetNode = exportRef.current || previewRef.current;
        if (targetNode) {
          try {
            await document.fonts?.ready;
          } catch {
            // ignore font load errors
          }
          const width = Math.ceil(
            targetNode.scrollWidth || targetNode.offsetWidth || size.width,
          );
          const height = Math.ceil(
            targetNode.scrollHeight || targetNode.offsetHeight || size.height,
          );
          dataUrl = await toPng(targetNode, {
            pixelRatio: 2,
            width,
            height,
            cacheBust: true,
            style: {
              position: "static",
              left: "0",
              top: "0",
              transform: "none",
            },
          });
        }
      }
      if (!dataUrl) return;
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

  const size = card?.size ?? { width: 340, height: 420 };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t("share.imageTitle")}</DialogTitle>
          <DialogDescription>{t("share.imageSubtitle")}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-center py-1 max-h-[60vh] overflow-y-auto [scrollbar-width:thin] [scrollbar-color:theme(colors.muted.foreground/30)_transparent]">
          {payload?.kind === "document" && (
            <div ref={previewRef} className="rounded-lg shadow-sm">
              <ShareCardDocumentView
                context={{
                  data: cardData,
                  options: optionValues,
                  mode: dark ? "dark" : "light",
                }}
                document={payload.document}
                height={size.height}
                mode={dark ? "dark" : "light"}
                width={size.width}
              />
            </div>
          )}
          {payload?.kind === "sandbox" && (
            <ShareCardSandboxHost
              height={size.height}
              html={payload.html}
              payload={{
                data: cardData,
                mode: dark ? "dark" : "light",
                options: optionValues,
              }}
              ref={sandboxRef}
              width={size.width}
            />
          )}
          {!payload && (
            <div
              className="flex items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground"
              style={{ width: size.width, height: size.height }}
            >
              {payloadQuery.isError
                ? t("share.templateUnavailable")
                : t("share.loadingTemplate")}
            </div>
          )}
        </div>
        {payload?.kind === "document" && (
          <div
            aria-hidden="true"
            style={{
              position: "fixed",
              left: "-99999px",
              top: 0,
              pointerEvents: "none",
              zIndex: -9999,
            }}
          >
            <div
              ref={exportRef}
              style={{
                width: size.width,
                minHeight: size.height,
              }}
            >
              <ShareCardDocumentView
                context={{
                  data: cardData,
                  options: optionValues,
                  mode: dark ? "dark" : "light",
                }}
                document={payload.document}
                height={size.height}
                mode={dark ? "dark" : "light"}
                width={size.width}
              />
            </div>
          </div>
        )}
        <fieldset
          aria-label={t("share.templateLabel")}
          // One scrollable row: nine templates wrapped into 7 + 2 and left
          // an orphan line. Bleeds to the dialog edge so the scroll reads as
          // a strip, not a clipped box. min-w-0 overrides the fieldset default
          // (min-inline-size: min-content) that otherwise widens the dialog.
          className="no-scrollbar -mx-5 flex min-w-0 gap-1 overflow-x-auto border-0 px-5 py-0.5 [mask-image:linear-gradient(to_right,transparent,black_1.25rem,black_calc(100%-1.25rem),transparent)]"
        >
          {cards.map((item) => (
            <button
              aria-pressed={card?.id === item.id}
              className={cn(
                "shrink-0 rounded-full px-3 py-1 text-xs whitespace-nowrap motion-safe:transition-colors",
                card?.id === item.id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              key={item.id}
              type="button"
              onClick={() => setTemplateId(item.id)}
            >
              {resolveCardLabel(item, locale, t)}
            </button>
          ))}
        </fieldset>
        <DialogFooter>
          {/* The dialog has no corner close; this is the visible way out. */}
          <Button
            className="w-full sm:w-auto"
            onClick={() => onOpenChange(false)}
            type="button"
            variant="ghost"
          >
            {t("common.cancel")}
          </Button>
          <Button
            className="w-full sm:w-auto"
            disabled={
              isExporting ||
              statsQuery.isPending ||
              !card ||
              !payload ||
              payloadQuery.isError
            }
            onClick={() => void exportImage()}
            type="button"
            variant="brand"
          >
            {isExporting ? (
              <Spinner data-icon="inline-start" />
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
