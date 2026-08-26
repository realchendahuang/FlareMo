# apps/site — Marketing and Docs Site

独立部署到 `flaremo.app` 的营销/文档站，与主 Worker `flaremo` 完全解耦。共享设计 token，但代码、依赖、构建链路、Worker 都独立。

## 技术栈

与 `apps/web` 完全同构：**React 19 + Vite + TanStack Router（code-based）+ Tailwind CSS 4**。不是 TanStack Start（避免其 2026 Q3 依赖链不稳定的问题）；构建期通过 `scripts/build.mjs` 做 SSG（每个路由产出完整静态 HTML，含 SEO head + body）。

## 不要做

- 不修改主 Worker（`./wrangler.jsonc`）的 `FLAREMO_PUBLIC_URL`、Better Auth 配置、D1 schema、Memos 兼容 API
- 不修改 `apps/web` 的渲染模型（保持纯 CSR SPA）；本包是独立 SSG + hydrate
- 不引入 TanStack Start / Astro / Next 等新框架；保持 React + Vite + TanStack Router code-based
- 不引入邮件订阅 endpoint
- 不接 Stripe
- 不创建 GH Actions；部署走人工 `pnpm deploy:site`

## 设计 token 来源

`src/styles/tokens.css` 复制自 `apps/web/src/index.css` 的 `--flame-*`、中性色、圆角、阴影与动效 token。修改前请同步两份。

## docs 镜像

`src/lib/docs-source.generated.ts` 静态导入 `../../../../docs/*.md` 与 `../../../../docs/en/*.md`，由 Vite `?raw` 打包。新增/修改文档后：

```bash
pnpm --filter @flaremo/site build
```

确保新 slug 出现在 `src/lib/route-meta.ts` 的 `getDocRoutes()`（中文 15 篇 + 英文 4 篇），以及 `scripts/build.mjs` 的 `getAllPaths()`。英文版仅 4 篇已译文档；其余加 `fallbackFromZh: true` 标志，UI 顶部显示 "English coming soon"。

## SEO

- 每个路由的 SEO（title / description / og / twitter / canonical / hreflang / JSON-LD）在 `src/lib/route-meta.ts` 注册。
- `src/lib/html-shell.ts` 的 `renderHtmlShell` 生成完整 `<head>`；`src/ssr-render.tsx` 用 `createMemoryHistory` + `router.load()` + `renderToString` 渲染 body。
- `scripts/build.mjs` 构建时自动产出 `sitemap.xml` 与 `robots.txt`（后者在 `public/`）。

## 命令

```bash
pnpm dev:site                # 本地开发（vite dev，client 渲染）
pnpm build:site              # SSG 构建（产出 dist/site 全部 HTML）
pnpm deploy:dry-run:site     # 不污染
pnpm deploy:site             # 部署到 flaremo.app
```

## 验收

部署后必须检查：

- `https://flaremo.app/`、`/en/`、`/pricing`、`/en/pricing`、`/docs/`、`/en/docs/`、`/docs/<slug>`、`/en/docs/<slug>` 全部 200
- `view-source:` 看到完整 head（og、hreflang、JSON-LD）+ 非空 body
- `https://flaremo.app/sitemap.xml` 与 `/robots.txt` 可访问
- Lighthouse Performance ≥ 90（SSG 静态 HTML 首字节即有内容）
- 主 Worker（`flaremo.chendahuang.com`）行为不变；Better Auth 不受影响