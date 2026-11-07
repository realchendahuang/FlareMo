import { Link } from "@tanstack/react-router";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { SiteMark } from "@/components/site-mark";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getLocalizedPath,
  getPathWithoutLocale,
  type Locale,
  normalizeLocale,
  type SupportedLocale,
} from "@/lib/seo";
import type { ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/utils";

type NavItem = {
  to: string;
  label: string;
};

type SiteNavProps = {
  locale: Locale;
  currentPath: string;
};

const NAV_LABELS: Record<
  SupportedLocale,
  {
    home: string;
    features: string;
    ecosystem: string;
    docs: string;
    deploy: string;
    cloudflare: string;
    signIn: string;
  }
> = {
  zh: {
    home: "首页",
    features: "特性",
    ecosystem: "生态",
    docs: "文档",
    deploy: "快速部署",
    cloudflare: "Cloudflare ↗",
    signIn: "进入控制台",
  },
  en: {
    home: "Home",
    features: "Features",
    ecosystem: "Ecosystem",
    docs: "Docs",
    deploy: "Deploy",
    cloudflare: "Cloudflare ↗",
    signIn: "Console",
  },
  ja: {
    home: "ホーム",
    features: "特徴",
    ecosystem: "エコシステム",
    docs: "ドキュメント",
    deploy: "デプロイ",
    cloudflare: "Cloudflare ↗",
    signIn: "コンソール",
  },
  fr: {
    home: "Accueil",
    features: "Fonctions",
    ecosystem: "Écosystème",
    docs: "Docs",
    deploy: "Déployer",
    cloudflare: "Cloudflare ↗",
    signIn: "Console",
  },
  es: {
    home: "Inicio",
    features: "Funciones",
    ecosystem: "Ecosistema",
    docs: "Docs",
    deploy: "Desplegar",
    cloudflare: "Cloudflare ↗",
    signIn: "Consola",
  },
  ko: {
    home: "홈",
    features: "기능",
    ecosystem: "생태계",
    docs: "문서",
    deploy: "배포",
    cloudflare: "Cloudflare ↗",
    signIn: "콘솔",
  },
  ru: {
    home: "Главная",
    features: "Возможности",
    ecosystem: "Экосистема",
    docs: "Документация",
    deploy: "Развернуть",
    cloudflare: "Cloudflare ↗",
    signIn: "Консоль",
  },
  ar: {
    home: "الرئيسية",
    features: "المميزات",
    ecosystem: "المنظومة",
    docs: "المستندات",
    deploy: "النشر",
    cloudflare: "Cloudflare ↗",
    signIn: "لوحة التحكم",
  },
};

const THEME_OPTIONS: Array<{
  mode: ThemeMode;
  label: string;
  icon: typeof Sun;
}> = [
  { mode: "light", label: "浅色模式 / Light", icon: Sun },
  { mode: "dark", label: "深色模式 / Dark", icon: Moon },
  { mode: "system", label: "跟随系统 / System", icon: Monitor },
];

function ThemeToggle({ className }: { className?: string }) {
  const { mode, setMode } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        aria-label="切换主题 / Switch theme"
        className={cn(
          "inline-flex size-8 items-center justify-center text-mist transition-colors hover:bg-wash hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50 focus-visible:ring-offset-2 focus-visible:ring-offset-paper cursor-pointer",
          className,
        )}
      >
        {mode === "light" && <Sun className="size-3.5 text-amber-500" />}
        {mode === "dark" && <Moon className="size-3.5 text-signal" />}
        {mode === "system" && <Monitor className="size-3.5 text-mist" />}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-40 p-1.5">
        <DropdownMenuLabel className="px-2 py-1 text-xs text-fog font-medium">
          外观 / Theme
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {THEME_OPTIONS.map((opt) => {
          const isSelected = mode === opt.mode;
          const Icon = opt.icon;
          return (
            <DropdownMenuItem
              key={opt.mode}
              onClick={() => setMode(opt.mode)}
              className="flex items-center justify-between px-2.5 py-1.5 text-xs cursor-pointer rounded-lg hover:bg-wash focus:bg-wash"
            >
              <div className="flex items-center gap-2">
                <Icon
                  className={cn(
                    "size-3.5",
                    opt.mode === "light" && "text-amber-500",
                    opt.mode === "dark" && "text-signal",
                    opt.mode === "system" && "text-mist",
                  )}
                />
                <span
                  className={
                    isSelected ? "font-bold text-signal-ink" : "text-ink"
                  }
                >
                  {opt.label.split(" / ")[0]}
                </span>
              </div>
              {isSelected && (
                <Check className="size-3.5 text-signal shrink-0" />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn("fill-current", className)}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  );
}

function CloudflareIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn("fill-current", className)}
    >
      <path d="M19.462 10.379c-.198-3.08-2.736-5.516-5.84-5.516-2.52 0-4.686 1.606-5.534 3.864a4.428 4.428 0 0 0-1.748-.357c-2.392 0-4.34 1.905-4.34 4.254 0 .341.042.673.12 1.002A4.27 4.27 0 0 0 0 17.653c0 2.373 1.956 4.301 4.354 4.301h15.228C21.936 21.954 24 19.92 24 17.433c0-2.434-1.972-4.43-4.538-4.508v-.031c0-.853-.133-1.68-.415-2.515z" />
    </svg>
  );
}

export function SiteNav({ locale, currentPath }: SiteNavProps) {
  const norm = normalizeLocale(locale);
  const labels = NAV_LABELS[norm];
  const homePath = getLocalizedPath("/", norm);
  const docsPath = getLocalizedPath("/docs", norm);
  const deployPath = getLocalizedPath("/docs/deploy", norm);

  const [currentHash, setCurrentHash] = useState(
    typeof window !== "undefined" ? window.location.hash : "",
  );

  useEffect(() => {
    const onHashChange = () => setCurrentHash(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const items: NavItem[] = [
    { to: homePath, label: labels.home },
    { to: `${homePath}#features`, label: labels.features },
    { to: `${homePath}#ecosystem`, label: labels.ecosystem },
    { to: docsPath, label: labels.docs },
    { to: deployPath, label: labels.deploy },
  ];
  // 只让"最具体"的那一项高亮：/docs/deploy 不再同时点亮 Docs 与 Deploy。
  const activeIndex = resolveActiveNavIndex(items, currentPath, currentHash);

  return (
    <>
      {/* 顶栏常驻；移动端二级导航跟随内容滚动，避免吃掉首屏高度 */}
      <div className="sticky top-0 z-40 border-b border-line/60 bg-paper/85 backdrop-blur-md transition-colors duration-200">
        <div className="container-x relative flex h-14 items-center justify-between gap-4">
          {/* 左翼：品牌 Logo */}
          <div className="flex items-center justify-start shrink-0">
            <Link
              aria-label="FlareMo home"
              className="flex items-center gap-2 text-ink transition-opacity hover:opacity-85"
              to={homePath}
            >
              <SiteMark iconSize="size-6" />
            </Link>
          </div>

          {/* 中翼：绝对 50% 物理居中，无论左右宽度如何，永远死死居中于视口中心 */}
          <div className="hidden lg:flex absolute left-1/2 -translate-x-1/2 pointer-events-auto">
            <nav className="flex items-center justify-center gap-0.5 rounded-full border border-line/60 bg-soft-surface/80 p-1 shadow-2xs">
              {items.map((item, index) => {
                const active = index === activeIndex;
                return (
                  <a
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-semibold transition-all duration-150 whitespace-nowrap",
                      active
                        ? "bg-surface text-ink shadow-[var(--panel-elev)] font-bold"
                        : "text-mist hover:text-ink hover:bg-wash",
                    )}
                    key={item.to}
                    href={item.to}
                  >
                    {item.label}
                  </a>
                );
              })}
            </nav>
          </div>

          {/* 右翼：统一右对齐工具集群与动作 */}
          <div className="flex items-center justify-end gap-2 shrink-0">
            {/* 联锁工具胶囊：GitHub + 语言切换 + 主题外观，紧凑防溢出 */}
            <div className="inline-flex h-8 items-center rounded-full border border-line/70 bg-surface/90 shadow-2xs divide-x divide-line/60">
              {/* GitHub 按钮 */}
              <a
                aria-label="GitHub source repository"
                className="inline-flex h-full items-center justify-center px-2.5 text-xs font-medium text-ink transition-colors hover:bg-wash first:rounded-s-full"
                href="https://github.com/realchendahuang/FlareMo"
                rel="noopener noreferrer"
                target="_blank"
                title="GitHub 源码仓库 (realchendahuang/FlareMo)"
              >
                <GithubIcon className="size-3.5" />
              </a>

              {/* 国际化语言切换 (使用 short 简短标签) */}
              <LocaleSwitcher
                locale={norm}
                path={currentPath}
                short={true}
                className="inline-flex h-full items-center gap-1 border-none rounded-none bg-transparent px-2.5 text-xs font-medium text-ink shadow-none transition-colors hover:bg-wash hover:border-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50 focus-visible:ring-offset-2 focus-visible:ring-offset-paper cursor-pointer"
              />

              {/* 外观模式切换 (嵌入胶囊) */}
              <ThemeToggle className="inline-flex h-full w-8 items-center justify-center border-none rounded-none text-mist transition-colors hover:bg-wash hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50 focus-visible:ring-offset-2 focus-visible:ring-offset-paper last:rounded-e-full cursor-pointer" />
            </div>

            {/* Cloudflare 注册快捷外链 (超宽屏幕 2xl 上显示，小桌面优雅隐藏防止挤压) */}
            <a
              className="hidden 2xl:inline-flex h-8 items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 dark:border-amber-400/30 dark:bg-amber-400/10 px-2.5 text-xs font-semibold text-amber-600 dark:text-amber-400 shadow-2xs transition-colors hover:bg-amber-500/20 hover:border-amber-500/50 shrink-0"
              href="https://dash.cloudflare.com/sign-up?utm_source=flaremo"
              rel="noopener noreferrer"
              target="_blank"
              title="Cloudflare 官方免费注册 / Sign up for free Cloudflare account"
            >
              <CloudflareIcon className="size-3.5 text-amber-500" />
              <span>{labels.cloudflare}</span>
            </a>

            {/* 快速进入应用主 CTA */}
            <Button
              render={
                <a href="https://app.flaremo.app" rel="noopener noreferrer" />
              }
              size="xs"
              variant="flame"
              className="h-8 px-3.5 rounded-full shadow-xs shrink-0 font-semibold text-xs"
            >
              {labels.signIn}
            </Button>
          </div>
        </div>
      </div>

      {/* 移动端与平板快捷导航横向滚动条（跟随内容滚动，不常驻） */}
      <div className="container-x flex gap-1.5 overflow-x-auto border-b border-line/50 bg-paper/70 py-1.5 lg:hidden no-scrollbar">
        {items.map((item, index) => {
          const active = index === activeIndex;
          return (
            <a
              aria-current={active ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-full px-3 py-0.5 text-xs font-semibold transition-colors",
                active
                  ? "bg-surface text-ink shadow-xs border border-line/60"
                  : "text-mist hover:bg-soft-surface hover:text-ink",
              )}
              key={item.to}
              href={item.to}
            >
              {item.label}
            </a>
          );
        })}
      </div>
    </>
  );
}

/**
 * Scores every nav item against the current path and returns the index of the
 * most specific match. Exact paths beat prefixes, and the longest prefix wins,
 * so `/docs/deploy` activates Deploy alone instead of Docs and Deploy together.
 */
function resolveActiveNavIndex(
  items: NavItem[],
  currentPath: string,
  currentHash: string,
): number {
  const normCurrent = getPathWithoutLocale(currentPath);
  let bestIndex = -1;
  let bestScore = -1;

  items.forEach((item, index) => {
    const score = navItemScore(normCurrent, currentHash, item.to);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function navItemScore(
  currentPath: string,
  currentHash: string,
  itemTo: string,
): number {
  const [itemPath, itemAnchor] = itemTo.split("#");
  const normItemPath = getPathWithoutLocale(itemPath || "/");

  // In-page anchors only win when the hash actually matches.
  if (itemAnchor) {
    return currentPath === normItemPath && currentHash === `#${itemAnchor}`
      ? 1000 + normItemPath.length
      : -1;
  }

  if (normItemPath === "/") {
    return currentPath === "/" && !currentHash ? 0 : -1;
  }

  if (currentPath === normItemPath) {
    return 500 + normItemPath.length;
  }

  if (currentPath.startsWith(`${normItemPath}/`)) {
    return 100 + normItemPath.length;
  }

  return -1;
}
