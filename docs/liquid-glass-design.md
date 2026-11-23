# Liquid Glass（液态玻璃）材质三端统一技术方案

状态：**已实施（2026-09-19）**：基线配方落地——token + `.glass` + 降级块 + P0 四落点，验收门禁全绿（biome / vitest 4 / tsc 双配置 / build / dev 冒烟 200）；折射层按定案不做（配方存档 §5）。拍板理由：iOS 全浏览器内核为 WebKit（Bug 245510 未修，Safari 26/27 均未支持），折射受众只剩桌面 + Android blink，为这一个增强层维护探测/降级/位移图三套机制不值。
日期：2026-09-19（三轮修订）
范围：apps/web（应用）+ apps/worker（分享页 SSR 模板）+ apps/site（官网）；零新增 npm 依赖、零 worker 业务逻辑改动
前置：社区调研结论（2026-09-19 会话）——真折射只有 Chromium 可跑，方案核心是「统一规格、分层降级」

---

## 1. 背景与定位

iOS 26 的 Liquid Glass（下称"玻璃材质"）与现有毛玻璃（`backdrop-blur`）的本质区别：毛玻璃是把背景糊掉，玻璃材质是把玻璃面当成**透镜**——边缘处对背后内容做折射（displacement），叠加镜面高光描边，中心区轻度模糊 + 提饱和。

与设计原则的关系：玻璃材质是"简约不简单，克制不放肆"的正向案例——表面安静、细节昂贵。**只用于悬浮层，不进内容区**，与 Ember 现行层级规则（页面 → 卡片 → 浮层）完全同构：玻璃就是"浮层"这一级的新材质，不是新层级。

## 2. 「三端统一」的准确定义

先把话说透：**逐像素三引擎一致今天做不到，也不该承诺。** 真折射依赖 `backdrop-filter: url(#svg-filter)`，Safari 是 WebKit Bug 245510（未修），Firefox 会解析该语法但渲染为空（`@supports` 检测会误报）。任何"三端完全一致"的方案都意味着放弃折射或放弃 Safari/Firefox。

本方案的"统一"落在三个可交付的层次：

| 层次 | 统一物 | 说明 |
|---|---|---|
| 规格统一 | 一套 `--glass-*` token | 明暗、强度、色调全部参数化，三处使用面同一份语义 |
| 代码统一 | 一份配方 CSS（`.glass` 类） | 单文件、纯 CSS、无框架绑定，三个 app 各自引入 |
| 观感统一 | **基线配方 = 三引擎契约** | Chromium / WebKit / Gecko 渲染同一种"玻璃 2.0"观感；折射是 blink 独占增强层，其余引擎自动且不可感知地降级 |

"三端"在此有双关定义，方案同时覆盖：**三个使用面**（apps/web 应用、apps/worker 分享页、apps/site 官网）× **三种引擎**（Blink、WebKit、Gecko）。

> 三轮定案（2026-09-19）：折射层取消，基线成为唯一配方——三引擎走完全相同的滤镜函数，"观感统一"从契约变成事实。

## 3. 效果解剖与引擎支持矩阵

玻璃材质拆成三个成分：

1. **边缘折射**：背后内容按透镜法线位移采样（`feDisplacementMap` + 预生成的圆角矩形法线贴图）
2. **镜面高光描边**：1px 渐变边（上亮下暗），玻璃观感一半来自它
3. **模糊 + 提饱和**：`blur + saturate`，现有毛玻璃的加强版

| 成分 | Blink | WebKit | Gecko | 实现载体 |
|---|---|---|---|---|
| 模糊+提饱和 | ✅ | ✅ | ✅ | `backdrop-filter: blur() saturate()` |
| 镜面描边 | ✅ | ✅ | ✅ | 渐变 + `mask-composite` |
| 边缘折射 | ✅ | ❌（Bug 245510） | ❌（解析但不渲染） | `backdrop-filter: url(#…)` |

## 4. 架构：三层，一层比一层薄

