import { CheckIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { type Theme, useTheme } from "@/components/theme-provider";
import type { TranslationKey, TranslationParams } from "@/i18n";
import { cn } from "@/lib/utils";
import { SettingsSectionGroup } from "./apple-settings-ui";

type AppearancePanelProps = {
  t: (key: TranslationKey, params?: TranslationParams) => string;
};

export function AppearancePanel({ t }: AppearancePanelProps) {
  const { theme, setTheme } = useTheme();

  const themes: {
    id: Theme;
    label: string;
    description: string;
    icon: typeof SunIcon;
  }[] = [
    {
      id: "system",
      label: t("theme.system"),
      description: t("theme.systemDescription"),
      icon: MonitorIcon,
    },
    {
      id: "light",
      label: t("theme.light"),
      description: t("theme.lightDescription"),
      icon: SunIcon,
    },
    {
      id: "dark",
      label: t("theme.dark"),
      description: t("theme.darkDescription"),
      icon: MoonIcon,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
        {themes.map((item) => {
          const active = theme === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTheme(item.id)}
              className={cn(
                "group relative flex cursor-pointer flex-col items-center rounded-xl border p-2.5 text-center transition-[border-color,background-color,box-shadow] sm:p-4",
                active
                  ? "border-primary bg-card ring-1 ring-primary/30 shadow-xs"
                  : "border-border/60 bg-card hover:border-border hover:bg-accent/40",
              )}
            >
              {/* Preview Box */}
              <div
                className={cn(
                  "relative mb-2.5 flex h-14 w-full items-center justify-center overflow-hidden rounded-lg border text-xs shadow-2xs sm:mb-3 sm:h-20",
                  item.id === "light" &&
                    "border-border/80 bg-[#faf9f7] text-[#1f1d1a]",
                  item.id === "dark" &&
                    "border-border/40 bg-[#0d0c0b] text-[#edece9]",
                  item.id === "system" &&
                    "border-border/60 bg-gradient-to-r from-[#faf9f7] from-50% to-[#0d0c0b] to-50%",
                )}
              >
                {/* Visual miniature layout */}
                <div
                  className={cn(
                    "flex flex-col items-center gap-1.5",
                    item.id === "system" && "drop-shadow-sm",
                  )}
                >
                  <div
                    className={cn(
                      "flex size-8 items-center justify-center rounded-full border shadow-2xs",
                      item.id === "light" &&
                        "border-amber-200 bg-amber-50 text-amber-600",
                      item.id === "dark" &&
                        "border-slate-700 bg-slate-800 text-slate-200",
                      item.id === "system" &&
                        "border-border/60 bg-background/90 text-foreground backdrop-blur-xs",
                    )}
                  >
                    <Icon className="size-4" />
                  </div>
                </div>

                {active && (
                  <div className="absolute top-2 right-2 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xs">
                    <CheckIcon className="size-3 stroke-[2.5]" />
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1.5 font-medium text-xs text-foreground">
                <span>{item.label}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* A keyboard shortcut means nothing on a touch screen. */}
      <SettingsSectionGroup
        className="hidden sm:flex"
        title={t("theme.previewDetails")}
      >
        <div className="flex items-center justify-between px-4 py-3 text-xs">
          <span className="text-muted-foreground">
            {t("theme.shortcutTip")}
          </span>
          <kbd className="inline-flex h-5 items-center rounded border border-border/80 bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
            D
          </kbd>
        </div>
      </SettingsSectionGroup>
    </div>
  );
}
