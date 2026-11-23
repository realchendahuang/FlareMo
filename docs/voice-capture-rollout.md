# 语音体验升级方案（决策稿）

> **v0.24.0 起**：独立的 `/capture` 录音页已删除，语音输入只保留在输入框的麦克风按钮里；本文描述的 Worker 桥接、服务商适配与限额不变，页面相关段落仅作历史记录。

> 状态：**已执行**（P0–P4 已全部落地，2026-09-17，见 §0 执行记录）。范围 = 全部五期。决策点定案：D1 **暂停/续录做进 P1**（修订原推荐）、D2 客户端切片、D3 **Opus 压缩**（修订原推荐）、D4 先保文字、D5 徽章+时长、D6 跳详情页。动工前置：与并行会话收口工作区（见 R1）。
> 前置定调：[asr-minimax.md](./asr-minimax.md)——语音转文字采用 MiniMax（批式），流式三家（豆包/阿里/腾讯）保留为 `/capture` 实时路径。
> 原则约束：`docs/design-system.md`「简约不简单，克制不放肆」；本方案所有动效均从 `apps/web/src/index.css:83-93` 既有原语取材，**不引入动画库**。design-principle-rollout 的「无装饰性循环动画」白名单已显式包含**录音波形**——本方案的核心炫点是被原则预授权的。

核心结论：`/capture` 是全站动效最少的页面（仅 1 处 `motion-safe:animate-ping` vs composer 3 处），design token 里现成的 `--animate-rise/fade/scale-in/shimmer` 与 `--ease-signal` 一个没用；录音中没有任何声音可视化，用户无法确认麦克风在收音；两个上限（1h/90000 字）零呈现；语音 memo 在时间线里与普通 memo 完全同构。分五期整改：P0 细节修补 → P1 录音页质感 → P2 MiniMax 批式管道 → P3 录音闭环 → P4 分发收尾。P0/P1 纯前端可先行，P2→P3 顺序固定。

---

## 0. 分期总览

| 期 | 主题 | 层 | 依赖 |
|---|---|---|---|
| P0 | 细节修补（上限/反馈/a11y/触控） | web | 无 |
| P1 | 录音页质感（波形/大圆钮/暂停续录/动效） | web | 无（可与 P0 并行） |
| P2 | MiniMax 批式 ASR 管道 | contracts+worker+web | 无 |
| P3 | 录音闭环（音频落 R2+时间戳+时间线面孔） | 三层 | P2 |
| P4 | 分发收尾（PWA/mediaSession/发现性） | web+文档 | P3（mediaSession/时间线音频）|

> **执行记录（2026-09-17）**：状态从「待执行」改为**已执行**。实际提交：P0 `49733fb` → P1 `84ec3d2` → P2 `45bb308`（worker）+ `1a23279`（web）+ `5ec8f06`（key 对齐修复）→ P3 `99563f6` → P4 见本行下方最新提交。

验收口径（全期统一，按既定敏捷节奏）：`tsc` + 定向 vitest + build + dev 目检；**Playwright 仅在 Kim 明确要求时跑**。

---

## 1. P0 · 细节修补（无争议项）

### 1.1 上限可见化

现状：1 小时与 90000 字上限在 UI 上完全不可见，越线瞬间 `stop("limitReached")`（controller.ts:208-214, 307-313），说到一半被静默截断。

- 计时卡下方加细进度条：宽度 = 已录时长/1h；`capture-page.tsx:424-454`。
- 剩余 ≤5 分钟：进度条转警示色 + 状态行追加提醒文案；到 1h 才截断（行为不变，呈现提前）。
- transcript log 底部加小字计数 `12,340 / 90,000`（与 textarea maxLength 同源，`capture-page.tsx:533-554`）。
- review 态 textarea 下方同款计数（`capture-page.tsx:457-472`）。

### 1.2 保存/测试反馈补齐

- 保存按钮 saving 态加 `Loader` + `animate-spin`（对齐 memo-detail-page.tsx:501 惯例），位置 `capture-page.tsx:514-528`。
- 保存成功 toast（"已保存"）再跳 memo 详情（跳转行为保留，见 D6）。
- voice-panel 保存/测试按钮加同款 spinner；底部无色 `role="status"` 文本（voice-panel.tsx:289）统一升级为 toast（成功/失败分色），保留文本行作为兜底。

### 1.3 a11y

- transcript log（`aria-live="off"`, capture-page.tsx:536）：加一个视觉隐藏镜像节点 `aria-live="polite"`，**只播报最新定句**（partial 不进播报，避免读屏轰炸）。
- 进度条补 `role="progressbar"` + aria 值。

### 1.4 触控与 haptics