```
┌─ 配方层 ─ glass 段落（index.css / tokens.css 内的纯 CSS 类）──────┐
│  .glass = 基线配方（三引擎契约）                                     │
│  [data-glass-engine="blink"] .glass--refract = 折射增强             │
│  降级块：reduced-transparency / kill switch                        │
├─ 适配层 ─ 引擎探测（唯一的一小段 JS）────────────────────────────┤
│  内联 bootstrap 脚本输出 <html data-glass-engine="blink|webkit|gecko">│
├─ token 层 ─ --glass-*（index.css @theme 区，.dark / [data-accent] 继承）┤
└──────────────────────────────────────────────────────────────┘
```

**零 React 组件**：配方就是 CSS 类，任何使用面直接 `className="glass"`，Tailwind v4 下天然支持变体组合。不引入 `GlassSurface` 组件——当前落点（见 §9）全部是给现有组件加一个类名，没有 props 需要抽象。

### 4.1 token 层

`apps/web/src/index.css`（现 648 行）新增一段：

```css
:root {
  --glass-blur: 18px;
  --glass-saturate: 1.7;
  --glass-tint: oklch(1 0 0 / 0.62);        /* 玻璃底色 */
  --glass-rim: oklch(1 0 0 / 0.9);          /* 描边高光端 */
  --glass-edge: oklch(1 0 0 / 0.28);        /* 描边暗端 */
  --glass-shadow: oklch(0.2 0.02 60 / 0.16); /* 暖调投影，对齐现行暖阴影规范 */
}
.dark {
  --glass-tint: oklch(0.22 0.012 60 / 0.55);
  --glass-rim: oklch(1 0 0 / 0.24);
  --glass-edge: oklch(1 0 0 / 0.08);
  --glass-shadow: transparent;               /* 暗色不用阴影表达层级（现行规范） */
}
```

要点：

- **玻璃保持中性色，不染 accent**（v1 决策）。`[data-accent]` 换色对玻璃零影响，省掉 8 套预置 × 明暗 × 材质的组合矩阵；想要品牌感靠 rim 的白高光和底层内容的透出，不需要染色。
- 暗色值需在 M1 目检微调，上表是推导起点（表面明度阶梯 0.155/0.21/0.235 的邻域）。
- 官网（apps/site）沿用既有决策：Paper token 体系独立，**不合并变量**，将 §4.3 配方段连同一组等价 token 抄入 `apps/site/src/styles/tokens.css`（自包含段落，约 60 行）。

### 4.2 适配层：引擎探测（**拍板后整体不做**，存档备用）

没有折射就没有分支需求：Firefox 误报只影响 `url()` 滤镜，基线配方三引擎都安全。以下方案仅在未来启用折射时才需要。

一段 ~15 行内联脚本进 `index.html` head（与现有暗色/主题 bootstrap 同位置同模式），**首帧前**写出属性，无 FOUC：

```js
// 顺序：userAgentData（仅 Chromium 有）→ Firefox → Safari
const e = navigator.userAgentData?.brands?.some(b => !/Not.A.Brand|Chromium/i.test(b.brand)) || /Chrome|Chromium|Edg\//.test(navigator.userAgent) ? "blink"
  : /firefox|FxiOS/i.test(navigator.userAgent) ? "gecko"
  : "webkit"; // 兜底 webkit = 基线配方，最安全
document.documentElement.dataset.glassEngine = e;
```

- **为什么不用 `@supports`**：Firefox 对 `backdrop-filter: url()` 返回 true 但什么都不渲染，玻璃会变成一块透明塑料布。引擎探测是唯一可靠分支依据。
- **为什么服务端不做**：SSR（分享页）不输出该属性 → CSS 默认走基线配方，天然 no-JS 安全。
- iOS 上所有浏览器（含 Chrome iOS）都是 WebKit，落进 webkit 分支拿基线——正确。
- 未来 WebKit 修复 Bug 245510 后，把 webkit 分支也打开折射即可，一处改动。
- **三道门收敛为一个属性**：bootstrap 计算「引擎 = blink 且设备达标且未被降级」→ 输出 `<html data-glass-refract="on">`（引擎能力另存 `data-glass-engine` 供调试）；CSS 折射分支只认 `data-glass-refract`，运行时降级 = 摘属性，CSS 零改动。

### 4.3 配方层

**基线配方（三引擎契约）：**

