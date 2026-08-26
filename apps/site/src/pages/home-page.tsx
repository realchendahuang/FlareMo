import { useLocation } from "@tanstack/react-router";
import { ShieldCheck, Sparkles, Cloud, Languages, Bot, Share2 } from "lucide-react";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { DeployButton, DEPLOY_BUTTON_URL } from "@/components/deploy-button";
import { getHomeContent } from "@/content/copy";
import { getPricingTiers } from "@/content/pricing";
import type { Locale } from "@/lib/seo";

const ZH_HERO_LUCIDE = [Cloud, Languages, Bot];
const EN_HERO_LUCIDE = ZH_HERO_LUCIDE;

const ZH_FEATURE_LUCIDE = [Cloud, ShieldCheck, Sparkles, Bot, Sparkles, Share2];
const EN_FEATURE_LUCIDE = ZH_FEATURE_LUCIDE;

export function HomePage() {
  const { pathname } = useLocation();
  const locale: Locale = pathname.startsWith("/en") ? "en-US" : "zh-CN";
  const home = getHomeContent(locale);
  const tiers = getPricingTiers(locale);
  const featureIcons = locale === "zh-CN" ? ZH_FEATURE_LUCIDE : EN_FEATURE_LUCIDE;
  const heroIcons = locale === "zh-CN" ? ZH_HERO_LUCIDE : EN_HERO_LUCIDE;

  return (
    <>
      <SiteNav currentPath={pathname} locale={locale} />
      <main>
        <Hero
          locale={locale}
          eyebrow={home.heroEyebrow}
          title={home.heroTitle}
          subtitle={home.heroSubtitle}
          primary={home.primaryCta}
          secondary={home.secondaryCta}
          icons={heroIcons}
        />
        <Features heading={home.featuresHeading} items={home.features} icons={featureIcons} />
        <Comparison
          heading={home.comparisonHeading}
          intro={home.comparisonIntro}
          rows={home.comparisonRows}
          locale={locale}
        />
        <Screenshots heading={home.screenshotsHeading} caption={home.screenshotsCaption} />
        <PricingSummary
          heading={home.pricingHeading}
          subtitle={home.pricingSubtitle}
          tiers={tiers}
          locale={locale}
        />
        <Faq heading={home.faqHeading} items={home.faqItems} />
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}

function Hero({
  locale,
  eyebrow,
  title,
  subtitle,
  primary,
  secondary,
  icons,
}: {
  locale: Locale;
  eyebrow: string;
  title: string;
  subtitle: string;
  primary: string;
  secondary: string;
  icons: typeof ZH_HERO_LUCIDE;
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
          <h1 className="text-balance text-4xl font-semibold tracking-tight md:text-5xl">
            {title}
          </h1>
          <p className="max-w-xl text-pretty text-lg leading-7 text-muted-foreground">
            {subtitle}
          </p>
          <div className="flex flex-wrap gap-3">
            <DeployButton href={DEPLOY_BUTTON_URL}>{primary}</DeployButton>
            <DeployButton href={locale === "zh-CN" ? "/hosted" : "/en/hosted"} variant="secondary">
              {secondary}
            </DeployButton>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <HeroStat
            icon={<Icon1 className="size-5 text-flame-500" />}
            title="5 GB D1"
            body={locale === "zh-CN" ? "约 250 万条笔记" : "~2.5M notes"}
          />
          <HeroStat
            icon={<Icon2 className="size-5 text-flame-500" />}
            title="10 GB R2"
            body={locale === "zh-CN" ? "5,000–10,000 张图片" : "5,000–10,000 photos"}
          />
          <HeroStat
            icon={<Icon3 className="size-5 text-flame-500" />}
            title={locale === "zh-CN" ? "0 服务器" : "0 servers"}
            body={locale === "zh-CN" ? "全球边缘节点" : "Global edge network"}
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
      <div className="mb-3 flex size-9 items-center justify-center rounded-xl bg-accent">{icon}</div>
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
  icons: typeof ZH_FEATURE_LUCIDE;
}) {
  return (
    <section className="border-b border-border/60 bg-background py-20">
      <div className="container-x space-y-10">
        <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">{heading}</h2>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {items.map((item, idx) => {
            const Icon = icons[idx] ?? Sparkles;
            return (
              <article
                className="group rounded-2xl border border-border/60 bg-card p-6 shadow-xs transition-shadow hover:shadow-md"
                key={item.title}
              >
                <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-accent text-flame-500">
                  <Icon className="size-5" />
                </div>
                <h3 className="text-base font-semibold tracking-tight">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.description}</p>
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
  intro,
  rows,
  locale,
}: {
  heading: string;
  intro: string;
  rows: Array<{ label: string; cloudflare: string; nas: string; vps: string }>;
  locale: Locale;
}) {
  return (
    <section className="border-b border-border/60 bg-secondary/30 py-20">
      <div className="container-x space-y-8">
        <header className="space-y-3">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">{heading}</h2>
          <p className="max-w-2xl text-base text-muted-foreground">{intro}</p>
        </header>
        <div className="overflow-x-auto rounded-2xl border border-border/60 bg-background shadow-xs">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 font-medium"> </th>
                <th className="px-4 py-3 font-medium text-flame-600">Cloudflare</th>
                <th className="px-4 py-3 font-medium">
                  {locale === "zh-CN" ? "家用 NAS" : "Home NAS"}
                </th>
                <th className="px-4 py-3 font-medium">VPS</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr className="border-t border-border/60" key={row.label}>
                  <th className="px-4 py-3 text-left align-top font-medium">{row.label}</th>
                  <td className="px-4 py-3 align-top text-foreground">{row.cloudflare}</td>
                  <td className="px-4 py-3 align-top text-muted-foreground">{row.nas}</td>
                  <td className="px-4 py-3 align-top text-muted-foreground">{row.vps}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Screenshots({ heading, caption }: { heading: string; caption: string }) {
  return (
    <section className="border-b border-border/60 bg-background py-20">
      <div className="container-x space-y-8">
        <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">{heading}</h2>
        <p className="max-w-2xl text-base text-muted-foreground">{caption}</p>
        <div className="flex flex-wrap items-end justify-center gap-8 rounded-3xl border border-border/60 bg-gradient-to-br from-background via-background to-flame-50/30 p-8 shadow-xs">
          <img
            alt="FlareMo desktop timeline screenshot"
            className="w-full max-w-2xl rounded-2xl border border-border/60 shadow-md"
            loading="lazy"
            src="/docs-assets/flaremo-desktop.png"
          />
          <img
            alt="FlareMo mobile timeline screenshot"
            className="w-40 rounded-2xl border border-border/60 shadow-md"
            loading="lazy"
            src="/docs-assets/flaremo-mobile.png"
          />
        </div>
      </div>
    </section>
  );
}

function PricingSummary({
  heading,
  subtitle,
  tiers,
  locale,
}: {
  heading: string;
  subtitle: string;
  tiers: ReturnType<typeof getPricingTiers>;
  locale: Locale;
}) {
  return (
    <section className="border-b border-border/60 bg-secondary/30 py-20">
      <div className="container-x space-y-10">
        <header className="space-y-3 text-center">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">{heading}</h2>
          <p className="mx-auto max-w-2xl text-base text-muted-foreground">{subtitle}</p>
        </header>
        <div className="grid gap-6 md:grid-cols-3">
          {tiers.map((tier) => (
            <article
              className={`flex flex-col rounded-2xl border p-6 shadow-xs transition-shadow ${
                tier.highlight
                  ? "border-flame-300 bg-background shadow-md"
                  : "border-border/60 bg-background"
              }`}
              key={tier.id}
            >
              {tier.highlight ? (
                <span className="mb-3 inline-flex w-fit items-center rounded-full bg-brand-gradient px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">
                  {locale === "zh-CN" ? "推荐" : "Recommended"}
                </span>
              ) : null}
              <h3 className="text-lg font-semibold tracking-tight">{tier.name}</h3>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-3xl font-semibold tracking-tight">{tier.price}</span>
                {tier.period ? (
                  <span className="text-xs text-muted-foreground">{tier.period}</span>
                ) : null}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{tier.tagline}</p>
              <ul className="mt-5 space-y-2 text-sm">
                {tier.features.map((f) => (
                  <li className="flex gap-2" key={f}>
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-flame-500" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6 pt-2">
                <DeployButton
                  className="w-full"
                  href={tier.ctaHref}
                  variant={tier.ctaVariant ?? "secondary"}
                >
                  {tier.cta}
                </DeployButton>
              </div>
            </article>
          ))}
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
        <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">{heading}</h2>
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
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}