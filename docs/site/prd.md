# FlareMo 营销站与文档站 PRD

> 状态：Phase 0 已实现；后续 Phase 见 [`docs/saas-roadmap.md`](./saas-roadmap.md)。

## 目标

把注册的 `flaremo.app` 域名变成 FlareMo 的官方门户，承担两件事：

1. **Marketing**：让第一次听说 FlareMo 的人 30 秒内搞懂「这是个什么、为什么用 Cloudflare、有多省钱、怎么部署」。
2. **Docs**：把仓库 `docs/*.md` 镜像成可被搜索引擎索引的静态文档站，中英文双轨。

不接管、不展示、不假设有"Hosted SaaS"。Phase 0 的核心约束是：**不改主 Worker、不动 `apps/web`、不动 Better Auth 配置**。

## 范围

### 必须做

- 营销首页 `/` 与 `/en/`
- 定价页 `/pricing` 与 `/en/pricing`
- 文档目录 `/docs` 与 `/en/docs`
- 文档详情 `/docs/:slug` 与 `/en/docs/:slug`（覆盖 15 篇中文 + 4 篇英文）
- Hosted 占位页 `/hosted` 与 `/en/hosted`（无注册功能，仅邮件订阅 UI）
- 中英文切换（`<link rel="alternate" hreflang>` + 语言切换按钮）
- 完整 SEO：`robots.txt`、`sitemap.xml`、JSON-LD、OG、Twitter、canonical
- 独立 Worker `name: flaremo-site`，部署到 `flaremo.app`
- 设计 token 与 apps/web 保持一致（Ember 暖调中性 + 火焰品牌色）

### 不做

- 自部署多用户 / 公开 signup（Phase 1）
- Hosted SaaS 后端、Stripe webhook、配额中间件（Phase 2）
- 文档站交互式搜索（先静态）
- `/changelog` 镜像（Phase 3 之后）
- `/blog`（未定）

## 信息架构

### 顶部导航

- Logo（home）
- 4 项：`首页` / `定价` / `文档` / `Hosted`
- GitHub 链接 + 语言切换按钮

### 首页

1. **Hero**：标题「一个免费 Cloudflare 账号就能 24 小时在线的个人笔记系统」+ 双 CTA（Deploy Button 主，Hosted 试用次）
2. **三列 Hero stat**：D1 5GB / R2 10GB / 0 服务器
3. **Why FlareMo**：6 张 feature 卡片（D1+R2 / Better Auth + Memos / PWA / Agent Memory / 语义搜索 / 公开分享）
4. **为什么 Cloudflare 比 NAS 更稳**：7 行对比表
5. **看一眼产品**：两张截图（desktop + mobile）
6. **三档定价**：Free / Pro / Team 卡（Pro 高亮）
7. **常见问题**：6 条 FAQ

### Pricing 页

- 三卡（与首页一致但展开）
- Cloudflare 免费层对照表（6 行）
- Pricing FAQ（4 条）
- 使用条款与隐私（3 条）

### Docs 镜像

- 侧边栏 5 组：开始 / 架构与概念 / 兼容与生态 / Agent 集成 / 参考
- 顶部"English coming soon"提示，英文版只挂 4 篇已翻译的
- 中文版挂全 15 篇
- Markdown 排版照搬 `memo-markdown` 的层级与代码块风格

### Hosted 占位

- Hero 卡片：「Phase 2 即将开放」
- 邮箱订阅表单（UI 层 `onSubmit` 只 `setSubmitted(true)`，不发请求）
- 底部时间线状态：「Phase 0 已发布 · Phase 1 进行中 · Phase 2 计划于下一季度发布」

## 设计语言

完全复用 `apps/web` 的 Ember 调色与字体：

- 品牌色 `--flame-*`（OKLCH）+ `--flame-coral`
- 中性色暖调（hue 60–80）
- 字体 Geist Variable + CJK 回退
- 圆角 0.75rem（控件 8px / 卡片 12px / 浮层 14px）
- 阴影：暖调阴影（`--shadow-xs/sm/md/lg`）
- 动效 token：rise 200ms、fade 140ms、scale-in 140ms spring
- 品牌渐变 `--gradient-brand` 只允许在 logo / 主按钮 / 推荐徽章 / 选中态
- 一屏最多一个渐变 CTA

> 详见 [`docs/design-system.md`](../design-system.md)。

## 文案

- 中文：全角标点，省略号 `…`
- 英文：sentence case
- 单位/货币：数字统一使用阿拉伯数字 + 单位，金额前加 `$`
- 不混用「笔记/便签/memo」在 UI 文案
- 空状态必须给下一步动作（Hosted 页里订阅成功文案即可视为 CTA 反馈）
- emoji 仅在「English coming soon」之类容错场景出现；正文不引入

## 技术栈

| 选型 | 理由 |
| --- | --- |
| **React 19 + Vite** | 与 apps/web 完全同构；用户偏好 React + Vite。 |
| **TanStack Router（code-based）** | 与 apps/web 同栈（`createRouter` + code-based routes，非 file-based、非 TanStack Start）。 |
| **构建期 SSG（scripts/build.mjs）** | SEO 首选；每个路由产出完整静态 HTML（SEO head + body）；用 `react-dom/server` 的 `renderToString` + `router.load()` + `createMemoryHistory`，不依赖 TanStack Start。 |
| **Workers Static Assets** | 与 apps/web 主 Worker 同样的部署模型；不需要 Cloudflare Pages、不需要服务端 Worker 逻辑。 |
| **Tailwind CSS 4** | 与 apps/web 一致（`@tailwindcss/vite`）。 |

