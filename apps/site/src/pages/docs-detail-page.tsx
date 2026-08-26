import { useMemo } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronLeft } from "lucide-react";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { getDocNavGroups, docPath } from "@/content/docs-nav";
import { getDoc, listDocs } from "@/lib/docs-source.generated";
import "@/styles/prose.css";
import type { Locale } from "@/lib/seo";

export function DocsDetailPage() {
  const { pathname } = useLocation();
  const locale: Locale = pathname.startsWith("/en") ? "en-US" : "zh-CN";

  // Extract slug from pathname: /docs/$slug or /en/docs/$slug
  const slug = useMemo(() => {
    const parts = pathname.split("/").filter(Boolean);
    if (locale === "en-US") return parts[parts.length - 1] ?? "";
    return parts[parts.length - 1] ?? "";
  }, [pathname, locale]);

  const doc = useMemo(() => getDoc(slug, locale), [slug, locale]);
  const allDocs = useMemo(() => listDocs(locale), [locale]);
  const groups = useMemo(() => getDocNavGroups(locale), [locale]);

  if (!doc) {
    return (
      <>
        <SiteNav currentPath={pathname} locale={locale} />
        <main className="container-x py-16 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            {locale === "zh-CN" ? "文档不存在" : "Document not found"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {locale === "zh-CN"
              ? "我们暂时没有这份文档。请查看文档总览。"
              : "We don't have that document. See the docs index."}
          </p>
          <Link
            className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-flame-600 hover:text-flame-500"
            to={locale === "zh-CN" ? "/docs" : "/en/docs"}
          >
            <ChevronLeft className="size-4" />
            {locale === "zh-CN" ? "回到文档总览" : "Back to docs"}
          </Link>
        </main>
        <SiteFooter locale={locale} />
      </>
    );
  }

  return (
    <>
      <SiteNav currentPath={pathname} locale={locale} />
      <main className="container-x grid gap-10 py-12 lg:grid-cols-[14rem_1fr]">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {locale === "zh-CN" ? "文档" : "Docs"}
          </h2>
          <nav className="space-y-5">
            {groups.map((group) => {
              const docsInGroup = allDocs.filter((d) => d.group === group.id);
              if (docsInGroup.length === 0) return null;
              return (
                <div key={group.id}>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.label}
                  </div>
                  <ul className="space-y-0.5">
                    {docsInGroup.map((d) => (
                      <li key={d.slug}>
                        <Link
                          activeProps={{
                            className: "bg-accent text-accent-foreground font-medium",
                          }}
                          className="block rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                          to={docPath(d.slug, locale)}
                        >
                          {d.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </nav>
        </aside>
        <article>
          {doc.fallbackFromZh ? (
            <div className="mb-6 rounded-xl border border-flame-200 bg-flame-50/60 px-4 py-3 text-sm text-flame-700">
              {locale === "zh-CN"
                ? "本页内容为中文原文；尚未翻译为英文。"
                : "This document is shown in its original Chinese; an English translation is pending."}
            </div>
          ) : null}
          <header className="mb-6 space-y-2 border-b border-border/60 pb-5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              {groups.find((g) => g.id === doc.group)?.label}
            </div>
            <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{doc.title}</h1>
            {doc.description ? (
              <p className="text-sm text-muted-foreground">{doc.description}</p>
            ) : null}
          </header>
          <div className="prose-doc">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.body}</ReactMarkdown>
          </div>
        </article>
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}