# apps/site — Marketing and Docs Site

独立部署到 `flaremo.app` 的营销/文档站，与主 Worker `flaremo` 完全解耦。共享设计 token，但代码、依赖、构建链路、Worker 都独立。

## 不要做

- 不修改主 Worker（`./wrangler.jsonc`）的 `FLAREMO_PUBLIC_URL`、Better Auth 配置、D1 schema、Memos 兼容 API
- 不修改 `apps/web` 的渲染模型（保持纯 CSR SPA）；本包是独立 SSR + prerender
- 不复制 apps/web 的完整 shadcn/ui 套件；本包只手写少量基础组件
- 不引入邮件订阅 endpoint（Phase 1 才接）
- 不接 Stripe（Phase 2 才接）
- 不创建 GH Actions；部署走人工 `pnpm deploy:site`

## 设计 token 来源

`src/styles/tokens.css` 复制自 `apps/web/src/index.css` 的 `--flame-*`、中性色、圆角、阴影与动效 token。修改前请同步两份。

## docs 镜像

`src/lib/docs-source.generated.ts` 静态导入 `../../../../docs/*.md` 与 `../../../../docs/en/*.md`，由 TanStack Start 在构建期通过 `?raw` 打包。新增/修改文档后：

```bash
pnpm --filter @flaremo/site build
```

确保新 slug 出现在 `/docs/<slug>` 与 `/en/docs/<slug>`（英文版仅 4 篇已译文档；其余加 `fallbackFromZh: true` 标志，UI 顶部显示 "English coming soon"）。

## SEO

每个 route 的 `head` 函数通过 `@/lib/seo.ts` 的 `buildSeoHead` 生成完整的 title / meta / links / scripts。`@/lib/route-head.ts` 提供适配层。

## 命令

```bash
pnpm dev:site                # 本地开发
pnpm build:site              # 构建（含 prerender 所有路由）
pnpm deploy:dry-run:site     # 不污染
pnpm deploy:site             # 部署到 flaremo.app
```

## 验收

部署后必须检查：

- `https://flaremo.app/`、`/en/`、`/pricing`、`/en/pricing`、`/hosted`、`/en/hosted`、`/docs/`、`/en/docs/`、`/docs/<slug>`、`/en/docs/<slug>` 全部 200
- `view-source:` 看到完整 head（og、hreflang、JSON-LD）
- `https://flaremo.app/sitemap.xml` 与 `/robots.txt` 可访问
- Lighthouse Performance ≥ 95
- 主 Worker（`flaremo.chendahuang.com`）行为不变；Better Auth 不受影响