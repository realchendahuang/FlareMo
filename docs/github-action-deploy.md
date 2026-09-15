# 用 GitHub Action 部署 FlareMo

这份教程面向**自己的部署仓库**（FlareMo 的 fork 或副本）。Workflow 是 `.github/workflows/deploy-cloudflare.yml`，只响应手动 `Run workflow`，push 不会自动发布。上游仓库 `realchendahuang/FlareMo` 不会执行这个 job。

官方维护路径仍是本地 `pnpm deploy`，或 [Deploy to Cloudflare](./deploy.md#一键部署社区支持) 按钮配合 Workers Builds。不要把 `BETTER_AUTH_SECRET`、`FLAREMO_BOOTSTRAP_SECRET` 写进 workflow 文件、issue、PR 或聊天，也不要放进 `workflow_dispatch` 输入框：GitHub 会把启动表单明文记在运行记录里。密钥只放在仓库 **Settings → Secrets**。

## 前置

- 部署仓库已包含 `.github/workflows/deploy-cloudflare.yml`。
- Cloudflare 账号已开通 Workers，并在 Dashboard 里能看到账号级 `*.workers.dev` 子域。
- 两段至少 32 个字符的随机密钥，彼此不同，先存在密码管理器：

```bash
openssl rand -base64 48
openssl rand -base64 48
```

分别作为 `BETTER_AUTH_SECRET`（登录 session）和 `FLAREMO_BOOTSTRAP_SECRET`（首次 `/setup` 安装口令）。GitHub 保存 Secret 后不能再完整查看原文。

## 1. 创建 Cloudflare API Token

打开 [API Tokens](https://dash.cloudflare.com/profile/api-tokens) → Create Token。用 **Edit Cloudflare Workers** 模板，并补上：

- Account → D1 → Edit
- Account → Workers R2 Storage → Edit
- Account → Queues → Edit
- Account → Vectorize → Edit
- Account → Workers Scripts → Edit（模板通常已包含）

Account ID 在 Cloudflare Dashboard 首页右侧。

## 2. 打开仓库 Actions

部署仓库打开 `Settings` → `Actions` → `General`：

- 允许仓库运行 GitHub Actions。
- 若还要用 [更新流程](./update.md) 创建升级 PR：Workflow permissions 设为读写，并允许 GitHub Actions 创建 pull request。只做本教程的部署时，contents 读权限即可。

## 3. 配置 GitHub Secrets

打开 `Settings` → `Secrets and variables` → `Actions`，新增：

| 名称 | 必填 | 说明 |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | 是 | 上一步的 API Token |
| `CLOUDFLARE_ACCOUNT_ID` | 是 | Cloudflare Account ID |
| `BETTER_AUTH_SECRET` | 要登录则必填 | ≥32 字符；部署后写入 Worker secret store |
| `FLAREMO_BOOTSTRAP_SECRET` | 要完成 `/setup` 则必填 | ≥32 字符，与上一行不同 |

不要配置：

- `FLAREMO_D1_DATABASE_ID`：workflow 会按名字创建或复用 D1 `flaremo`。
- `FLAREMO_PUBLIC_URL`：留空则自动设为 `https://flaremo.<账号 workers.dev 子域>.workers.dev`。
- `WRANGLER_JSONC`：仅当本地已有一份不能从模板生成的完整 `wrangler.jsonc` 时，才把全文放进这个 Secret。

自定义域名：先在 Cloudflare 绑定到 Worker，再把仓库 **Variable** `FLAREMO_PUBLIC_URL` 设成该 origin（例如 `https://notes.example.com`，不要带 path），然后重新跑 workflow。

## 4. 运行 Deploy to Cloudflare

打开仓库 `Actions` → `Deploy to Cloudflare` → `Run workflow`：

1. 第一次建议勾选 `dry_run`：只构建和 Wrangler dry-run，不执行远端 D1 migration、不发布、不同步 secret。
2. `provision` 保持勾选：创建缺失的 D1、R2、Queue、Vectorize。已存在的资源会跳过，不会再建一套。
3. dry-run 通过后，再运行一次：**不要**勾 `dry_run`，`provision` 仍勾选。

正式运行会依次：

1. 从 `wrangler.jsonc.example` 生成本次 job 的 `wrangler.jsonc`（不提交进 Git）。
2. 创建或复用 D1 `flaremo`、R2 `flaremo-attachments`、Queue `flaremo-member-removal` 与 `flaremo-data-export`、Vectorize `flaremo-memos` 与 `flaremo-memories`（1024 维、cosine）。
3. 若未配置 `FLAREMO_PUBLIC_URL`，用账号 workers.dev 子域写成 `https://flaremo.<子域>.workers.dev`。
4. 执行 `pnpm deploy`：构建前端、应用远端 D1 migrations、发布 Worker。
5. 把 GitHub Secrets 里的 `BETTER_AUTH_SECRET` 和 `FLAREMO_BOOTSTRAP_SECRET` 同步到 Worker。日志里的密钥显示为 `***`。

若这两个 GitHub Secret 未设置，同步步骤会跳过，不阻断发布；但 `/setup` 和登录会失败，需要补上 Secret 后再跑一次（不要勾 `dry_run`），或在 Cloudflare Dashboard 的 Worker → Settings → Variables and Secrets 里手动添加。

## 5. 打开 /setup

部署日志或 Cloudflare Dashboard → Worker `flaremo` 中可以看到地址，形如：

```text
https://flaremo.<子域>.workers.dev
```

浏览器打开 `https://<该 origin>/setup`，填写：

- Setup secret：`FLAREMO_BOOTSTRAP_SECRET` 的值
- 用户名、显示名、邮箱、初始密码（8–128 个字符）

成功后转到 `/login`，公共 signup 关闭。不要把 secret 或密码贴进 issue、PR、日志或聊天。

## 6. 之后如何更新

| 场景 | 做法 |
| --- | --- |
| 自己改了代码 | 推到默认分支，再手动运行 `Deploy to Cloudflare`。资源已存在时可取消勾选 `provision`。 |
| 上游发布了新的稳定版 | 按 [更新指南](./update.md) 运行 `Prepare FlareMo update`，审查并合并升级 PR，再运行 `Deploy to Cloudflare`。使用本 workflow 时，合并 PR **不会**自动发布。 |
| 只轮换认证密钥 | 改 GitHub Secret，再运行一次正式部署（会覆盖 Worker 上的对应 secret）。 |
| 改用自定义域名 | Cloudflare 绑定域名，设置 Variable `FLAREMO_PUBLIC_URL`，再部署。 |

本 workflow 不会在 push 时发布。每次生产发布都要点 `Run workflow`。

`Prepare FlareMo update` 只创建升级 PR，不持有 Cloudflare 凭据。真正发布仍是 `Deploy to Cloudflare` 或本地 `pnpm deploy` / Workers Builds。

## 7. 首次不必配置的项

这些不能在 FlareMo 页面里填写，要用到时再写入 Cloudflare Worker secrets 或 vars：

| 项 | 何时需要 |
| --- | --- |
| `FLAREMO_RECOVERY_SECRET` | 没有邮件找回、需要破窗重置 owner 密码时；用完删除或轮换 |
| `FLAREMO_ASR_DASHSCOPE_API_KEY` | 使用默认 DashScope 语音转写时 |
| 腾讯 ASR 的 Secret ID / Key | 把 `FLAREMO_ASR_PROVIDER` 改成 `tencent` 时 |
| VAPID 公钥/私钥 | 浏览器 Web Push；这是 vars，不是 secret，改完需要重新部署 |
| Telegram / Cloudflare Access 相关 secret | 接入对应能力时 |

## 8. 常见问题

- Actions 里没有 `Deploy to Cloudflare`：确认看的是自己的部署仓库，并且该 workflow 文件已在默认分支上。
- 读取 workers.dev 子域失败：在 Cloudflare Dashboard 的 Workers 里先注册账号子域。
- `/setup` 失败：两个认证 GitHub Secret 未设或不合规，或上次只跑了 `dry_run`。
- 创建 Queue / Vectorize / D1 失败：API Token 权限不足，按第 1 步补全。
- 再次部署仍勾选 `provision`：已有同名资源会跳过，这是预期行为。

本地等价命令（已登录 Wrangler 时）是 `pnpm provision:remote`、`pnpm deploy`、`pnpm secrets:sync`。完整 CLI 路径见 [部署文档](./deploy.md)。
