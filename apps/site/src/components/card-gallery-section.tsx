import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CARD_IMAGES,
  getCardGalleryContent,
} from "@/content/card-gallery-i18n";
import { getLocalizedPath, type SupportedLocale } from "@/lib/seo";

/**
 * Share-card gallery: the five built-in cards at their real 340×420 aspect,
 * captioned, with one line explaining the plugin model and a link into the
 * plugin docs. Previews are static PNGs captured from the running app, so the
 * section stays honest about what the cards actually look like.
 */
export function CardGallerySection({ locale }: { locale: SupportedLocale }) {
  const content = getCardGalleryContent(locale);

  return (
    <section id="cards" className="container-x space-y-8 scroll-mt-20">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl space-y-3">
          <Badge variant="secondary">{content.badge}</Badge>
          <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl md:text-4xl">
            {content.heading}
          </h2>
          <p className="text-sm leading-relaxed text-mist">
            {content.subtitle}
          </p>
        </div>
        <Button
          className="shrink-0 self-start sm:self-auto"
          variant="outline"
          render={<a href={getLocalizedPath(content.ctaHref, locale)} />}
        >
          {content.cta}
          <ArrowRight data-icon="inline-end" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {content.cards.map((card, index) => (
          <figure key={card.name} className="flex flex-col gap-3">
            <div className="overflow-hidden rounded-xl border border-line bg-paper/40 shadow-sm">
              <img
                alt={card.name}
                className="aspect-[17/21] w-full object-cover"
                decoding="async"
                height={420}
                // Keep this lazy: React 19 hoists a preload for imgs that carry
                // fetchPriority, which made below-the-fold card PNGs compete
                // with the hero for bandwidth (LCP regression).
                loading="lazy"
                src={CARD_IMAGES[index] ?? CARD_IMAGES[0]}
                width={340}
              />
            </div>
            <figcaption className="space-y-0.5">
              <p className="text-sm font-semibold text-ink">{card.name}</p>
              <p className="text-xs leading-relaxed text-mist">
                {card.caption}
              </p>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
