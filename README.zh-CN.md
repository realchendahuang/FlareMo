# FlareMo 🔥

<p align="center">
  <b>0 服务器 · 0 维护成本 · 24 小时全球边缘在线 · 数据绝对自主掌控</b><br>
  一个人用，是 AI 原生的第二大脑；一个团队用，是共享的知识库。
</p>

<p align="center">
  <a href="./README.md">English</a> •
  <a href="./README.zh-CN.md"><b>简体中文</b></a> •
  <a href="./README.ja.md">日本語</a> •
  <a href="./README.fr.md">Français</a> •
  <a href="./README.es.md">Español</a> •
  <a href="./README.ko.md">한국어</a> •
  <a href="./README.ru.md">Русский</a> •
  <a href="./README.ar.md">العربية</a>
</p>

<p align="center">
  <a href="https://github.com/realchendahuang/FlareMo/stargazers"><img src="https://img.shields.io/github/stars/realchendahuang/FlareMo?style=flat&color=F38020" alt="GitHub stars"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/realchendahuang/FlareMo?style=flat&color=2563EB" alt="License"></a>
  <a href="https://workers.cloudflare.com/"><img src="https://img.shields.io/badge/Runtime-Cloudflare%20Workers-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare Workers"></a>
  <a href="https://www.better-auth.com/"><img src="https://img.shields.io/badge/Auth-Better%20Auth-10B981" alt="Better Auth"></a>
  <a href="https://flaremo.app"><img src="https://img.shields.io/badge/官网-flaremo.app-EA580C" alt="Website"></a>
</p>

<div align="center">

| ☀️ 桌面端 · 浅色明亮 | 🌙 桌面端 · 深色沉浸 | 📱 移动端 · 极简随行 |
| :---: | :---: | :---: |
| <img src="./docs/assets/flaremo-desktop-light.png" width="360" alt="FlareMo 桌面端浅色界面" /> | <img src="./docs/assets/flaremo-desktop-dark.png" width="360" alt="FlareMo 桌面端深色界面" /> | <img src="./docs/assets/flaremo-mobile.png" width="168" alt="FlareMo 移动端界面" /> |

| ✅ 待办、项目与回顾 | 📄 文章与发布 |
| :---: | :---: |
| <img src="./docs/assets/flaremo-tasks.png" width="560" alt="待办、项目与回顾" /> | <img src="./docs/assets/flaremo-articles.png" width="560" alt="文章与发布" /> |

<sub>真实运行界面：支持深浅主题无缝切换与全功能移动端自适应。所有展示功能均已稳定接入后端，不放未实现的占位按钮。</sub>

</div>

---

## 💡 为什么选择 FlareMo

第二大脑一直是有门槛的：一台按月续费的 VPS、Docker、PostgreSQL、定时备份脚本，还有随时可能坏掉的那块硬盘。

FlareMo 想回答的是另一个问题：**如果第二大脑根本不需要服务器，而且你的 AI Agent 可以直接在你的笔记上工作呢？**

- **AI 原生，不是事后外挂**：提供笔记 MCP 端点与 `flaremo-notes` Skill，Claude、Cursor、Codex、ChatGPT、ZCode 可以搜索、读取和写入你自己的笔记。没有独立的 AI 记忆库，也没有第二本需要你打理的笔记本。
- **真正的 Serverless**：代码与静态前端跑在离你最近的 Cloudflare Workers 边缘节点；D1 与 R2 承载记录、任务、文章与媒体，自带多地域持久化。
- **知识会生长**：一条速记长成任务，任务长成文章，最后沉淀成可搜索、可关联的知识库。
- **一人安静，多人有用**：默认私密；开启团队模式后多一个带角色与三级可见性的共享空间。
- **简约不简单**：界面安静，每个控件都各有其位。

---

## ✨ 核心特性

