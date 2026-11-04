# 分享页 SEO 最佳实践方案

> 适用范围：公开分享链接 `/share/:token`。状态：**P0 + P1（策略 B）已实施并上线**（2026-09-18 实测，wrangler 配置 `run_worker_first: true`；后续见 §4 可选增强）。
>
> 目标读者：在 FlareMo 上继续开发的 agent / 开发者。每一条结论都有线上实测或单测支撑，不是拍脑袋。

---

## 1. 背景

分享页是 FlareMo 唯一一个**匿名可访问且内容公开**的页面形态，也是唯一值得被搜索引擎和社交平台抓取的表面。web 端是纯 SPA（`not_found_handling: "single-page-application"`），不改造时，任何爬虫拿到的都是固定的 3KB 空壳：标题恒为 `FlareMo`，无 meta，无正文。

### 已落地（第一层，commit 9261be6 + wrangler.jsonc 修复）

| 项 | 实现 | 位置 |
|---|---|---|
| worker 注入路由 | `GET /share/:token` 服务端改写 SPA 壳 | `apps/worker/src/routes/share-page.ts` |
| 注入内容 | title / description（去 markdown 噪音，80/160 字截断）、OG 全套、Twitter Card、JSON-LD（SocialMediaPosting）、SSR 正文段落、`robots: index, follow` | 同上 |
| 死分享处理 | 撤销 / 过期 / 不存在的 token → 注入 `noindex, nofollow`（仍是 200，见 Gap 2） | 同上 |
| wrangler 配置 | `assets.run_worker_first` 路径白名单（`/share/*`、`/article/*`、`/sitemap*.xml`、`/feed.xml`、`/file/*`、`/api/*`、`/mcp`、`/openapi.json`、`/memos.api.v1.*`、`/favicon.ico`）——命中清单的请求先由 worker 处理，其余静态资源由 ASSETS 直接返回；未命中资源的导航进入 worker，再由 SPA 路由白名单决定 200 还是 404（`assets.not_found_handling: "none"`）。改白名单必须同步 `apps/web/vite.config.ts` 的 `server.proxy`，`apps/web/src/dev-proxy-parity.test.ts` 会兜底 | `wrangler.jsonc` / `apps/worker/src/spa-routes.ts` |
| robots.txt | 真实静态文件（`Disallow /api/ /file/ /mcp /memos.api.v1`） | `apps/web/public/robots.txt` |
| canonical origin | og:url/og:image 以 `FLAREMO_PUBLIC_URL` 为准，请求 origin 兜底 | `share-page.ts` `publicOrigin()` |
| 测试 | `apps/worker/src/share-page.test.ts`（4 例，Miniflare + 真 D1） | |

**踩坑记录**：`run_worker_first` 是这个功能的隐形前提。assets 精确匹配的文件（如 robots.txt）不走 worker，直接由边缘资源路由返回；未列入 `run_worker_first` 的路径（如 `/share/:token`）会被 SPA 兜底直接返回空壳且 `cf-cache-status: HIT`，worker 的 fetch handler 不执行。症状是"代码部署了、单测过了、线上纹丝不动"。

---

## 2. 现状审计（2026-09-18 线上实测）

结论：**及格，未达最佳实践**。逐项对照：

### 2.1 达标 ✅

- title / meta description 来源于正文纯文本，非固定站点名
- OG / Twitter 卡片标签齐全，og:image 为公开可抓的绝对 URL
- JSON-LD 结构化数据（headline、datePublished、author、text、mainEntityOfPage）
- 无 JS 爬虫可见正文（SSR 注入，浏览器端 React 挂载时清除，UI 无感）
- robots.txt 真实存在、语法正确
- HTTPS、canonical 域名收敛（`FLAREMO_PUBLIC_URL`）、移动端 viewport
- 死链接有 noindex，不至直接入索引
- 响应 `cache-control: public, max-age=60, must-revalidate`（分享可被撤销，短 TTL 合理）

### 2.2 未达标 ❌（按影响排序）——均已修复，见 §4

