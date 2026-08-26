import { useLocation } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { DeployButton } from "@/components/deploy-button";
import { getPricingPage, getPricingTiers } from "@/content/pricing";
import type { Locale } from "@/lib/seo";

export function PricingPage() {
  const { pathname } = useLocation();
  const locale: Locale = pathname.startsWith("/en") ? "en-US" : "zh-CN";
  const page = getPricingPage(locale);
  const tiers = getPricingTiers(locale);

  return (
    <main>
      <header className="border-b border-border/60 bg-gradient-to-b from-background to-flame-50/40 py-16">
        <div className="container-x space-y-4 text-center">
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
            {page.title}
          </h1>
          <p className="mx-auto max-w-2xl text-base text-muted-foreground">
            {page.subtitle}
          </p>
          <p className="mx-auto max-w-3xl text-sm leading-6 text-muted-foreground">
            {page.intro}
          </p>
        </div>
      </header>

      <section className="container-x py-16">
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
              <h2 className="text-lg font-semibold tracking-tight">
                {tier.name}
              </h2>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-3xl font-semibold tracking-tight">
                  {tier.price}
                </span>
                {tier.period ? (
                  <span className="text-xs text-muted-foreground">
                    {tier.period}
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {tier.tagline}
              </p>
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
      </section>

      <section className="border-y border-border/60 bg-secondary/30 py-16">
        <div className="container-x space-y-6">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
            {page.deploymentHeading}
          </h2>
          <div className="overflow-x-auto rounded-2xl border border-border/60 bg-background shadow-xs">
            <table className="w-full text-sm">
              <tbody>
                {page.deploymentRows.map((row) => (
                  <tr
                    className="border-t border-border/60 first:border-t-0"
                    key={row.label}
                  >
                    <th className="w-1/3 px-4 py-3 text-left align-top font-medium">
                      {row.label}
                    </th>
                    <td className="px-4 py-3 align-top text-foreground">
                      {row.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="container-x py-16">
        <div className="space-y-6">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
            {page.faqHeading}
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {page.faqItems.map((item) => (
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

      <section className="border-t border-border/60 bg-secondary/30 py-16">
        <div className="container-x space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
            {page.legalHeading}
          </h2>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {page.legal.map((line) => (
              <li key={line}>· {line}</li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