### 1. 极速速记与沉浸式回顾
- **毫秒级捕捉**：卡片式时间线，支持标签、Markdown/GFM，以及图片与音频附件预览。
- **记录与文章**：输入框始终是一条快速记录（标签、最多 9 张图片、加粗、列表、待办）；点「全屏书写」可以在全屏画布里继续写同一条记录。文章从「文章」页开始写。
- **笔记下的评论**：类似微博，个人空间与团队空间的任意笔记都可评论。评论挂在原笔记下方，不进入时间线、搜索、统计、标签与回顾。
- **极速搜索**：SQLite FTS5 全文索引，支持查询操作符（`has:attachment`、`is:pinned`、`before:YYYY-MM-DD`、`after:YYYY-MM-DD`、`in:timeline|archive|trash`）。
- **语义「找一找」（向量搜索）**：Workers AI embedding 搭配 Vectorize 派生向量索引，按上下文语义召回；结果会对照 D1 二次校验权限，并无缝降级到 FTS5。
- **灵感激活**：内置**每日回顾**（那年今日）、**随机漫步**（在标签与反向链接图中游走，附明信片式总结）和相关笔记推荐。
- **版本回溯**：完整的版本差异对比，一键还原历史版本。

### 2. AI 读写你的笔记（MCP + Skill）
- **笔记 MCP**：`/mcp` 提供笔记的列表、搜索、读取、创建、修改与删除，使用可撤销的 `memos_pat_` 令牌鉴权。
- **一个 Skill**：`skills/flaremo-notes` 教会每个 Agent 先搜索再写入、保留你的原文，并返回它改动的笔记 ID。
- **没有独立记忆**：Agent 按需读取你的笔记，不会在后台把内容抽取成第二个账本。

### 3. 待办与项目
- **给笔记排期**：为笔记选定日期与项目，其中每条未勾选的待办都会成为一项任务。在笔记里或待办页勾选完成，两边双向同步。
- **一个待办页**：`/projects` 以按天分组的列表呈现**今天**、**未来 7 天**与**全部任务**，你的项目则以看板呈现（跨状态列拖拽、优先级、手动排序）。每个列表都有快速添加行。
- **个人私有、可撤销删除**：任务为单人私有资源；删除先进回收站，可随时还原，到期后自动清理。

### 4. 提醒与时间维度
- **在阅读处显示角标**：已排期的笔记在卡片上显示「待办 n/m · 日期 · 项目」，每日回顾开头即列出今天的待办。
- **时间维度一目了然**：explorer 首页将迷你月历与逾期/今日提醒并排呈现，到期事项不会藏在看板后面。
- **到期与逾期提醒**：每日任务在站内发出「今天到期」与逾期通知，并可选开启浏览器 Web Push。排期精确到天，不提供按钟点的闹钟提醒。

### 5. 团队空间与三级可见性
- **分享，而非协作**：团队空间是成员之间互相发布笔记并评论的地方。在团队输入框中输入 `@username` 会自动补全并通知被提及的人；点开通知直接跳到原笔记的评论处。
- **角色治理**：`owner`、`admin`、`member` 三种角色。管理员通过一次性激活链接邀请成员（成员自主设置密码；管理员经手不到任何明文凭据）。
- **三档可见性**：
  - 🔒 **私密**：仅作者本人可见。
  - 👥 **团队可见**：对有效团队成员只读共享。
  - 🌐 **全网公开**：通过限时分享链接匿名只读访问。
- **安全移除**：移除成员会触发可靠的后台清理，清除其私有数据，同时保留团队与公开笔记。
- **读者席位**：可发放带有效期的只读席位（客座读者、课程学员、客户交付）。席位到期自动失效（凭证解析时 fail-closed，无需定时任务）；可在成员页管理，也可用个人访问令牌（PAT）调用 `PUT /api/app/admin/team/reader` 按邮箱开通（见 `docs/team-mode.md`）。

### 6. 离线优先与 PWA 体验
- **可安装 PWA**：一键安装到 macOS、Windows、iOS 或 Android 主屏幕，原生 App 级体验。
- **可靠的离线同步**：草稿即刻本地保存。离线提交与上传进入待同步队列，恢复网络后自动重放。
- **实时语音输入**：点输入框的麦克风按钮，边说边把语音实时转成文字（ASR）写进草稿。

### 7. 坚固的 Better Auth 应用安全
- **Better Auth 驱动**：浏览器使用 HttpOnly、`SameSite=Lax` Cookie 会话；脚本与 MCP 使用可撤销的 `memos_pat_` 个人访问令牌。
- **严格的 Origin 防护**：状态变更请求强制精确校验 Origin 白名单。Cloudflare Access 仍可作为可选的外层防线。