- 主/停止操作目标在 P1 大圆钮落地前先垫高：录音态停止钮改 `h-11`；移动端标签控件保持现状。
- `navigator.vibrate`（特性检测守卫，全仓现无一处，新增封装 `lib/haptics.ts`）：开始/停止 5ms，保存成功 10ms。iOS Safari 无效是已知平台限制，Android/PWA 生效。

### 1.5 i18n 欠账

- 补齐 `capture.*` 约 8 条 en-US-only 键到其余 7 语言（en 56 vs 其他 48，见附录 A-B4）；新增文案键全部走 8 语言 + TranslationKey 类型强制对齐（tsc 拦截漏翻）。
- 新增文案草稿（en/zh，其余语言落地时手译）：

| key | en | zh |
|---|---|---|
| capture.nearLimit | About 5 minutes left before the recording limit. | 距离录音上限还剩约 5 分钟。 |
| capture.charsUsed | {count} / {max} characters | 已写 {count} / {max} 字 |
| capture.saveSucceeded | Saved. | 已保存。 |
| capture.transcribing | Transcribing… | 转写中… |

### P0 验收

上限条在 59 分钟处显示警示色；保存按钮出现 spinner 且成功 toast 弹出；读屏可听到定句；`tsc` 全绿（8 语言键对齐）。

---

## 2. P1 · 录音页质感（炫酷主体，全部用既有原语）

### 2.1 实时波形（核心）

- `microphone.ts` 管道已持有 MediaStream，接一个 `AnalyserNode`（fftSize 512，时间域）→ capture 页 canvas 绘制 oscilloscope 式波形条。
- 规格：高 ~48px、宽随容器、`stroke=primary`（跟随主题色）、2px 线宽；静音时近水平线（不消失），有声时起伏——**这是信息不是装饰**，回应「无法确认在收音」实锤 A-1。
- `requestAnimationFrame` 仅在 `microphoneActive` 时运行，停止即停帧；`prefers-reduced-motion` 下保持绘制（信息性）但禁用入场/呼吸类动画。页面其余动画全部走 `motion-safe:`。

### 2.2 大圆录音钮（一钮化状态机）

现状：开始/停止是两个 36px 文本钮（capture-page.tsx:556-578）。

- 新组件 `CaptureButton`：圆形 72px。
  - idle：品牌渐变底 + Mic 图标；
  - recording：红底 + Square 图标 + `--ease-signal` 呼吸环（真实状态指示，白名单允许）；
  - connecting/stopping：图标位换 spinner，禁点；
  - `active:scale-95` 按压反馈，颜色过渡 140ms。
- 键盘：页面聚焦态 `Enter` 触发开始/停止（`Space` 有滚动冲突不绑）；`?` 快捷键弹窗加「开始/停止语音记录」条目（App.tsx:700-704）。
- 移动端触摸目标随之达标（72px > 44px）。

### 2.3 转写区动效

- 定句：`animate-rise` 入场（200ms 上移 8px，原语现成）；partial 行：`text-muted-foreground/70` + 轻微透明度脉动（属真实状态指示，不违反 pulse 禁令）。
- 录音→review 过渡：不再三元硬切（capture-page.tsx:455），review 表单以 `animate-rise` 入场、log 以 `animate-fade` 退场（各 ≤320ms，符合 index.css:84 规范）。
- 批式模式的"转写中"等待态用 `--animate-shimmer` 骨架条（P2 接线，P1 先铺样式）。

### 2.4 暂停/续录（D1 定案）

- controller 状态机加 `paused` 态（recording ↔ paused 双向）；暂停 = **停止向 ASR 发帧**（流式与批式同），音频编码器继续产静音帧保持**时间轴连续**——转写时间戳与音频时间轴天然对齐，流式供应商也不为暂停时段计费。
- 大圆钮第三态：暂停图标（Pause），再按即续录；计时器继续走，1h 上限按会话计（含暂停段）。
- 断线 gap 与人为暂停在正文 gap 提示中区分显示（暂停是用户意图，不算事故）。
- 流式/批式两种模式行为一致。

### 2.5 明确不做

- 打字机逐字效果（与逐句转写节奏不符）、重录按钮（Discard→重开已够）。

### P1 验收

录音时波形随人声起伏；新句 rise 入场；一钮完成开始/停止；录音→预览有过渡无跳变；reduced-motion 下动画归零但功能完整。

---

## 3. P2 · MiniMax 批式 ASR 管道

契约与 provider 事实以 [asr-minimax.md](./asr-minimax.md) 为准，此处只列工程落地。

### 3.1 契约（packages/contracts + worker）

```ts
// 批式与流式产出同一归一化格式（毫秒时间轴）
interface BatchAsrProvider {
  transcribe(chunks: AsyncIterable<{ data: Uint8Array; startMs: number; lang?: string }>,
             opts): AsyncIterable<Utterance>;  // { startMs, endMs, text, speaker? }
}
```

