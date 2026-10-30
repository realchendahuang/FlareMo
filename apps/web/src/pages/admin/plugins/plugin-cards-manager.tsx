import {
  ArrowDownIcon,
  ArrowUpIcon,
  EyeIcon,
  EyeOffIcon,
  StarIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { SettingsSectionGroup } from "../../account/apple-settings-ui";
import { localized } from "./plugin-row";
import type { PluginSettingsState } from "./use-plugin-settings";

/** Per-card controls: order, default, visibility and the card's own options. */
export function PluginCardsManager({
  cardRows,
  busy,
  moveCard,
  toggleHidden,
  setDefault,
  setOption,
  locale,
}: {
  cardRows: PluginSettingsState["cardRows"];
  busy: boolean;
  moveCard: PluginSettingsState["moveCard"];
  toggleHidden: PluginSettingsState["toggleHidden"];
  setDefault: PluginSettingsState["setDefault"];
  setOption: PluginSettingsState["setOption"];
  locale: string;
}) {
  const { t } = useI18n();
  return (
    <SettingsSectionGroup title={t("admin.plugins.cards")}>
      {cardRows.map((row) => (
        <div
          className={cn(
            "flex flex-col gap-3 px-3.5 py-2.5",
            !row.reachable && "opacity-60",
          )}
          key={row.id}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium">
                  {localized(row.name, locale, row.id)}
                </p>
                <Badge variant="outline">
                  {t(
                    row.kind === "sandbox"
                      ? "admin.plugins.kindSandbox"
                      : "admin.plugins.kindDocument",
                  )}
                </Badge>
                {row.isDefault && (
                  <Badge>{t("admin.plugins.defaultBadge")}</Badge>
                )}
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {row.pluginName}
                {!row.reachable && ` · ${t("admin.plugins.pluginOff")}`}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                aria-label={t("admin.plugins.moveUp")}
                disabled={busy || row.hidden || row.visibleIndex <= 0}
                size="icon-sm"
                type="button"
                variant="ghost"
                onClick={() => moveCard(row.id, -1)}
              >
                <ArrowUpIcon />
              </Button>
              <Button
                aria-label={t("admin.plugins.moveDown")}
                disabled={
                  busy ||
                  row.hidden ||
                  row.visibleIndex === -1 ||
                  row.visibleIndex >= row.visibleCount - 1
                }
                size="icon-sm"
                type="button"
                variant="ghost"
                onClick={() => moveCard(row.id, 1)}
              >
                <ArrowDownIcon />
              </Button>
              <Button
                aria-label={t("admin.plugins.setDefault")}
                disabled={busy || row.hidden}
                size="icon-sm"
                type="button"
                variant={row.isDefault ? "secondary" : "ghost"}
                onClick={() => setDefault(row.id)}
              >
                <StarIcon />
              </Button>
              <Button
                aria-label={
                  row.hidden ? t("admin.plugins.show") : t("admin.plugins.hide")
                }
                disabled={busy}
                size="icon-sm"
                type="button"
                variant="ghost"
                onClick={() => toggleHidden(row.id)}
              >
                {row.hidden ? <EyeOffIcon /> : <EyeIcon />}
              </Button>
            </div>
          </div>
          {row.optionSpecs.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-border/40 pt-3">
              {row.optionSpecs.map((spec) => {
                const value = row.options[spec.key];
                return (
                  <div
                    className="flex items-center justify-between gap-3"
                    key={spec.key}
                  >
                    <span className="text-xs text-muted-foreground">
                      {localized(spec.label, locale, spec.key)}
                    </span>
                    {spec.type === "boolean" && (
                      <Switch
                        checked={value === true}
                        disabled={busy}
                        onCheckedChange={(checked) =>
                          setOption(row.id, spec.key, checked)
                        }
                      />
                    )}
                    {spec.type === "text" && (
                      <Input
                        className="h-7 w-44"
                        disabled={busy}
                        maxLength={spec.maxLength ?? 500}
                        value={typeof value === "string" ? value : ""}
                        onChange={(event) =>
                          setOption(row.id, spec.key, event.target.value)
                        }
                      />
                    )}
                    {spec.type === "color" && (
                      <input
                        className="size-7 cursor-pointer rounded border bg-transparent"
                        disabled={busy}
                        type="color"
                        value={typeof value === "string" ? value : "#000000"}
                        onChange={(event) =>
                          setOption(row.id, spec.key, event.target.value)
                        }
                      />
                    )}
                    {spec.type === "number" && (
                      <Input
                        className="h-7 w-24"
                        disabled={busy}
                        max={spec.max}
                        min={spec.min}
                        step={spec.step}
                        type="number"
                        value={typeof value === "number" ? value : 0}
                        onChange={(event) =>
                          setOption(
                            row.id,
                            spec.key,
                            Number(event.target.value),
                          )
                        }
                      />
                    )}
                    {spec.type === "enum" && (
                      <select
                        className="h-7 rounded-md border bg-transparent px-2 text-xs"
                        disabled={busy}
                        value={typeof value === "string" ? value : ""}
                        onChange={(event) =>
                          setOption(row.id, spec.key, event.target.value)
                        }
                      >
                        {spec.choices.map((choice) => (
                          <option key={choice.value} value={choice.value}>
                            {localized(choice.label, locale, choice.value)}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </SettingsSectionGroup>
  );
}