### 8. 数据永远是你的
- **一键全量导出**：记录、附件、任务、项目、文章与分享关系打包成一份文件，随时离线归档。
- **导入不留半截数据**：支持跳过与复制两种冲突策略；导入失败整批回滚，不会留下残缺数据集。
- **从别的工具搬过来**：自带转换脚本，把旧工具的导出包转成 FlareMo 导入包，时间戳、标签、置顶与可见性保留（[迁移指南](./docs/import-from-memos.md)）。
- **按协议开放**：`/api/v1` 兼容层 + 可撤销 Personal Access Token，另有 MCP 端点接入 AI 工具链；具体覆盖范围以[兼容矩阵](./docs/memos-compatibility.md)为准。

---

### 9. 插件系统：卡片即插件
- **五张内置卡片**：素白、日签、票根、明信片，以及自绘 canvas 的邮戳演示卡。
- **商店与管理**：浏览目录、一键安装（SHA-256 校验）、启用/停用、排序、设默认、隐藏——全部在账户设置里完成。官方目录见 [flaremo.app/plugins](https://flaremo.app/plugins/registry.json)。
- **可上传**：管理员可安装本地插件包——它只存在于该实例上，永不外传。
- **可创作**：`pnpm plugin:new` 生成脚手架，`pnpm plugin:check` 用与实例安装时**完全相同的规则**校验，`pnpm plugins:build` 出包。document 卡是纯 JSON 排版，sandbox 卡写你自己的 HTML/CSS/JS。详见[插件指南](./docs/plugins.md)。
- **默认安全**：卡片跑在不透明源沙箱里，**无任何网络访问**；社区与品牌插件包默认关闭，管理员显式启用才可用。

## 📊 Cloudflare 免费额度到底有多慷慨？

很多人以为「免费」等于「严重缩水」。对以文字为主的个人知识库来说，Cloudflare 的免费配额几乎取之不尽：

| 资源 | 免费配额 | 对应容量 | 实际使用寿命 |
| :--- | :--- | :--- | :--- |
| **Cloudflare D1** | **5 GB 数据库** | 约 **250 万条** 纯文本笔记 | 每天写 100 条也要 **68 年** 才能写满 |
| **Cloudflare R2** | **10 GB 存储** | 约 **5,000–10,000 张** 照片 / **80 小时** 语音 | **0 出口流量费用**；公开分享不会触发带宽账单 |
| **Cloudflare Workers** | 慷慨的免费请求额度 | 全球 300+ 边缘节点 | 全球毫秒级响应，没有冷启动 |

---

## 🥊 对比：Cloudflare 原生 vs 家用 NAS vs 传统 VPS

| 维度 | Cloudflare 原生（FlareMo） | 家用 NAS / 小主机 | 传统 VPS |
| :--- | :--- | :--- | :--- |
| **数据持久性** | **企业级多地域副本**，零硬件故障风险 | 单盘损坏或断电即可导致全量数据损失 | 依赖手动快照与备份例程 |
| **维护成本** | **零**：无系统补丁、无 Docker compose、无数据库维护 | 系统更新、Docker 维护、SMART 磁盘告警、路由器配置 | 内核升级、安全补丁、看门狗守护进程 |
| **访问延迟** | **全球边缘 CDN**，任意位置均低于 100ms | 需自建 DDNS / frp / Tailscale 隧道，受家庭上行带宽制约 | 依赖单一云地域，跨境延迟高 |
| **SSL 与域名** | **自动 HTTPS** 与自定义域名绑定 | 手动签发证书、配置反向代理 | Nginx / Caddy 配置与 Let's Encrypt 续期维护 |
| **资金成本** | 免费额度内 **0 元/月** | 硬件前期投入高 + 持续电费 | 持续支付按月/按年的服务器与带宽账单 |

---

## 🚀 5 分钟极速部署

### 方式一：一键部署到 Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/realchendahuang/FlareMo)

按钮流程会把仓库克隆到你的 GitHub 账号，并自动创建 D1、R2、Queues 与 Vectorize 资源。首次部署后，请按 [docs/deploy.md](./docs/deploy.md#一键部署社区支持) 设置 `FLAREMO_PUBLIC_URL` 与密钥。若首次尝试报 "Github API Limit Exceeded"，等待几分钟重试即可。

### 方式二：GitHub Action（自托管 fork）

在自己的 fork 上，于 Actions 里手动运行 **Deploy to Cloudflare**：创建 Cloudflare 资源、发布 Worker、同步认证密钥。push 不会自动发布。步骤见 [docs/github-action-deploy.md](./docs/github-action-deploy.md)。

### 方式三：让 AI Agent 替你部署（推荐）

把仓库交给一个能执行终端命令的 AI Agent（如 Claude Code、Cursor Agent、Codex），并附上 [docs/agent-deploy.md](./docs/agent-deploy.md)：
> "请按照 docs/agent-deploy.md 的指引，帮我把 FlareMo 部署到我的 Cloudflare 账号。"

---

### 方式四：手动 3 步部署

#### 1. 创建 Cloudflare 资源
```bash
pnpm exec wrangler whoami
pnpm exec wrangler d1 create flaremo
pnpm exec wrangler r2 bucket create flaremo-attachments
```

也可以改用 `pnpm provision:remote`：自动创建缺失的 D1 / R2 / Queue / Vectorize 资源，并把 D1 的 `database_id` 写入 `wrangler.jsonc`。它是幂等的——已存在的资源会跳过。

#### 2. 配置设置与密钥
```bash
cp wrangler.jsonc.example wrangler.jsonc
```
填入生成的 `database_id`，并将 `FLAREMO_PUBLIC_URL` 设置为你的生产域名。然后写入密钥：
```bash
pnpm exec wrangler secret put BETTER_AUTH_SECRET --config ./wrangler.jsonc
pnpm exec wrangler secret put FLAREMO_BOOTSTRAP_SECRET --config ./wrangler.jsonc
```

#### 3. 部署
```bash
pnpm deploy:dry-run
pnpm deploy
```

（完整 `pnpm verify` 门禁只在维护者明确要求时运行。）
访问你的生产域名下的 `/setup`，输入 `FLAREMO_BOOTSTRAP_SECRET` 即可初始化 Owner 账号。

详细指南：[部署指南](./docs/deploy.md) · [GitHub Action 部署](./docs/github-action-deploy.md) · [更新指南](./docs/update.md)。

---

## 🧱 架构与技术栈

```mermaid
flowchart LR
  Browser["FlareMo Web UI (React 19 / PWA)"] --> Worker["Cloudflare Worker"]
  Clients["Scripts / MCP"] --> Worker

  Worker --> Auth["Better Auth (Session / PAT)"]
  Worker --> D1["Cloudflare D1 (Notes / Relations / Settings)"]
  Access["Cloudflare Access (Optional Outer Perimeter)"] -.-> Worker
  Worker --> R2["Cloudflare R2 (Attachments & Exports)"]
  Worker --> Assets["Workers Static Assets"]
```

- **运行时**：Cloudflare Workers
- **前端**：React 19, Vite, TanStack Router, Tailwind CSS 4, Radix UI
- **数据库**：Cloudflare D1, Drizzle ORM
- **存储**：Cloudflare R2
- **认证**：Better Auth（HttpOnly Cookie 会话 + 可撤销 `memos_pat_`）
- **AI 与搜索**：Workers AI, Vectorize, SQLite FTS5
- **插件**：槽位式扩展平台（[规范](./docs/plugin-platform-standard.md)、[指南](./docs/plugins.md)）；插件包存于 R2，沙箱卡片无网络访问

---

## 🌟 Star History

如果你觉得 FlareMo 对你有帮助，欢迎点亮右上角的 Star ⭐️，你的支持是项目持续迭代的最大动力！

<p align="center">
  <a href="https://star-history.com/#realchendahuang/FlareMo&Date">
    <img src="https://api.star-history.com/svg?repos=realchendahuang/FlareMo&type=Date" alt="Star History Chart" width="700">
  </a>
</p>

---

## 📄 开源许可证

本项目基于 [GNU AGPL-3.0](./LICENSE) 协议开源。允许自托管部署、修改与学习使用；若以网络服务（SaaS）形式对外提供修改版本，须按 AGPL-3.0 条款开源修改后的源代码。
Copyright (c) 2026 realchendahuang.