> 早期尝试过 TanStack Start（`@tanstack/react-start` + `@cloudflare/vite-plugin`），但 2026 Q3 的依赖链（react-start 1.168.49 / react-router 1.170.32 / router-core 1.171.27）在 pnpm + rolldown 下存在 `_getAssetMatches` 导出缺失的版本不匹配问题，无法构建。已改为项目同栈的 SSG 方案，SEO 效果等同（甚至更可控）。

### 包结构

```
apps/site/
├── index.html              ← dev 壳（vite）；生产由 SSG 覆盖
├── public/                 ← 静态资源：robots.txt、favicon、og-image.svg、品牌 PNG
├── scripts/
│   └── build.mjs           ← SSG 构建脚本（vite build + renderRoute 每个路径）
├── src/
│   ├── main.tsx            ← client 入口（hydrate/createRoot 双模式）
│   ├── router.tsx          ← code-based route tree（createRoute，与 apps/web 同构）
│   ├── ssr-render.tsx      ← SSR 渲染（renderToString + createMemoryHistory）
│   ├── styles/
│   │   ├── tokens.css      ← Ember 调色板 + Tailwind v4
│   │   └── prose.css       ← docs markdown 排版
│   ├── lib/
│   │   ├── cn.ts           ← tailwind-merge
│   │   ├── seo.ts          ← SEO head 构造器 + JSON-LD
│   │   ├── html-shell.ts   ← 完整 HTML shell（SEO head + body）
│   │   ├── route-meta.ts   ← 路由元数据表（path → title/desc/jsonLd）
│   │   └── docs-source.generated.ts ← docs markdown 静态注册
│   ├── content/
│   │   ├── copy.ts         ← 首页文案中英文
│   │   ├── pricing.ts      ← Pricing tier + 页面文案
│   │   └── docs-nav.ts     ← sidebar 分组元数据
│   ├── components/         ← SiteMark / SiteNav / SiteFooter / DeployButton / LocaleSwitcher / RootLayout
│   ├── pages/              ← 页面组件（home / pricing / hosted / docs-index / docs-detail / not-found）
│   └── dist/site/          ← SSG 输出（html + assets + public）
├── vite.config.ts          ← react + tailwindcss，outDir: dist/site
├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
├── wrangler.jsonc          ← name: flaremo-site, assets.directory: ./dist/site, 404-page
└── package.json
```

## SEO 清单

| 项 | 实现 |
| --- | --- |
| `robots.txt` | 允许全部 + sitemap 指向 |
| `sitemap.xml` | `scripts/build.mjs` 构建时自动产出 |
| `<title>` | 每个路由通过 `head` 设置（构建期注入） |
| `<meta description>` | 每个路由独立 |
| OG / Twitter | `og:title`、`og:description`、`og:image`、`og:url`、`og:locale`、`og:site_name`、`twitter:card=summary_large_image` |
| canonical | 每个路由独立，路径含 locale 前缀 |
| hreflang | `zh-CN`、`en-US`、`x-default` 三条 |
| JSON-LD | `SoftwareApplication`（首页）、`Product`（pricing）、`Article`（docs）、`FAQPage`（FAQ） |
| 结构化 OG image | `public/og-image.svg` 1200×630，含 logo + 标题 + 副标 |
| 性能预算 | 首屏 JS < 30KB gzipped；prerender 静态 HTML，Lighthouse ≥ 95 |

## 部署

```bash
pnpm --filter @flaremo/site install   # 一次性
pnpm dev:site                          # 本地开发
pnpm build:site                        # 构建（含 prerender）
pnpm deploy:dry-run:site               # 不污染
pnpm deploy:site                       # 部署到 flaremo.app
```

部署后绑定：在 Cloudflare Dashboard 的 Worker `flaremo-site` → Settings → Triggers → Custom Domains 添加 `flaremo.app` 与 `www.flaremo.app`。

## 验收口径

1. `pnpm format:check` 通过
2. `pnpm --filter @flaremo/site check` 通过
3. `pnpm --filter @flaremo/site build` 产出 `.output/public/**/*.html` 与 `.output/server/index.mjs`
4. `pnpm deploy:dry-run:site` 不污染
5. 部署后访问：
   - `https://flaremo.app/` → 中文首页，含 hero + features + 对比表 + 截图 + pricing + FAQ
   - `https://flaremo.app/en/` → 英文首页
   - `https://flaremo.app/pricing` → pricing 中文
   - `https://flaremo.app/docs/deploy` → 中文 deploy 文档，含 markdown 渲染
   - `https://flaremo.app/en/docs/deploy` → 英文 deploy 文档
   - `view-source:` 看到完整 head（含 og、hreflang）
   - Lighthouse Performance ≥ 95
   - `sitemap.xml` 可访问，包含所有路由
   - `robots.txt` 可访问
6. 主 Worker（`flaremo.chendahuang.com`）行为不变，D1 schema 不变，Better Auth Origin 不变

## 不做

- 不引入邮件订阅 endpoint（Phase 1）
- 不接 Stripe（Phase 2）
- 不做 `/changelog` 镜像（Phase 3）
- 不复制 apps/web 的 shadcn/ui 完整套件（营销站不需要那么多组件）
- 不动 Cloudflare Access 策略