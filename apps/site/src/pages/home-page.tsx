import { useLoaderData, useLocation } from "@tanstack/react-router";
import {
  Bot,
  Database,
  Layers,
  ShieldCheck,
  Users,
  WifiOff,
} from "lucide-react";
import { CardGallerySection } from "@/components/card-gallery-section";
import { InteractiveShowcase } from "@/components/interactive-showcase";
import type { HomeContent } from "@/content/copy";
import type { ShowcaseContent } from "@/content/showcase-i18n";
import { getLocaleFromPath } from "@/lib/seo";
import { BentoFeatures } from "./home/bento-features-section";
import { ComparisonSection } from "./home/comparison-section";
import { CtaSection } from "./home/cta-section";
import { EcosystemSection } from "./home/ecosystem-section";
import { FaqSection } from "./home/faq-section";
import { Hero } from "./home/hero-section";
import { ScreenshotsSection } from "./home/screenshots-section";

const FEATURE_ICONS = [ShieldCheck, Database, WifiOff, Bot, Users, Layers];

export function HomePage() {
  const { pathname } = useLocation();
  const locale = getLocaleFromPath(pathname);
  const { home, showcase } = useLoaderData({ strict: false }) as {
    home: HomeContent;
    showcase: ShowcaseContent;
  };

  return (
    <div className="space-y-24 sm:space-y-32 pb-24 overflow-x-hidden">
      <Hero home={home} locale={locale} />
      <InteractiveShowcase showcase={showcase} />
      <BentoFeatures
        badge={home.featuresBadge}
        heading={home.featuresHeading}
        icons={FEATURE_ICONS}
        items={home.features}
        subtitle={home.featuresSubtitle}
      />
      <ScreenshotsSection
        heading={home.screenshotsHeading}
        locale={locale}
        subtitle={home.screenshotsSubtitle}
      />
      <ComparisonSection
        heading={home.comparisonHeading}
        locale={locale}
        rows={home.comparisonRows}
        subtitle={home.comparisonSubtitle}
      />
      <EcosystemSection locale={locale} />
      <CardGallerySection locale={locale} />
      <FaqSection heading={home.faqHeading} items={home.faqItems} />
      <CtaSection
        buttonText={home.ctaButton}
        heading={home.ctaHeading}
        locale={locale}
        secondaryCta={home.secondaryCta}
        subtitle={home.ctaSubtitle}
      />
    </div>
  );
}