| # | 缺口 | 实测证据（审计时） | 影响 | 状态 |
|---|---|---|---|---|
| 1 | 无 `<link rel="canonical">` | `curl` 页面无该标签 | 搜索引擎靠 canonical 消除重复 URL（含尾参变体）；缺失会被自行猜测 canonical 或重复收录 | ✅ 已修（P0-1） |
| 2 | 死链接返回 **200** 而非 404 | 不存在 token 与任意不存在路径均 200 | Google 定义的 soft-404：浪费抓取预算，死链接仍可能以 200+noindex 进入索引流程 | ✅ 已修（P0-2 + P0-5） |
| 3 | `/sitemap.xml` 返回 HTML 200 | content-type `text/html`，内容是首页壳 | 爬虫请求 sitemap 拿到 HTML 会直接报解析错误 | ✅ 已修（P0-3） |
| 4 | SSR 正文是原始 markdown | `**分享**` 等字面符号残留在 HTML | Googlebot 执行 JS 不受影响；非 Google 爬虫 / 社交抓取拿到半渲染文本 | ✅ 已修（P1-B，marked 服务端渲染） |
| 5 | 页面过重 + 布局跳动风险 | 渲染一条笔记需加载整个 React 应用（index 364KB + vendor 合计 gzip 400KB+）；React 挂载时替换 SSR 节点 | CLS 是 Core Web Vitals 排名因子；分享页的理想形态是几十 KB 的独立轻量 HTML | ✅ 已修（P1-B 独立页，实测约 6KB / 零 JS） |
| 6 | og:image 无尺寸声明、无 alt；无 og:locale | — | Telegram / iMessage 等客户端可能因缺尺寸不出预览图；多语言实例下 lang 硬编码 zh-CN | ✅ 已修（P0-4） |

---

## 3. 最佳实践基准（对照谁）

以 Google Search Central（页面体验 / 结构化数据 / 爬取与索引）、Open Graph protocol、Twitter Cards、schema.org 为基准。以下判定均可在 Search Central 文档对应：

1. **可抓取**：robots.txt 准确；无意外拦截；内部资源公开可访问。
2. **可索引**：每页有唯一 title / description / canonical；状态码语义正确（200=存在，404=不存在，410=已删除）；无 soft-404。
3. **内容可读**：不依赖 JS 也能拿到完整正文（渐进增强）。
4. **结构化数据**：使用 schema.org 合理类型并可通过 Rich Results Test 验证。
5. **社交抓取**：OG / Twitter 卡片完整，og:image 绝对 URL + 尺寸 + alt。
6. **页面体验**：轻量加载、无 CLS、Core Web Vitals 达标。
7. **明确没有的东西要显式说没有**：没有 sitemap 就让 `/sitemap.xml` 干净 404，而不是返回假 200。

---

## 4. 改造方案

### P0：小改一次补齐（低风险，半天内）

**P0-1 canonical 标签**（对应 Gap 1）
- `share-page.ts` 的 head 注入块中追加：
  `<link rel="canonical" href="${canonical}" />`（与 og:url 同值，均源自 `publicOrigin()`）。

**P0-2 死分享返回 404**（对应 Gap 2 前半）
- `share-page.ts` 的 catch 分支：`status: 200` → `status: 404`，shell 照常渲染（用户仍看到"分享不可用"空状态），但对爬虫语义正确。
- 注意 `renderShareHtml` 目前只在 shell 状态为 200 时返回 200，死分享路径不经过它，改 catch 分支即可。

**P0-3 `/sitemap.xml` 干净 404**（对应 Gap 3）
- worker 加一条 `app.get("/sitemap.xml", () => 404)`（或统一在 notFound 前拦截），返回纯文本/空体，杜绝假 200 HTML。
- **不做**全量 sitemap：分享 token 设计上不可枚举（防遍历），枚举输出等于泄漏全站分享链接，是隐私回退。

**P0-4 og:image 尺寸与 alt、og:locale**（对应 Gap 6）
- 图片附件行的 payload 如带宽高则注入 `og:image:width/height` 与 `og:image:alt`（alt 取附件 filename 或正文图片描述）；取不到就省略，不硬造。
- `og:locale` 按 html lang 同步（默认 `zh_CN`）。

