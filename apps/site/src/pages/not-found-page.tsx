import { Link } from "@tanstack/react-router";

export function NotFoundPage() {
  return (
    <div className="container-x flex min-h-[60vh] flex-col items-center justify-center py-20 text-center">
      <p className="text-7xl font-semibold tracking-tight text-brand-gradient">
        404
      </p>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">页面不存在</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        你访问的地址没有内容。看看文档总览，或者回到首页。
      </p>
      <div className="mt-6 flex gap-3">
        <Link
          className="rounded-xl border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          to="/"
        >
          首页
        </Link>
        <Link
          className="rounded-xl border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          to="/docs"
        >
          文档总览
        </Link>
      </div>
    </div>
  );
}
