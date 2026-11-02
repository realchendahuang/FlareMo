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

`src/lib/docs-source.generated.ts` 保留文档元数据，并为每篇正文提供 `import(...?raw)` 异步 loader；详情路由加载器会在渲染前等待对应正文，因此首页入口不会携带全部 Markdown。新增/修改文档后：

```bash
pnpm --filter @flaremo/site build
```

确保新 slug 出现在 `src/lib/docs-source.generated.ts` 的 `ZH_DOCS`/`EN_DOCS` 元数据条目（正文 loader 使用 `?raw`），以及 `scripts/build.mjs` 顶部的 `DOC_SLUGS`。后者是 SSG 的唯一预渲染 slug 清单，`getAllPaths()` 会将全部 slug 展开到 8 个 locale。英文条目加 `fallbackFromZh: true` 时回退中文正文，详情页顶部显示"翻译待补"提示条（`src/pages/docs-detail-page.tsx`）。

## SEO

- 每个路由的 SEO meta（title / description / og / twitter / canonical / hreflang / JSON-LD）在 `src/content/static-page-meta.ts` 的 `STATIC_PAGE_META` 注册；`src/ssr-render.tsx` 按 pathname 取 meta 交给 `src/lib/html-shell.ts` 的 `buildSeoForPath`（包装 `src/lib/seo.ts` 的 `buildSeoHead`）生成 `<head>` 内容。
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

- `https://flaremo.app/`、`/en/`、`/docs/`、`/en/docs/`、至少一个 `/docs/<slug>/` 与 `/en/docs/<slug>/` 全部 200；其余 locale 前缀也应命中 `scripts/build.mjs` 生成的路径
- `view-source:` 看到完整 head（og、hreflang、JSON-LD）+ 非空 body
- `https://flaremo.app/sitemap.xml` 与 `/robots.txt` 可访问
- Lighthouse Performance ≥ 90（SSG 静态 HTML 首字节即有内容）
- 主 Worker（`flaremo.chendahuang.com`）行为不变；Better Auth 不受影响
