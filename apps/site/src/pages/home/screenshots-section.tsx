import type { SupportedLocale } from "@/lib/seo";

/**
 * Real UI captures (light, dark, mobile) rendered from the shipped app, not a
 * mock. Chinese pages get Chinese captures; every other locale falls back to
 * the English captures so the section never mixes languages.
 */
const IMAGE_LOCALES: Partial<Record<SupportedLocale, string>> = { zh: "zh" };

export function ScreenshotsSection({
  heading,
  subtitle,
  locale,
}: {
  heading: string;
  subtitle: string;
  locale: SupportedLocale;
}) {
  const prefix = IMAGE_LOCALES[locale] ?? "en";
  const light = `/screenshots/app-${prefix}.webp`;
  const dark = `/screenshots/app-dark-${prefix}.webp`;
  const mobile = `/screenshots/app-mobile-${prefix}.webp`;

  return (
    <section id="screenshots" className="container-x space-y-10 scroll-mt-20">
      <div className="max-w-2xl space-y-2">
        <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl md:text-4xl">
          {heading}
        </h2>
        <p className="text-sm text-mist">{subtitle}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,15rem)] lg:items-end">
        <figure className="hidden overflow-hidden rounded-2xl border border-line bg-surface shadow-pop md:block">
          <img
            alt=""
            className="block w-full"
            height={960}
            loading="lazy"
            sizes="(min-width: 1024px) 60rem, 100vw"
            src={light}
            width={1440}
          />
        </figure>

        <figure className="mx-auto w-full max-w-[17rem] overflow-hidden rounded-[1.75rem] border-[5px] border-[#101012] bg-[#101012] shadow-pop-lg md:max-w-[15rem]">
          <img
            alt=""
            className="block w-full"
            height={1688}
            loading="lazy"
            sizes="15rem"
            src={mobile}
            width={780}
          />
        </figure>
      </div>

      <figure className="hidden overflow-hidden rounded-2xl border border-line bg-surface shadow-pop md:block">
        <img
          alt=""
          className="block w-full"
          height={960}
          loading="lazy"
          sizes="(min-width: 1024px) 68rem, 100vw"
          src={dark}
          width={1440}
        />
      </figure>
    </section>
  );
}
