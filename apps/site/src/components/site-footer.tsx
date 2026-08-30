import { Link } from "@tanstack/react-router";
import { SiteMark } from "@/components/site-mark";
import type { Locale } from "@/lib/seo";

type SiteFooterProps = {
  locale: Locale;
};

const ZH_LINKS = {
  product: [
    { to: "/", label: "首页" },
    { to: "/pricing", label: "定价" },
  ],
  docs: [
    { to: "/docs", label: "文档总览" },
    { to: "/docs/deploy", label: "部署指南" },
    { to: "/docs/architecture-notes", label: "架构设计" },
  ],
  project: [
    { to: "/docs/release", label: "发版规则" },
    { to: "/docs/product-requirements", label: "需求梳理" },
  ],
};

const EN_LINKS = {
  product: [
    { to: "/en", label: "Home" },
    { to: "/en/pricing", label: "Pricing" },
  ],
  docs: [
    { to: "/en/docs", label: "Docs overview" },
    { to: "/en/docs/deploy", label: "Deployment" },
    { to: "/en/docs/architecture-notes", label: "Architecture" },
  ],
  project: [
    { to: "/en/docs/release", label: "Release process" },
    { to: "/en/docs/product-requirements", label: "Requirements" },
  ],
};

export function SiteFooter({ locale }: SiteFooterProps) {
  const links = locale === "zh-CN" ? ZH_LINKS : EN_LINKS;
  const copy =
    locale === "zh-CN"
      ? "免费账号 · 24 小时在线 · 数据归你所有"
      : "Free tier · Always-on · Your data, your rules";

  return (
    <footer className="border-t border-border/60 bg-background">
      <div className="container-x grid gap-10 py-12 md:grid-cols-[1.2fr_2fr]">
        <div className="space-y-3">
          <SiteMark />
          <p className="max-w-xs text-sm text-muted-foreground">{copy}</p>
          <p className="text-xs text-muted-foreground/80">
            © {new Date().getFullYear()} FlareMo · AGPL-3.0
          </p>
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          <FooterColumn
            heading={locale === "zh-CN" ? "产品" : "Product"}
            items={links.product}
          />
          <FooterColumn
            heading={locale === "zh-CN" ? "文档" : "Docs"}
            items={links.docs}
          />
          <FooterColumn
            heading={locale === "zh-CN" ? "项目" : "Project"}
            items={links.project}
          />
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  heading,
  items,
}: {
  heading: string;
  items: { to: string; label: string }[];
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold tracking-tight text-foreground">
        {heading}
      </h3>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.to}>
            <Link
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              to={item.to}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