- 新适配器 `apps/worker/src/asr/minimax.ts`：`POST {base}/v1/speech_to_text`，multipart，`response_format=verbose_json`（`segments[]` → Utterance 映射），`language` 透传（默认 `zh`）。只用 verbose_json；不碰 `stream=true`。
- base URL 可配：默认国内 `https://api.minimaxi.com`，`FLAREMO_ASR_MINIMAX_BASE_URL` 或面板字段可切国际 `api.minimax.io`。
- 错误映射对齐 volcengine 惯例：401/403→authentication、429→capacity（retryable）、400（>500s）/413（>50MB）→configuration；断言单请求 ≤480s/≤50MB。

### 3.2 Worker 代理端点（key 永不进浏览器）

- `POST /api/app/capture/transcribe`：session 鉴权；请求体为 **裸 `application/octet-stream`**（单 chunk ≤16MB）+ query `startMs`/`language`；worker 端组 multipart 转发 MiniMax（复用 capture 限流桶）。
- 超时 `AbortSignal.timeout(120s)`；响应 `{ utterances, durationMs }`；`asr_seconds` 计入 per-user usage（`incrementUsageCounter`，补齐现有体系唯一缺口）。

### 3.3 客户端（apps/web）

- `lib/audio-capture/pcm.ts` 已产 16k mono s16le 帧：**WAV 封装**（44 字节 RIFF 头，见 D3）后按 480s 切片（15.36MB/片 < 50MB），时间戳按 `startMs + segment` 偏移拼接；单 chunk 失败重试 1 次，再败则会话失败走草稿兜底。
- capture 页模式判定：`capture-status.available` 扩展为「流式或批式任一已配置」；**单活跃 provider**（沿用现有面板单选语义）：配流式 → 实时 log 照旧；配 MiniMax → 录完再转（停止后 shimmer 骨架 → review）。两种模式的录音主体代码共用。

### 3.4 配置

- `voice_service_config` 存 provider `minimax` + apiKey + baseUrl（信封加密复用，kosx `FLAREMO_VOICE_CONFIG_KEY` 已就位）；env 侧 `FLAREMO_ASR_MINIMAX_API_KEY`（**kosx secret 已在**，命名即为此预留）。
- voice-panel 加 MiniMax 选项（key 掩码尾 4 位、测试连接改为「发 3 秒静音 WAV 真转写」——明示会产生套餐额度消耗）；8 语言 label 齐套。

### P2 验收

dev 环境用测试 key 实转一段 30s 音频出带时间戳文本；>500s 会话切两片拼接正确；key 不出现在任何网络响应/日志；用量面板出现 asr_seconds。**上线 kosx 后核对：扣的是 Token Plan 进度条不是现金余额。**

---

## 4. P3 · 录音闭环（音频落 R2 + 时间戳 + 时间线面孔）

### 4.1 音频留存

- 会话停止后（review 之前）上传音频：**复用既有附件上传管线**（R2 + `/file/`，与 composer 同路），不建新管道；进度用 shimmer 骨架呈现。
- 格式（D3 定案 = **Opus**）：P2 的批式上传已要求容器化音频——用浏览器 WASM ogg-opus 编码器（如 opus-recorder，随 PCM 帧实时编码）产出的同一份 ogg/opus 直接落 R2（≈16MB/时）；**编码器初始化失败降级 WAV**（44 字节 RIFF 封装，≈32MB/时），blob 格式跟随实际容器，后续链路对格式不敏感。
- 失败降级（D4）：上传失败不阻塞保存——先存 transcript-only memo +「原始音频未保存」提示；不重试超过 1 次。
- **保存原始音频开关**（review 态，默认开，localStorage 记忆）：企业实例成员可自行选择不留音频（R2 成本/隐私自主权，见 R5）。

### 4.2 memo 产出扩展

- payload 增 `durationSeconds`、`audioAttachmentId`（contracts 同步，向后兼容可选字段）。
- 正文逐句加时钟标记 `[mm:ss] 句子`——`transcript.ts:72-121` 的解析器已支持该格式，落库即接通可点击 seek。

### 4.3 阅读视图

- `memo-reading-view.tsx:197-210` 的音频条链路自动生效（payload 带 audio 附件即走 `ReadingAudioProvider` + 段落高亮 + seek），**零新增阅读层代码**；仅需确认 capture 产出的 markdown 能被现有 cue 解析吃下。
- 时间线：`memo-card.tsx` 读 `source==="voice"` → 卡片头部 mic 图标徽章 + 时长 chip（取 payload.durationSeconds）；**不内嵌播放条**（D5，播放归详情页）。

### P3 验收

录完 → memo 带音频附件，详情页出现音频条，点时间戳/开 follow 能高联滚动；时间线卡片有语音面孔；关闭开关时行为退回 P2 状态。

