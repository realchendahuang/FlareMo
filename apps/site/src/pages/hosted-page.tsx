import { useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { Bell, Calendar } from "lucide-react";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import type { Locale } from "@/lib/seo";

const COPY = {
  "zh-CN": {
    eyebrow: "Phase 2 · 路线图",
    title: "Hosted SaaS 试用即将开放",
    subtitle:
      "我们刻意把 Hosted 留到 Phase 2：先把自部署多用户、magic link、Stipe webhook 走稳，再开放 hosted.flaremo.app 的邀请注册。",
    formTitle: "收到开放通知",
    formDescription: "把你的邮箱留在下面，Hosted 试用开放当天会发一封邮件给你。",
    emailLabel: "邮箱",
    submit: "订阅开放通知",
    submitted: "已订阅，感谢！",
    note: "Hosted 开放前，我们不会发送任何营销邮件；Phase 2 通知发出后即可一键退订。",
    timeline: "Phase 0 已发布 · Phase 1（自部署多用户）进行中 · Phase 2 计划于下一季度发布",
  },
  "en-US": {
    eyebrow: "Phase 2 · Roadmap",
    title: "Hosted SaaS trial is coming",
    subtitle:
      "We're deliberately saving Hosted for Phase 2. First we want self-hosted multi-user, magic-link sign-in, and the Stripe webhook battle-tested; only then will hosted.flaremo.app open for invite-based registration.",
    formTitle: "Get notified when it opens",
    formDescription: "Leave your email below; we'll send one message the day the Hosted trial opens.",
    emailLabel: "Email",
    submit: "Notify me",
    submitted: "Subscribed. Thank you!",
    note: "We won't send anything before Hosted opens. One-click unsubscribe after the Phase 2 launch email.",
    timeline: "Phase 0 shipped · Phase 1 (self-hosted multi-user) in progress · Phase 2 planned for the next quarter",
  },
};

export function HostedPage() {
  const { pathname } = useLocation();
  const locale: Locale = pathname.startsWith("/en") ? "en-US" : "zh-CN";
  const copy = COPY[locale];
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email) return;
    // Phase 0: UI only. Phase 1/2 will POST to a server endpoint and persist.
    setSubmitted(true);
  }

  return (
    <>
      <SiteNav currentPath={pathname} locale={locale} />
      <main>
        <section className="border-b border-border/60 bg-gradient-to-b from-background via-background to-flame-50/40 py-20">
          <div className="container-x grid gap-10 md:grid-cols-[1.1fr_1fr]">
            <div className="space-y-6">
              <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
                <Bell className="size-3.5 text-flame-500" />
                {copy.eyebrow}
              </span>
              <h1 className="text-balance text-4xl font-semibold tracking-tight md:text-5xl">
                {copy.title}
              </h1>
              <p className="max-w-xl text-pretty text-lg leading-7 text-muted-foreground">
                {copy.subtitle}
              </p>
              <div className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">
                <Calendar className="size-3.5" />
                {copy.timeline}
              </div>
            </div>
            <div className="rounded-2xl border border-border/60 bg-background p-6 shadow-md">
              <h2 className="text-lg font-semibold tracking-tight">{copy.formTitle}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{copy.formDescription}</p>
              {submitted ? (
                <p className="mt-6 rounded-xl border border-flame-200 bg-flame-50 px-4 py-3 text-sm text-flame-700">
                  {copy.submitted}
                </p>
              ) : (
                <form className="mt-5 space-y-3" onSubmit={handleSubmit}>
                  <label className="block">
                    <span className="text-xs font-medium text-muted-foreground">
                      {copy.emailLabel}
                    </span>
                    <input
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none ring-ring focus-visible:ring-2"
                      inputMode="email"
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={
                        locale === "zh-CN" ? "you@example.com" : "you@example.com"
                      }
                      required
                      type="email"
                      value={email}
                    />
                  </label>
                  <button
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-gradient px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-md transition hover:brightness-105 disabled:opacity-60"
                    disabled={!email}
                    type="submit"
                  >
                    {copy.submit}
                  </button>
                  <p className="text-[11px] leading-5 text-muted-foreground">{copy.note}</p>
                </form>
              )}
            </div>
          </div>
        </section>
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}