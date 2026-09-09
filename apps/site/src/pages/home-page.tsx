import { useLocation } from "@tanstack/react-router";
import {
  ArrowLeftRight,
  ArrowRight,
  Bot,
  Database,
  Gift,
  Image as ImageIcon,
  KeyRound,
  ServerOff,
  ShieldCheck,
  WifiOff,
} from "lucide-react";
import { getHomeContent } from "@/content/copy";
import type { Locale } from "@/lib/seo";

const HERO_STAT_ICONS = [Database, ImageIcon, ServerOff];
const FEATURE_ICONS = [
  ShieldCheck,
  Gift,
  WifiOff,
  Bot,
  ArrowLeftRight,
  KeyRound,
];

export function HomePage() {
  const { pathname } = useLocation();
  const locale: Locale = pathname.startsWith("/en") ? "en-US" : "zh-CN";
  const home = getHomeContent(locale);

  return (
    <main>
      <Hero
        locale={locale}
        eyebrow={home.heroEyebrow}
        title={home.heroTitle}
        primary={home.primaryCta}
        icons={HERO_STAT_ICONS}
      />
      <Features
        heading={home.featuresHeading}
        items={home.features}
        icons={FEATURE_ICONS}
      />
      <Comparison
        heading={home.comparisonHeading}
        rows={home.comparisonRows}
        locale={locale}
      />
      <Screenshots heading={home.screenshotsHeading} />
      <Faq heading={home.faqHeading} items={home.faqItems} />
    </main>
  );
}

function Hero({
  locale,
  eyebrow,
  title,
  primary,
  icons,
}: {
  locale: Locale;
  eyebrow: string;
  title: string;
  primary: string;
  icons: typeof HERO_STAT_ICONS;
}) {
  const [Icon1, Icon2, Icon3] = icons;
  return (
    <section className="relative overflow-hidden border-b border-border/60 bg-gradient-to-b from-background via-background to-flame-50/40">
      <div className="container-x grid gap-10 py-20 md:grid-cols-[1.2fr_1fr] md:py-28">
        <div className="space-y-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
            <span className="size-1.5 rounded-full bg-flame-500" />
            {eyebrow}
          </span>
          <h1 className="text-balance text-4xl font-semibold tracking-tight md:text-6xl">
            {title}
          </h1>
          <div className="flex flex-wrap gap-3">
            <a
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-gradient px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-md transition-all hover:brightness-105 motion-safe:duration-200"
              href={locale === "zh-CN" ? "/docs/deploy" : "/en/docs/deploy"}
            >
              {primary}
              <ArrowRight className="size-4" />
            </a>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <HeroStat
            icon={<Icon1 className="size-5 text-flame-500" />}
            title="5 GB"
            body={locale === "zh-CN" ? "约 250 万条笔记" : "~2.5M notes"}
          />
          <HeroStat
            icon={<Icon2 className="size-5 text-flame-500" />}
            title="10 GB"
            body={locale === "zh-CN" ? "1 万张图片" : "~10k photos"}
          />
          <HeroStat
            icon={<Icon3 className="size-5 text-flame-500" />}
            title={locale === "zh-CN" ? "0 服务器" : "0 servers"}
            body={locale === "zh-CN" ? "7×24 在线" : "Online 24/7"}
          />
        </div>
      </div>
    </section>
  );
}

function HeroStat({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background p-4 shadow-sm">
      <div className="mb-3 flex size-9 items-center justify-center rounded-xl bg-accent">
        {icon}
      </div>
      <div className="text-base font-semibold tracking-tight">{title}</div>
      <div className="text-sm text-muted-foreground">{body}</div>
    </div>
  );
}

function Features({
  heading,
  items,
  icons,
}: {
  heading: string;
  items: Array<{ title: string; description: string }>;
  icons: typeof FEATURE_ICONS;
}) {
  return (
    <section className="border-b border-border/60 bg-background py-20">
      <div className="container-x space-y-10">
        <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
          {heading}
        </h2>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {items.map((item, idx) => {
            const Icon = icons[idx] ?? Bot;
            return (
              <article
                className="group rounded-2xl border border-border/60 bg-card p-6 shadow-xs transition-shadow hover:shadow-md"
                key={item.title}
              >
                <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-accent text-flame-500">
                  <Icon className="size-5" />
                </div>
                <h3 className="text-base font-semibold tracking-tight">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {item.description}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Comparison({
  heading,
  rows,
  locale,
}: {
  heading: string;
  rows: Array<{ label: string; cloudflare: string; nas: string; vps: string }>;
  locale: Locale;
}) {
  return (
    <section className="border-b border-border/60 bg-secondary/30 py-20">
      <div className="container-x space-y-8">
        <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
          {heading}
        </h2>
        <div className="overflow-x-auto rounded-2xl border border-border/60 bg-background shadow-xs">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 font-medium"> </th>
                <th className="px-4 py-3 font-medium text-flame-600">
                  Cloudflare
                </th>
                <th className="px-4 py-3 font-medium">
                  {locale === "zh-CN" ? "家用 NAS" : "Home NAS"}
                </th>
                <th className="px-4 py-3 font-medium">VPS</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr className="border-t border-border/60" key={row.label}>
                  <th className="px-4 py-3 text-left align-top font-medium">
                    {row.label}
                  </th>
                  <td className="px-4 py-3 align-top text-foreground">
                    {row.cloudflare}
                  </td>
                  <td className="px-4 py-3 align-top text-muted-foreground">
                    {row.nas}
                  </td>
                  <td className="px-4 py-3 align-top text-muted-foreground">
                    {row.vps}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Screenshots({ heading }: { heading: string }) {
  return (
    <section className="border-b border-border/60 bg-background py-20">
      <div className="container-x space-y-8">
        <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
          {heading}
        </h2>
        <div className="flex flex-wrap items-end justify-center gap-8 rounded-3xl border border-border/60 bg-gradient-to-br from-background via-background to-flame-50/30 p-8 shadow-xs">
          <img
            alt="FlareMo desktop timeline screenshot"
            className="w-full max-w-2xl rounded-2xl border border-border/60 shadow-md"
            decoding="async"
            height="1040"
            loading="lazy"
            src="/docs-assets/flaremo-desktop.png"
            width="1440"
          />
          <img
            alt="FlareMo mobile timeline screenshot"
            className="w-40 rounded-2xl border border-border/60 shadow-md"
            decoding="async"
            height="844"
            loading="lazy"
            src="/docs-assets/flaremo-mobile.png"
            width="390"
          />
        </div>
      </div>
    </section>
  );
}

function Faq({
  heading,
  items,
}: {
  heading: string;
  items: Array<{ q: string; a: string }>;
}) {
  return (
    <section className="bg-background py-20">
      <div className="container-x space-y-8">
        <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
          {heading}
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((item) => (
            <details
              className="group rounded-2xl border border-border/60 bg-card p-5 shadow-xs open:shadow-md [&_summary::-webkit-details-marker]:hidden"
              key={item.q}
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-base font-semibold tracking-tight">
                {item.q}
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-flame-500 transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
