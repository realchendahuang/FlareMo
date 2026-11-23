import { ChevronDown } from "lucide-react";
/* ============================================================
   6. FAQ 手风琴常见问题
   ============================================================ */

export function FaqSection({
  heading,
  items,
}: {
  heading: string;
  items: Array<{ q: string; a: string }>;
}) {
  return (
    <section id="faq" className="container-x space-y-8 scroll-mt-20">
      <div className="max-w-2xl space-y-2">
        <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl md:text-4xl">
          {heading}
        </h2>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {items.map((item) => (
          <details
            className="group panel-card p-5 transition-all duration-200 open:shadow-md cursor-pointer [&_summary::-webkit-details-marker]:hidden"
            key={item.q}
          >
            <summary className="flex list-none items-center justify-between gap-3 text-base font-bold text-ink">
              <span>{item.q}</span>
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-soft-surface text-mist transition-transform duration-200 group-open:rotate-180">
                <ChevronDown className="size-4" />
              </span>
            </summary>
            <p className="mt-3 text-sm leading-relaxed text-mist border-t border-line/50 pt-3">
              {item.a}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
