import { ArrowRight, ExternalLink } from "lucide-react";
import { PopIn, Reveal } from "@/components/motion";
import { Button } from "@/components/ui/button";
import type { HomeContent } from "@/content/copy";
import { getLocalizedPath, type SupportedLocale } from "@/lib/seo";
/* ============================================================
   1. Hero 区块
   ============================================================ */

export function Hero({
  locale,
  home,
}: {
  locale: SupportedLocale;
  home: HomeContent;
}) {
  return (
    <section className="relative pt-12 md:pt-20">
      <div className="container-x space-y-10">
        <div className="space-y-6 text-center">
          {/* Eyebrow Pill */}
          <PopIn className="inline-flex">
            <div className="inline-flex items-center gap-2 rounded-full border border-signal/30 bg-signal/10 px-3.5 py-1 text-xs font-semibold text-signal-ink shadow-2xs backdrop-blur-md">
              <span>{home.heroEyebrow}</span>
            </div>
          </PopIn>

          {/* Headline: 两行都允许自然换行（text-balance 让断行均匀），
              不再锁 nowrap——EN/FR 等长句在 640px 以上会超出容器被裁切。 */}
          <Reveal delay={0.08}>
            <h1 className="mx-auto max-w-4xl text-balance text-[clamp(1.75rem,4.6vw,4.1rem)] font-extrabold tracking-tight text-ink leading-[1.12]">
              <span className="block">{home.heroTitleLine1}</span>
              <span className="mt-1.5 block text-brand-gradient sm:mt-2.5">
                {home.heroTitleLine2}
              </span>
            </h1>
          </Reveal>

          {/* Subtitle */}
          <Reveal delay={0.16}>
            <p className="mx-auto max-w-2xl text-pretty text-base text-mist sm:text-lg leading-relaxed">
              {home.heroSubtitle}
            </p>
          </Reveal>

          {/* Actions */}
          <Reveal delay={0.24}>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <Button
                render={<a href={getLocalizedPath("/docs/deploy", locale)} />}
                size="lg"
                variant="flame"
                className="shadow-pop"
              >
                <span>{home.primaryCta}</span>
                <ArrowRight className="size-4 rtl:-rotate-180" />
              </Button>

              <Button
                render={
                  <a
                    href="https://github.com/realchendahuang/FlareMo"
                    rel="noopener noreferrer"
                    target="_blank"
                  />
                }
                size="lg"
                variant="secondary"
              >
                <span>{home.secondaryCta}</span>
                <ExternalLink className="size-3.5 text-mist" />
              </Button>
            </div>
          </Reveal>
        </div>

        {/* 事实横条：只报可核对的免费配额与部署耗时，不做百分比承诺 */}
        <Reveal delay={0.32}>
          <dl className="mx-auto grid max-w-4xl grid-cols-2 gap-y-7 border-y border-line/70 py-7 text-center sm:grid-cols-4 sm:divide-x sm:divide-line/70">
            {home.heroFacts.map((fact) => (
              <div key={fact.label} className="px-2 sm:px-4">
                <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-fog">
                  {fact.label}
                </dt>
                <dd
                  className="mt-1.5 text-xl font-semibold tracking-tight text-ink tabular-nums"
                  dir="ltr"
                >
                  {fact.value}
                </dd>
                <dd className="mt-0.5 text-xs text-mist">{fact.detail}</dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </div>
    </section>
  );
}
