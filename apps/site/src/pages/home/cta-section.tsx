import { ArrowRight, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getLocalizedPath, type SupportedLocale } from "@/lib/seo";
/* ============================================================
   7. 底部高光 CTA 横幅
   ============================================================ */

export function CtaSection({
  heading,
  subtitle,
  buttonText,
  secondaryCta,
  locale,
}: {
  heading: string;
  subtitle: string;
  buttonText: string;
  secondaryCta: string;
  locale: SupportedLocale;
}) {
  return (
    <section className="container-x">
      <div className="relative overflow-hidden rounded-3xl border border-signal/30 bg-surface p-8 sm:p-12 md:p-16 text-center shadow-pop-xl">
        {/* 背景径向余烬光晕 */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 h-72 w-96 rounded-full bg-signal/20 blur-3xl"
        />

        <div className="relative z-10 mx-auto max-w-2xl space-y-5">
          <h2 className="text-balance text-3xl font-extrabold tracking-tight text-ink sm:text-4xl md:text-5xl">
            {heading}
          </h2>
          <p className="text-pretty text-sm sm:text-base text-mist max-w-xl mx-auto leading-relaxed">
            {subtitle}
          </p>
          <div className="pt-4 flex flex-wrap justify-center gap-3">
            <Button
              render={<a href={getLocalizedPath("/docs/deploy", locale)} />}
              size="lg"
              variant="flame"
              className="shadow-pop"
            >
              <span>{buttonText}</span>
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
              <span>{secondaryCta}</span>
              <ExternalLink className="size-3.5 text-mist" />
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
