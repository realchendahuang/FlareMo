import { Check } from "lucide-react";
import { COMP_DIMENSIONS, COMP_HEADERS } from "@/content/comparison-i18n";
import type { SupportedLocale } from "@/lib/seo";
/* ============================================================
   4. 三方对比矩阵
   ============================================================ */

export function ComparisonSection({
  heading,
  subtitle,
  rows,
  locale,
}: {
  heading: string;
  subtitle: string;
  rows: Array<{ label: string; cloudflare: string; nas: string; vps: string }>;
  locale: SupportedLocale;
}) {
  const headers = COMP_HEADERS[locale] || COMP_HEADERS.en;

  return (
    <section id="comparison" className="container-x space-y-8 scroll-mt-20">
      <div className="max-w-2xl space-y-2">
        <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl md:text-4xl">
          {heading}
        </h2>
        <p className="text-sm text-mist">{subtitle}</p>
      </div>

      {/* 窄屏：逐条卡片，避免三列表格被裁掉半列 */}
      <div className="grid gap-3 md:hidden">
        {rows.map((row) => (
          <article className="panel-card space-y-3 p-4" key={row.label}>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fog">
              {row.label}
            </h3>
            <div className="flex items-start gap-2 rounded-lg bg-signal/5 px-3 py-2">
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-signal/20 text-signal-ink">
                <Check className="size-2.5" />
              </span>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-signal-ink">
                  {headers.flaremo}
                </p>
                <p className="mt-0.5 text-sm font-medium text-ink">
                  {row.cloudflare}
                </p>
              </div>
            </div>
            <dl className="space-y-1.5 text-sm">
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-xs text-fog">
                  {headers.nas}
                </dt>
                <dd className="text-mist">{row.nas}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-xs text-fog">
                  {headers.vps}
                </dt>
                <dd className="text-mist">{row.vps}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>

      {/* 桌面：四列表格 */}
      <div className="panel-card hidden overflow-hidden border border-line/60 shadow-xs md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line/60 bg-soft-surface/80 text-start text-xs uppercase tracking-wider text-mist">
              <th className="px-5 py-4 font-semibold">
                {COMP_DIMENSIONS[locale] || COMP_DIMENSIONS.en}
              </th>
              <th className="bg-signal/10 px-5 py-4 font-bold text-signal-ink">
                {headers.flaremo}
              </th>
              <th className="px-5 py-4 font-semibold">{headers.nas}</th>
              <th className="px-5 py-4 font-semibold">{headers.vps}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {rows.map((row) => (
              <tr
                className="transition-colors hover:bg-wash/50"
                key={row.label}
              >
                <th className="px-5 py-4 text-start align-top font-semibold text-ink whitespace-nowrap">
                  {row.label}
                </th>
                <td className="bg-signal/5 px-5 py-4 align-top font-semibold text-ink">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-signal/20 text-signal-ink">
                      <Check className="size-2.5" />
                    </span>
                    <span>{row.cloudflare}</span>
                  </div>
                </td>
                <td className="px-5 py-4 align-top text-mist">{row.nas}</td>
                <td className="px-5 py-4 align-top text-mist">{row.vps}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
