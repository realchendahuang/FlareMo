import { Link, useLocation } from "@tanstack/react-router";
import { ChevronRight, FileText } from "lucide-react";
import { useMemo } from "react";
import { Reveal } from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { docPath, getDocNavGroups } from "@/content/docs-nav";
import { listDocs } from "@/lib/docs-source.generated";
import { getLocaleFromPath, type SupportedLocale } from "@/lib/seo";

const HEADINGS: Record<SupportedLocale, string> = {
  en: "Documentation",
  zh: "文档总览",
  ja: "ドキュメント総覧",
  fr: "Documentation",
  es: "Documentación",
  ko: "문서 개요",
  ru: "Обзор документации",
  ar: "نظرة عامة على المستندات",
};

export function DocsIndexPage() {
  const { pathname } = useLocation();
  const locale = getLocaleFromPath(pathname);
  const docLocale = locale === "zh" ? "zh-CN" : "en-US";
  const docs = useMemo(() => listDocs(docLocale), [docLocale]);
  const groups = useMemo(() => getDocNavGroups(locale), [locale]);

  return (
    <div className="container-x py-12 md:py-16 space-y-10">
      <Reveal>
        <header className="space-y-3">
          <Badge variant="flame">FlareMo Knowledge Base</Badge>
          <h1 className="text-3xl font-extrabold tracking-tight text-ink sm:text-4xl md:text-5xl">
            {HEADINGS[locale] || HEADINGS.en}
          </h1>
          <p className="text-sm text-mist max-w-xl">
            {locale === "zh"
              ? "完整的架构指南、部署手册、开放 API 与兼容性参考文档。"
              : "Comprehensive architecture guides, deployment runbooks, and open API reference."}
          </p>
        </header>
      </Reveal>

      <div className="space-y-10">
        {groups.map((group) => {
          const docsInGroup = docs.filter((d) => d.group === group.id);
          if (docsInGroup.length === 0) return null;
          return (
            <section key={group.id} className="space-y-4">
              <h2 className="text-xs font-bold uppercase tracking-wider text-mist">
                {group.label}
              </h2>
              <div className="panel-card overflow-hidden border border-line/60 divide-y divide-line/60">
                {docsInGroup.map((doc) => (
                  <Link
                    className="group flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-wash"
                    key={doc.slug}
                    to={docPath(doc.slug, locale)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="icon-dock flex size-8 items-center justify-center text-signal shrink-0">
                        <FileText className="size-4" />
                      </div>
                      <div className="text-sm font-semibold tracking-tight text-ink group-hover:text-signal transition-colors">
                        {doc.title}
                      </div>
                    </div>
                    <ChevronRight className="size-4 text-fog transition-transform group-hover:translate-x-1 group-hover:text-signal rtl:-rotate-180 rtl:group-hover:-translate-x-1" />
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
