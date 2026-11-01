import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRightIcon, ImageUpIcon, Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type AdminBranding,
  type BrandingAssetKind,
  type BrandingMarkVariant,
  clearAdminBrandingFavicon,
  clearAdminBrandingMark,
  getAdminBranding,
  updateAdminBrandingAccent,
  updateAdminBrandingProductName,
  uploadAdminBrandingFavicon,
  uploadAdminBrandingMark,
} from "@/api";
import { type BrandingAccent, setAccentAttribute } from "@/branding";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/i18n";
import { normalizeHexColor } from "@/lib/brand-ramp";
import { errorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { SettingsSectionGroup } from "../account/apple-settings-ui";
import {
  ACCENT_SWATCH_HEX,
  AccentPicker,
  accentSummaryLabel,
} from "./accent-picker";

const ACCEPTED_MARK_TYPES = "image/png,image/webp,image/svg+xml";
const ACCEPTED_FAVICON_TYPES =
  "image/png,image/webp,image/svg+xml,image/x-icon,image/vnd.microsoft.icon";

/**
 * Seed-color editor for the custom accent. Any valid 6-digit hex applies to
 * the whole page instantly (the derived ramp paints live); the PUT is
 * debounced, and closing the dialog flushes a valid unsaved draft.
 */
function CustomAccentDialog({
  draft,
  onDraftChange,
  onOpenChange,
  onSave,
  open,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onSave: (hex: string) => Promise<unknown>;
  open: boolean;
}) {
  const { t } = useI18n();
  const lastSavedRef = useRef<string | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  useEffect(() => {
    if (!open) return undefined;
    const hex = normalizeHexColor(draft);
    if (!hex) return undefined;
    // Live preview beats the network: repaint the whole page immediately,
    // persist on a debounce so typing never floods the API.
    setAccentAttribute("custom", hex);
    if (hex === lastSavedRef.current) return undefined;
    const timer = setTimeout(() => {
      lastSavedRef.current = hex;
      void saveRef.current(hex);
    }, 600);
    return () => clearTimeout(timer);
  }, [draft, open]);

  const flush = () => {
    const hex = normalizeHexColor(draftRef.current);
    if (hex && hex !== lastSavedRef.current) {
      lastSavedRef.current = hex;
      void onSave(hex);
    }
  };

  const valid = normalizeHexColor(draft);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) flush();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("admin.branding.accentCustom")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <input
              aria-label={t("admin.branding.accentPick")}
              className="size-12 shrink-0 cursor-pointer rounded-lg border bg-transparent p-1"
              type="color"
              value={valid ?? "#ff6a00"}
              onChange={(event) => onDraftChange(event.target.value)}
            />
            <Input
              aria-label={t("admin.branding.accentHex")}
              autoComplete="off"
              className="font-mono"
              placeholder="#7c3aed"
              spellCheck={false}
              value={draft}
              aria-invalid={draft.length > 0 && !valid}
              onChange={(event) => onDraftChange(event.target.value)}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            {valid
              ? t("admin.branding.accentHint")
              : t("admin.branding.accentHexHint")}
          </p>
        </div>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BrandingCard() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState("");
  const [productName, setProductName] = useState("");
  const lightInputRef = useRef<HTMLInputElement>(null);
  const darkInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);

  const brandingQuery = useQuery({
    queryKey: queryKeys.adminBranding,
    queryFn: getAdminBranding,
    retry: false,
  });

  useEffect(() => {
    if (brandingQuery.data) {
      setProductName(brandingQuery.data.product_name ?? "");
    }
  }, [brandingQuery.data]);

  const saveNameMutation = useMutation({
    mutationFn: () =>
      updateAdminBrandingProductName(productName.trim() || null),
    onSuccess: () => {
      toast.success(t("admin.branding.saved"));
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminBranding });
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("admin.branding.failed"))),
  });

  const saveAccentMutation = useMutation({
    mutationFn: ({
      accent,
      accentHex,
    }: {
      accent: BrandingAccent;
      accentHex?: string | null;
    }) => updateAdminBrandingAccent(accent, accentHex ?? null),
    onMutate: ({ accent, accentHex }) => {
      // Swatches are instant-apply: paint the choice while the PUT runs.
      setAccentAttribute(accent, accentHex ?? undefined);
    },
    onSuccess: (_data, { accent, accentHex }) => {
      queryClient.setQueryData<AdminBranding>(
        queryKeys.adminBranding,
        (current) =>
          current
            ? { ...current, accent, accent_hex: accentHex ?? null }
            : current,
      );
      setAccentAttribute(accent, accentHex ?? undefined);
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("admin.branding.failed"))),
  });

  const uploadMarkMutation = useMutation({
    mutationFn: ({
      variant,
      file,
    }: {
      variant: BrandingMarkVariant;
      file: File;
    }) => uploadAdminBrandingMark(variant, file),
    onSuccess: () => {
      toast.success(t("admin.branding.markUploaded"));
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminBranding });
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("admin.branding.failed"))),
  });

  const uploadFaviconMutation = useMutation({
    mutationFn: (file: File) => uploadAdminBrandingFavicon(file),
    onSuccess: () => {
      toast.success(t("admin.branding.faviconUploaded"));
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminBranding });
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("admin.branding.failed"))),
  });

  const clearMarkMutation = useMutation({
    mutationFn: (variant: BrandingMarkVariant) =>
      clearAdminBrandingMark(variant),
    onSuccess: () => {
      toast.success(t("admin.branding.markRemoved"));
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminBranding });
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("admin.branding.failed"))),
  });

  const clearFaviconMutation = useMutation({
    mutationFn: () => clearAdminBrandingFavicon(),
    onSuccess: () => {
      toast.success(t("admin.branding.faviconRemoved"));
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminBranding });
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("admin.branding.failed"))),
  });

  const handleFileChange = (
    kind: BrandingAssetKind,
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (kind === "favicon") {
      void uploadFaviconMutation.mutateAsync(file);
    } else {
      void uploadMarkMutation.mutateAsync({ variant: kind, file });
    }
  };

  const renderMarkRow = (
    kind: BrandingAssetKind,
    label: string,
    url: string | null,
    inputRef: React.RefObject<HTMLInputElement | null>,
  ) => (
    <div className="flex items-center gap-3">
      <div className="flex size-12 shrink-0 items-center justify-center rounded-lg border bg-muted/40 dark:bg-muted/20">
        {url ? (
          <img alt="" className="size-8 object-contain" src={url} />
        ) : (
          <ImageUpIcon className="size-4 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <div className="mt-1 flex gap-2">
          <input
            accept={
              kind === "favicon" ? ACCEPTED_FAVICON_TYPES : ACCEPTED_MARK_TYPES
            }
            className="hidden"
            ref={inputRef}
            type="file"
            onChange={(event) => handleFileChange(kind, event)}
          />
          <Button
            disabled={
              kind === "favicon"
                ? uploadFaviconMutation.isPending
                : uploadMarkMutation.isPending
            }
            size="sm"
            type="button"
            variant="outline"
            onClick={() => inputRef.current?.click()}
          >
            {url ? t("admin.branding.replace") : t("admin.branding.upload")}
          </Button>
          {url && (
            <Button
              disabled={
                kind === "favicon"
                  ? clearFaviconMutation.isPending
                  : clearMarkMutation.isPending
              }
              size="sm"
              type="button"
              variant="ghost"
              onClick={() =>
                kind === "favicon"
                  ? void clearFaviconMutation.mutateAsync()
                  : void clearMarkMutation.mutateAsync(kind)
              }
            >
              <Trash2Icon data-icon="inline-start" />
              {t("admin.branding.remove")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  // Laid out like every other settings pane: titled groups, no inner card
  // title repeating the pane header. Swatches apply instantly; the identity
  // row opens the logo/name editor (the old separate "Edit" button).
  return (
    <div className="flex flex-col gap-5">
      <SettingsSectionGroup title={t("admin.branding.accent")}>
        <div className="flex flex-wrap items-center gap-3 px-3.5 py-3">
          <AccentPicker
            customHex={brandingQuery.data?.accent_hex ?? null}
            disabled={saveAccentMutation.isPending}
            value={brandingQuery.data?.accent ?? "flame"}
            onSelect={(accent) => {
              if (accent === "custom") {
                setCustomDraft(
                  brandingQuery.data?.accent_hex ??
                    (brandingQuery.data?.accent
                      ? (ACCENT_SWATCH_HEX[
                          brandingQuery.data
                            .accent as keyof typeof ACCENT_SWATCH_HEX
                        ] ?? "#ff6a00")
                      : "#ff6a00"),
                );
                setCustomOpen(true);
                return;
              }
              void saveAccentMutation.mutateAsync({ accent });
            }}
          />
          <span className="text-muted-foreground text-sm">
            {accentSummaryLabel(
              brandingQuery.data?.accent,
              brandingQuery.data?.accent_hex,
              t,
            )}
          </span>
        </div>
      </SettingsSectionGroup>
      <SettingsSectionGroup title={t("admin.branding.identity")}>
        <button
          aria-label={`${t("common.edit")}: ${
            brandingQuery.data?.product_name ||
            t("admin.branding.statusDefault")
          }`}
          type="button"
          onClick={() => setEditOpen(true)}
          className="flex w-full cursor-pointer items-center gap-3 px-3.5 py-3 text-start transition-colors hover:bg-accent/40 active:bg-accent/60"
        >
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted/40 dark:bg-muted/20">
            {brandingQuery.data?.mark_dark_url ? (
              <img
                alt=""
                className="size-7 object-contain"
                src={brandingQuery.data.mark_dark_url}
              />
            ) : (
              <ImageUpIcon className="size-4 text-muted-foreground" />
            )}
          </div>
          <p className="min-w-0 flex-1 truncate text-sm">
            {brandingQuery.data?.product_name ||
              t("admin.branding.statusDefault")}
          </p>
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/50 rtl:rotate-180" />
        </button>
      </SettingsSectionGroup>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("admin.branding.title")}</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              saveNameMutation.mutate();
            }}
          >
            <label
              className="flex flex-col gap-1.5 text-sm font-medium"
              htmlFor="branding-product-name"
            >
              {t("admin.branding.productName")}
              <Input
                autoComplete="off"
                id="branding-product-name"
                maxLength={40}
                placeholder={t("admin.branding.productNamePlaceholder")}
                value={productName}
                onChange={(event) => setProductName(event.target.value)}
              />
            </label>
            <DialogFooter>
              <Button
                disabled={
                  saveNameMutation.isPending ||
                  productName.trim() ===
                    (brandingQuery.data?.product_name ?? "")
                }
                type="submit"
              >
                {saveNameMutation.isPending && (
                  <Spinner data-icon="inline-start" />
                )}
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
          <div className="flex flex-col gap-3 border-t pt-3">
            {renderMarkRow(
              "light",
              t("admin.branding.markLight"),
              brandingQuery.data?.mark_light_url ?? null,
              lightInputRef,
            )}
            {renderMarkRow(
              "dark",
              t("admin.branding.markDark"),
              brandingQuery.data?.mark_dark_url ?? null,
              darkInputRef,
            )}
            {renderMarkRow(
              "favicon",
              t("admin.branding.favicon"),
              brandingQuery.data?.favicon_url ?? null,
              faviconInputRef,
            )}
          </div>
        </DialogContent>
      </Dialog>
      <CustomAccentDialog
        draft={customDraft}
        onDraftChange={setCustomDraft}
        onOpenChange={setCustomOpen}
        open={customOpen}
        onSave={(hex) =>
          saveAccentMutation.mutateAsync({ accent: "custom", accentHex: hex })
        }
      />
    </div>
  );
}