```css
.glass {
  background: var(--glass-tint);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  box-shadow:
    0 12px 32px -12px var(--glass-shadow),
    inset 0 1px 0 var(--glass-rim);          /* 顶部内高光 */
}
/* 镜面渐变描边：1px 边框环 */
.glass::after {
  content: ""; position: absolute; inset: 0;
  border-radius: inherit; padding: 1px;
  background: linear-gradient(160deg,
    var(--glass-rim), transparent 38%, transparent 62%, var(--glass-edge));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  pointer-events: none;
}
```

**折射增强（拍板后不启用，存档）：**

```css
[data-glass-refract="on"] .glass--refract {
  backdrop-filter: url(#lg-refract) blur(var(--glass-blur)) saturate(var(--glass-saturate));
}
```

**降级块（无障碍 + 紧急开关）：**

```css
@media (prefers-reduced-transparency: reduce) {
  .glass { background: var(--card); -webkit-backdrop-filter: none; backdrop-filter: none; }
  .glass::after { display: none; }
}
:root[data-glass="off"] .glass { /* 同上：一键全站回退实心卡 */ }
```

## 5. 折射实现细节（**已拍板不做，本节存档**——WebKit 修复 Bug 245510 后按此启用）

**位移图**：圆角矩形 SDF 的法线编码为 RGB（R = 法线 x，G = 法线 y，中性区 0.5/0.5），边缘带宽约 10px。`feDisplacementMap` 的语义是 `backdrop(p + scale × (map − 0.5))`——边缘处法线朝外，背景被"透镜"拉开。

- 由一次性脚本 `scripts/generate-glass-maps.mjs` 程序生成（纯 Node，无依赖），PNG 以 base64 内联进一个 TS 模块（每档 ~2–4KB）。生成脚本与产物都入库，可复现。
- **半径档位静态化**：`feDisplacementMap` 的 `scale` 是 SVG 属性，**吃不到 CSS 变量**。预生成 3 档（对应浮层圆角基准：14px 浮层 / 16px 弹窗 / 24px 大卡），即 3 个 `<filter>` id，`.glass--refract` 默认挂 14px 档。
- **两个必踩的坑，直接写死对策**：
  1. `<filter>` 必须带 `color-interpolation-filters="sRGB"`——默认 linearRGB 会把透出的背景染灰，这是所有 SVG 滤镜 demo「看着发脏」的头号原因；
  2. `feImage` 用 `preserveAspectRatio="none"` 铺满 filter region，极端长宽比下圆角处法线会轻微失真——固定档位半径 + 目检把关，不可接受再上 M3 的运行时生成。
- **SVG defs 单例**：`<svg width="0" height="0" aria-hidden>` 只注入一份。应用端放在 App 根（与 Portal 浮层同树）；分享页 SSR v1 不注入（分享页只用基线，见 §9）。
- **混合链风险**：`url(#f) blur() saturate()` 混合 filter list 在 Chromium 的 backdrop-filter 上按社区 demo 是可行的，但属本方案唯一没有一手实测的环节——**M0 第一件事就是验证它**；若实测不支持，退路是把 blur 留在元素、折射单独放 `::before` 层（成本：多一次合成采样，仍然可行）。

## 6. 性能策略与护栏（拍板后收窄）

折射取消后玻璃成本 = blur 本身（与现役 Dialog 遮罩的 `backdrop-blur-xs` 同量级、面积更小），设备门/运行时门随之取消，但护栏仍然成立：

1. **面积上限**：玻璃面 ≤ 视口 1/4；落点全部是天然小面的浮层（§9），没有全屏玻璃。
2. **禁区**：composer、MemoCard、时间线长列表内部——背后高频重绘（打字/滚动）会让采样成本爆炸，也是可读性灾区。
3. **禁止玻璃嵌套**：玻璃面上再开玻璃浮层 = 双重采样。Dialog 内不再加类（Dialog 本身已是玻璃，Spotlight 天然覆盖）。
4. **动画纪律**：只准动 `transform/opacity`（现行规范本来如此）；**严禁**对 `--glass-blur` 做过渡动画——backdrop-filter 插值是逐帧重算。液态 morph 形变动画明确不做（§12）。

## 7. 无障碍与明暗