---

## 5. P4 · 分发收尾

- PWA：manifest `shortcuts` 加 `/capture`（短名 "语音"/"Capture"）；现有 shortcuts 名称硬编码中文（site.webmanifest:39,51,63）先记为已知债，动态 manifest 不在本期。
- `mediaSession`：`reading-audio-provider.tsx` 对存在音轨的 memo 设置 metadata + play/pause 处理，锁屏/通知栏可控。
- 发现性：capture 页 `unavailable` 文案分角色——owner 显示「去设置」链接（账户 → 语音识别设置），成员显示「请联系实例所有者开启」（数据源：`/me` 已有 `can_manage_voice_service`，无需新接口）。
- 文档：`wrangler.jsonc.example` 补 `FLAREMO_ASR_MINIMAX_API_KEY/BASE_URL`、`FLAREMO_VOICE_CONFIG_KEY` 示例注释（asr-minimax.md 的 checklist 收口）。

---

## 6. 决策点（推荐项已标）

| # | 决策 | 推荐 | 理由 |
|---|---|---|---|
| D1 | 暂停/续录 | **定案：做进 P1**（Kim 修订） | 状态机加 paused；停发 ASR 帧 + 编码器静音帧保持时间轴连续；暂停不计费 |
| D2 | >500s 切片位置 | **定案：客户端** | client 已持有 PCM 帧，零过网浪费；worker 只需校验单片 ≤50MB |
| D3 | 音频格式 | **定案：Opus 压缩**（Kim 修订） | WASM ogg-opus 实时编码 ≈16MB/时，MiniMax 原生支持；初始化失败降级 WAV |
| D4 | 上传失败降级 | **定案：先保 transcript + 提示** | 语音笔记的价值主体是文字；音频是增强，失败不能拖垮保存 |
| D5 | 时间线卡片 | **定案：徽章+时长 chip，不内嵌播放** | 卡片保持克制；播放体验在详情页音频条已完整 |
| D6 | 保存成功去向 | **定案：保留跳 memo 详情 + toast** | 录完即看到成品是正向反馈；后台列表用 toast 提供路径 |

## 7. 风险清单

| # | 风险 | 处置 |
|---|---|---|
| R1 | 并行会话共用检出（既有教训） | 开工前收口工作区；动 capture-page 前核对 git status |
| R2 | Workers 转发 50MB multipart 的内存与限制 | 上行改裸 octet-stream，worker 缓冲单片 ≤16MB 后重组 multipart；串行处理不分并发 |
| R3 | kosx 存的 key 是否 Subscription Key 未经实测（secret 只写不可读） | P2 完成后实转一段核对套餐进度条 vs 余额（asr-minimax.md checklist 第 5 步） |
| R4 | 流式/批式双模式状态复杂度 | 单活跃 provider 互斥；capture 现有 12 个 e2e 用例的 mock 适配作为 P2 子任务（仅 Kim 要求时执行） |
| R5 | 音频留存的隐私预期 | 录制前文案明示 + 会话级开关默认开；企业实例由 owner 引导成员预期 |
| R6 | TranslationKey 强制对齐使文案改动连锁 8 文件 | 属特性不是缺陷（tsc 拦截漏翻）；每期集中一次过 |
| R7 | Opus WASM 编码器的包体/浏览器兼容 | 选成熟库（opus-recorder 类）按需加载；初始化失败一律降级 WAV，两条路径都要测 |

## 附录 A · 审计实锤（2026-09-17 检出位置，动手前复核）

A1 无声音可视化（audio-capture 全链无 AnalyserNode）；A2 上限零呈现（controller.ts:208-214,307-313；capture-page.tsx:391-395）；A3 主按钮 h-9=36px（button.tsx:52; capture-page.tsx:556-578）；A4 录音→review 三元硬切（capture-page.tsx:455）；A5 定句无入场动画/partial 整句灰字/aria-live off（capture-page.tsx:533-554）；A6 无暂停无快捷键（types.ts:1-9；页面无 keydown）；A7 review 无字数无 undo、保存无 spinner 无 toast（capture-page.tsx:457-528）；A8 时间线零辨识（memo-card.tsx 全文不读 source:"voice"）；A9 capture memo 走 PlainReadingView 无音频条（memo-reading-view.tsx:197-218）；A10 未配置时入口消失无引导（flaremo-explorer.tsx:360-369; capture-page.tsx:593-597）；A11 voice-panel 反馈无色无 spinner（voice-panel.tsx:262-289）；A12 PWA shortcuts 无 capture 且名称硬编码中文（site.webmanifest:37-74）；A13 capture.* 约 8 条 en-US-only 键；A14 动效原语全仓最低档（页面仅 1 处 animate-ping；index.css:83-93 原语闲置）。