**P0-5 未知路径 404**（对应 Gap 2 后半，范围决策）
- SPA 兜底把全站任意路径都变成 200 壳，是全站性 soft-404 源。改法：`createFlareMoApp` 的 `notFound` 对**非资产、非已知前端路由**返回 404 状态码 + 壳（前端路由表是已知集合，可从 TanStack Router 的 route tree 白名单校验）。此项涉及前端路由表维护，风险略高于其余 P0，可以单独拆出去做。

### P1：结构性改造——独立轻量分享页（对应 Gap 4 + 5，收益最大）

把 `/share/:token` 从"SPA 壳 + React 注入"改为**worker 直出的独立 HTML**：

- 服务端用与 web 端一致的 markdown 渲染器（或轻量子集）把正文渲染成真正 HTML（标题、加粗、链接、代码块、图片）。
- 页面只带必要内联样式（阅读排版 + 暗色适配），**不加载 React 应用**：目标 gzip 传输 < 50KB、零 JS（或仅一段小脚本处理图片预览）。
- 浏览器端体验取舍：独立页不再有"查看原笔记 / 附件交互"等 SPA 能力。两种策略二选一：
  - **A. 双响应（推荐起步）**：按 UA 分流——爬虫 / 社交抓取拿轻量 HTML，人类浏览器仍拿现行 SPA（React 清除 SSR 节点的逻辑保留）。风险：UA 判断本质不可靠，Google 明确不鼓励 cloaking 式分流，但内容完全一致时属"动态服务"（dynamic serving），合规前提是**两边内容一致**。
  - **B. 全面轻量化**：人类也拿轻量 HTML，页面底部放"用 FlareMo 打开"链接进 SPA。体验最干净，Core Web Vitals 直接达标，但分享页功能收敛为纯阅读。
- 实施落点：`share-page.ts` 内新增渲染器模块（纯函数、可单测）；`run_worker_first` 已就绪，无需再动 wrangler。

### 可选增强（不阻塞上述两阶段）

- **per-share `noindex` 开关**：share 表加一列（或 payload 字段），创建分享 UI 暴露"允许搜索引擎收录"开关，服务端据此决定 `index, follow` / `noindex, nofollow`。满足"可社交预览但不被搜索收录"的半私密诉求。
- **JSON-LD 扩展**：视内容形态可换/加 `Article`、`FAQPage` 等类型；上线后用 Google Rich Results Test 验证一次。

---

## 5. 验收标准（每阶段跑一遍）

用 curl 断言清单即可，不需要完整 e2e：

```bash
U=https://flaremo.kosx.ai/share/<有效token>
# 1. canonical 与 og:url 一致且为绝对 URL
curl -s $U | grep 'rel="canonical"'
# 2. 死分享 404（状态码，非 200）
curl -s -o /dev/null -w "%{http_code}\n" https://flaremo.kosx.ai/share/<伪造token>   # 期望 404
# 3. sitemap 404
curl -s -o /dev/null -w "%{http_code}\n" https://flaremo.kosx.ai/sitemap.xml          # 期望 404
# 4. og:image 尺寸/alt 存在（有图分享时）
# 5. robots.txt 200 且 Allow /
# 6. P1 后：无 JS 爬虫（curl 无 Accept-Language 等伪装）拿到的正文不含 markdown 字面符号
# 7. P1 后：传输体积 < 50KB（爬虫路径）
```

工具验证（人工、一次性）：Google Rich Results Test（JSON-LD）、Facebook Sharing Debugger（OG）、Google Search Console URL 检查（若实例需要被收录）。

---

## 6. 边界与明确不做

- **不为被收录而枚举分享**：sitemap / 内链不输出 token 列表，防遍历优先于收录覆盖面。
- **不做 UA 欺骗性内容差异**：dynamic serving（若采用 P1-A）两边正文必须一致，仅排版不同。
- **robots.txt 不全局禁止** `/share/`：默认开放收录；是否可收录下沉到 per-share 开关（可选增强）。
- 本文档不涉及登录态页面（`/memos` 等）的 SEO——它们不该被收录，SPA 现状（无 meta）反而是正确行为。