- `prefers-reduced-transparency: reduce` → 实心卡降级（§4.3）；`prefers-reduced-motion` 由 index.css 现行全局兜底块覆盖，无需新逻辑。
- 对比度验收项：玻璃上正文文字对"最坏背景"（玻璃亮度极限）≥ 4.5:1，纳入 M1 目检清单；`--glass-tint` 的 0.62/0.55 不透明度就是为此预留的调节旋钮。
- 暗色：rim 减弱、投影归零（现行"暗色不用阴影"规范），层级靠 tint 深度。

## 8. 与现有体系的关系

| 现行体系 | 关系 |
|---|---|
| Ember token（`--brand-*`、`.dark`、`[data-accent]`） | `--glass-*` 同区并列；玻璃中性无色，换主题色零影响 |
| Dialog/Sheet 遮罩的 `supports-backdrop-filter:backdrop-blur-xs` | 不动。遮罩是压暗层不是玻璃；玻璃加在浮层内容容器上 |
| 圆角基准（`--radius: 0.625rem`，Ember 2：控件 10px、卡片 14px、弹窗 18px） | 折射位移图档位与之对齐（§5），不新增圆角档 |
| 官网 Paper 独立 token | 不合并；配方段自包含抄入（§4.1），与"官网不与应用共刷变量"的既有决策一致 |
| 杀伤性开关 | `<html data-glass="off">` 一行回退全站实心，留给管理端/应急 |

## 9. 落点清单（待挑项）

全部是"现有组件加一个类名"级别的改动。拍板后无折射档：所有端、所有设备走同一份基线配方，无任何分支：

| 优先级 | 落点 | 端 | 改法 |
|---|---|---|---|
| P0 | Dialog 浮层内容容器（Spotlight、设置、确认弹窗全走它） | web | `DialogContent` 加 `glass glass--refract` |
| P0 | Sheet（移动端抽屉） | web | 同上 |
| P0 | Sonner toast | web | `ui/sonner.tsx` 主题配置处加类 |
| P0 | 阅读页吸顶音频条（`reading-audio-bar.tsx`） | web | 加类（半高吸顶条，玻璃收益最直观的面） |
| P1 | 分享页头卡 | worker SSR | 基线配方 only（无 JS、无折射，永久基线） |
| P1 | 登录页卡片 | web | 加类 |
| P1 | 官网导航栏 / hero 卡 | site | 抄入配方段后加类 |
| 不做 | composer、MemoCard、时间线列表 | — | §6.3 禁区 |

## 10. 里程碑与工作量

| 阶段 | 内容 | 工时 |
|---|---|---|
| 实施 | token + 基线配方 + P0 四落点（无引擎探测、无 SVG、无降级器；直接在真实落点目检，不再要 demo 路由） | 0.5 天 |
| 可选 | 分享页头卡 + 官网接入（视 Kim 是否要官网一起） | 0.5 天 |
| 存档 | WebKit 修复 Bug 245510 后按 §5 启用折射 | 另议 |

## 11. 验收与门禁（按既定节奏）

- tsc + 定向 vitest：降级块（reduced-transparency / kill switch）生效断言（无探测代码即无探测单测）
- biome format 先过；`pnpm build` 通过
- dev 目检清单：桌面 Chrome / Android Chrome / Safari 真机（四落点同一基线观感）/ Firefox / 暗色 / `prefers-reduced-transparency` 模拟
- **不跑 Playwright**（不主动跑 e2e，Kim 明确要求才跑）

## 12. 明确不做（非目标）

- WebGL / 整页折射——读不到 DOM 背景，只适合营销 demo，与我们无关
- 逐像素跨引擎一致——物理上做不到（§2），不做假承诺
- 液态 morph 形变动画（玻璃元素合并/分裂）——动效成本高、收益存疑，M3 再议
- 全站材质化——违反克制原则，玻璃只属于浮层
- 原生端——没有原生 app，PWA 即 web

## 13. 风险与回滚

| 风险 | 对策 |
|---|---|
| 低端设备 blur 掉帧 | 面积护栏（§6）；`data-glass="off"` kill switch |
| 未来启用折射 | WebKit 修复 Bug 245510 后按 §5 存档配方启用，改动集中一处 |
| 视觉回归（现有浮层样式） | 玻璃类是纯增量，出问题删类名即回滚，无迁移成本 |
