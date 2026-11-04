import { Link, useLocation } from "@tanstack/react-router";
import { ArrowRight, BookOpen } from "lucide-react";
import { NOT_FOUND_COPY } from "@/content/not-found-i18n";
import { getLocaleFromPath, getLocalizedPath } from "@/lib/seo";

export function NotFoundPage() {
  const { pathname } = useLocation();
  const locale = getLocaleFromPath(pathname);
  const copy = NOT_FOUND_COPY[locale] ?? NOT_FOUND_COPY.en;

  return (
    <div className="container-x flex min-h-[60vh] flex-col items-center justify-center py-20 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fog">
        {copy.eyebrow}
      </p>
      <h1 className="mt-4 max-w-2xl text-balance text-3xl font-extrabold tracking-tight text-ink sm:text-4xl md:text-5xl">
        {copy.title}
      </h1>
      <p className="mt-4 max-w-xl text-pretty text-sm leading-relaxed text-mist sm:text-base">
        {copy.description}
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          className="inline-flex h-10 items-center gap-2 rounded-full bg-signal px-5 text-sm font-semibold text-white shadow-pop transition-colors hover:bg-signal-deep"
          to={getLocalizedPath("/", locale)}
        >
          {copy.homeCta}
          <ArrowRight className="size-4 rtl:-rotate-180" />
        </Link>
        <Link
          className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-surface px-5 text-sm font-semibold text-ink transition-colors hover:bg-wash"
          to={getLocalizedPath("/docs", locale)}
        >
          <BookOpen className="size-4 text-mist" />
          {copy.docsCta}
        </Link>
      </div>
    </div>
  );
}
