# FlareMo

**一个免费账号就能 24 小时跑在云端的个人笔记系统。Cloudflare 原生部署，自带数据库和对象存储，登录用你自己的 Cloudflare 账号，对外保留 Memos 兼容 API。**

[![GitHub stars](https://img.shields.io/github/stars/realchendahuang/FlareMo?style=social)](https://github.com/realchendahuang/FlareMo)
[![license](https://img.shields.io/github/license/realchendahuang/FlareMo)](./LICENSE)
[![Powered by Cloudflare](https://img.shields.io/badge/powered%20by-Cloudflare-F38020?logo=cloudflare&logoColor=white)](https://www.cloudflare.com/)
[![Memos compatible](https://img.shields.io/badge/Memos-compatible-0466c1)](https://github.com/usememos/memos)

[English](./README.en.md)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/realchendahuang/FlareMo)

<p>
  <img src="./docs/assets/flaremo-desktop.png" alt="FlareMo desktop timeline" width="720">
  <img src="./docs/assets/flaremo-mobile.png" alt="FlareMo mobile timeline" width="220">
</p>

截图展示的是当前已接上后端的时间线、编辑、筛选和移动端导航体验；未实现的 AI 回顾、语义搜索、微信输入等能力不会出现在界面里。

---

## 为什么做这个项目

Flomo 证明了「快速记录 + 安静时间线」这种轻量笔记体验是有价值的。但自部署这类系统通常意味着一台 VPS、一个 Postgres、一堆 Docker 容器、一份每周要维护的备份脚本，以及硬盘哪天坏了数据全没的风险。

FlareMo 想回答另一个问题：**能不能只用一个免费 Cloudflare 账号，不买服务器、不装数据库、不写备份脚本，就拥有一个 24 小时在线、数据不会丢、可以自定义域名、还能被各种工具调用的个人笔记系统？**

答案是可以。Cloudflare 免费账号就能提供：

- **Cloudflare D1：5 GB 数据库** —— 用来存笔记、标签、关系、分享、设置。
- **Cloudflare R2：10 GB 对象存储** —— 用来存附件、图片、导出包。
- **Cloudflare Workers：免费请求额度，全球边缘节点** —— 代码和前端都在离你最近的地方跑。
- **Cloudflare Access：用你自己的 Cloudflare 账号登录** —— 不需要应用内再做一套账号密码或 Bearer token。
- **Workers Static Assets** —— 前端和 API 由同一个 Worker 提供，一次部署全搞定。

整套系统跑在一个 Worker 上。你没有一个「服务器」要照看，只有一份代码和一个免费账号。

---

## 这点免费额度到底够用多少

很多人对 5 GB 数据库 / 10 GB 对象存储没概念，觉得「免费」就是「不够用」。实际上对个人笔记这种写入量极低、纯文本为主的场景，免费额度是溢出的。

**5 GB D1 数据库：**

- 一条普通笔记（含标签、时间戳、索引开销）算 2 KB，5 GB 可以存约 **250 万条笔记**。
- 即使你每天写 100 条，也能写 **68 年**。
- 实际上绝大多数人一辈子也写不到 5 GB 的纯文本笔记。

**10 GB R2 对象存储：**

- 一张手机压缩后约 1–2 MB，10 GB 约可存 **5000–10000 张图片**。
- 或者约 **80 小时**的中等码率语音备忘录。
- R2 的出口流量不收费，分享给别人看图也不会产生流量账单。

换句话说，免费额度不是一个「很快就会撞到」的天花板，而是一个「你大概率永远用不完」的容量。

---

## 为什么放在 Cloudflare 上比放 NAS 更稳

自部署还有一个常被低估的成本：**数据的物理安全**。

- **NAS / 自建服务器**：数据在你自己家里的硬盘上。硬盘会坏，电源会跳，家里可能漏水、可能被盗、可能搬家时磕碰。哪怕你做 RAID，也只是延缓单盘故障，挡不住整台机器或整个房间出事。异地备份需要你另外搭一套。
- **Cloudflare**：D1 和 R2 的数据由 Cloudflare 在企业级基础设施上持久化，自带冗余。你不用买第二块硬盘，不用写定时备份脚本，不用关心磁盘 SMART 报警。Cloudflare 不会因为你家停电而丢数据。

这不代表你不用做导出——FlareMo 支持 Memos 格式导出包，重要数据本地留一份永远是好习惯。但日常的「会不会哪天醒来笔记全没了」这种焦虑，Cloudflare 帮你挡掉了。

除此之外，Cloudflare 还附带了自部署很难同时凑齐的几样东西：

- **全球边缘网络**：你和朋友在不同国家，访问都走最近的节点。
- **免费 HTTPS 和自定义域名**：绑个域名就行，证书自动续。
- **不用打洞**：不用 frp、不用 Tailscale、不用公网 IP，分享链接直接发给别人就能开。
- **零运维**：没有系统要打补丁，没有数据库要升级，没有进程要看门狗。

---

## 现在能做什么

- 快速记录笔记，支持标签和附件。
- 时间线、归档、回收站。
- 搜索、标签筛选、活动热力图。
- R2 附件存储。
- 公开分享链接。
- Memos 数据导入导出。
- Memos 兼容的 `/api/v1` memo / attachment / share 子集。
- OpenAPI 输出。
- MCP 端点。
- 中英文界面。

前端只保留当前已经接上能力的入口。AI 回顾、语义搜索、随机漫步、微信输入这类功能还没实现，就不会挂在界面里占位置。

---

## 部署：一键或让 Agent 替你做

FlareMo 的部署被刻意做得很轻。两种方式，挑一种就行。

**方式一：一键部署按钮**

点击上方「Deploy to Cloudflare」按钮，Cloudflare 会读取 `wrangler.jsonc`，自动创建 Worker 并生成 D1 / R2 绑定。部署完成后跑一次远程迁移：

```bash
pnpm migrate:remote
```

如果你的 Cloudflare Dashboard 还没有连接 GitHub 或 GitLab，Cloudflare 会先要求连接 Git provider。这个 OAuth 授权由你在 Cloudflare 页面里确认，FlareMo 不会要求应用内 token。

**方式二：让 AI Agent 替你部署**

仓库里带了一份 [docs/agent-deploy.md](./docs/agent-deploy.md)，是写给 Codex / Claude Code / Cursor 这类 Agent 用的部署 runbook。把仓库交给一个能跑命令的 Agent，它就能按 runbook 创建 D1 / R2 资源、填写 `database_id`、跑迁移、部署。你不用记命令，Agent 自己按步骤来。

**手动部署**（想自己一步步来的话）先创建资源：

```bash
pnpm exec wrangler d1 create flaremo
pnpm exec wrangler r2 bucket create flaremo-attachments
```

把 D1 输出的 `database_id` 写入 `wrangler.jsonc`，再执行：

```bash
pnpm verify
pnpm deploy:dry-run
pnpm migrate:remote
pnpm deploy
```

完整部署说明见 [docs/deploy.md](./docs/deploy.md)。英文部署说明见 [docs/en/deploy.md](./docs/en/deploy.md)。Deploy Button 的实测记录见 [docs/deploy-button-test.md](./docs/deploy-button-test.md)。

**部署前检查清单**

- Wrangler 已登录目标 Cloudflare 账号：`pnpm exec wrangler whoami`。
- `wrangler.jsonc` 里的 D1 binding 是 `DB`，并已填入目标 D1 的 `database_id`。
- `wrangler.jsonc` 里的 R2 binding 是 `ATTACHMENTS`，目标 bucket 已创建。
- 远端 D1 migrations 会在首次部署后执行：`pnpm migrate:remote`。
- Cloudflare Access application 已规划好人类访问、Service Token 和公开分享 bypass。
- 发布前已跑：`pnpm verify` 和 `pnpm deploy:dry-run`。

---

## 登录：用 Cloudflare Access，不要应用内 token

FlareMo 不接受应用内 Bearer token 登录。生产访问边界放在 Cloudflare Access：

- **人**使用 Access 登录和 allow policy（支持 Google / GitHub / SSO / 一次性密码等）。
- **脚本、Memos-compatible 客户端、MCP** 使用 Access Service Token。
- **公开分享路径** 单独配置 Access bypass。

这意味着你没有第二套账号密码要记，也没有一个会泄漏的应用级 token 存在数据库里。谁能访问，由 Cloudflare Access 这个统一边界说了算。

脚本访问示例：

```bash
curl "$FLAREMO_URL/api/v1/memos" \
  -H "CF-Access-Client-Id: $FLAREMO_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $FLAREMO_ACCESS_CLIENT_SECRET"
```

MCP 访问示例：

```bash
curl "$FLAREMO_URL/api/v1/mcp" \
  -H "content-type: application/json" \
  -H "CF-Access-Client-Id: $FLAREMO_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $FLAREMO_ACCESS_CLIENT_SECRET" \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

建议 bypass 的公开路径：

- `/share/*`
- `/api/public/shares/*`
- `/assets/*`

分享内容仍由 FlareMo 的 share token、过期时间和 memo 状态校验。

---

## 技术栈

- Runtime: Cloudflare Workers
- Web: React, Vite, Tailwind CSS, shadcn/radix primitives
- API: Hono-style Worker routes, Zod contracts, OpenAPI
- Database: Cloudflare D1, Drizzle
- Object storage: Cloudflare R2
- Auth boundary: Cloudflare Access
- Package manager: pnpm

D1 是笔记、用户、标签、分享、关系等业务数据的事实源。R2 只放附件、导出包和对象文件。KV、Vectorize、Workers AI、Queues/Cron 只有在对应功能真的进入实现时才接入，不拿来替代 D1。

## 架构

```mermaid
flowchart LR
  Browser["FlareMo Web UI"] --> Worker["Cloudflare Worker"]
  Clients["Memos-compatible clients / scripts / MCP"] --> Worker

  Worker --> D1["D1: memos, users, relations, shares, settings"]
  Worker --> R2["R2: attachments and exports"]
  Worker --> Assets["Workers Static Assets"]
```

一个 Worker 同时服务 API 和前端静态资源。D1 保存权威数据，R2 保存附件。Memos 兼容层是 adapter，不是把原版 Memos 服务端搬到 Workers 上跑。

---

## Memos 兼容面

FlareMo 保留 Memos 风格的核心实体，目标是复用 Memos 的客户端、脚本、导入导出和周边工具，而不是把原版 Memos 的 Go server 搬过来。

保留实体：`users/{id}`、`memos/{id}`、`attachments/{id}`、memo payload / property、relations、shares、settings。

当前公开 API 子集：

- `POST /api/v1/memos`
- `GET /api/v1/memos`
- `GET /api/v1/{name=memos/*}`
- `PATCH /api/v1/{memo.name=memos/*}`
- `DELETE /api/v1/{name=memos/*}`
- `GET /api/v1/{name=memos/*}/attachments`
- `PATCH /api/v1/{name=memos/*}/attachments`
- `GET /api/v1/{name=memos/*}/relations`
- `PATCH /api/v1/{name=memos/*}/relations`
- `POST /api/v1/{parent=memos/*}/shares`
- `GET /api/v1/shares/{share_id}`
- `POST /api/v1/attachments`
- `GET /api/v1/attachments`
- `GET /api/v1/{name=attachments/*}`
- `GET /api/v1/{name=attachments/*}/blob`
- `DELETE /api/v1/{name=attachments/*}`
- `GET /api/v1/export`
- `POST /api/v1/import`
- `GET /openapi.json`
- `POST /api/v1/mcp`

内部服务不复制原版 Memos 的多数据库抽象、本地文件假设、后台 runner、SSE、社交功能和实例管理后台。Memos 兼容范围见 [docs/memos-compatibility.md](./docs/memos-compatibility.md)，第三方客户端和工具的实测矩阵见 [docs/memos-ecosystem.md](./docs/memos-ecosystem.md)。

---

## 本地运行

```bash
pnpm install
pnpm migrate:local
pnpm dev
```

本地默认地址：`http://localhost:8787`

`pnpm dev` 会先构建前端，再用 Wrangler 启动 Worker，本地 D1/R2 使用 Wrangler 的本地模拟。

---

## 项目状态

FlareMo 当前已经具备：

- 可部署的 Cloudflare Worker + Workers Static Assets 一体应用。
- D1 + Drizzle schema 和 migrations。
- R2 附件。
- Memos 兼容 API 子集、导入导出、OpenAPI 和 MCP。
- Flomo 风格的快速记录和时间线 UI。
- Cloudflare Access 生产访问边界。
- Deploy to Cloudflare 按钮。
- Agent 部署 runbook、发版规则、兼容矩阵和开源协作文件。

后续方向见 [ROADMAP.md](./ROADMAP.md)。语义搜索的实现边界见 [docs/semantic-search.md](./docs/semantic-search.md)。

## 工程化

项目不使用 GitHub Actions 作为 CI。发布前由维护者在本地执行：

```bash
pnpm verify
pnpm deploy:dry-run
```

常用维护命令：

```bash
pnpm format:check
pnpm screenshots
pnpm backup:drill
pnpm release vX.Y.Z
```

`pnpm verify` 会跑类型检查、Vitest、生产构建和 Playwright E2E。Memos 兼容面有独立的 Worker contract test，覆盖 DTO shape、附件导入导出和 OpenAPI 路径。截图由 `pnpm screenshots` 从本地 Worker 实例生成，README 里的图片不是设计稿。

发版规则见 [docs/release.md](./docs/release.md)。维护手册见 [docs/maintenance.md](./docs/maintenance.md)。贡献说明见 [CONTRIBUTING.md](./CONTRIBUTING.md)。支持入口见 [SUPPORT.md](./SUPPORT.md)。安全策略见 [SECURITY.md](./SECURITY.md)。社区行为准则见 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。

---

## 参考项目

- [usememos/memos](https://github.com/usememos/memos)：数据模型、资源命名和兼容 API 参考。
- [blinkospace/blinko](https://github.com/blinkospace/blinko)：搜索、附件和编辑体验参考。
- [XuYouo/MeowNocode](https://github.com/XuYouo/MeowNocode)：Cloudflare D1 轻量应用参考。

## Star

喜欢这个项目，可以点个 Star，方便跟进更新。

[![Star History Chart](https://api.star-history.com/svg?repos=realchendahuang/FlareMo&type=Date)](https://star-history.com/#realchendahuang/FlareMo&Date)

## License

MIT
