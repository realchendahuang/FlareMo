# Deploy Button 实测记录

这份记录只保存当前公开入口的实测结论。每次修改 `wrangler.jsonc`、部署脚本、D1/R2 binding 或 README 部署入口后，都应该更新这份文档。

## 测试入口

[Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/realchendahuang/FlareMo)

## 当前结论

- 状态：完整通过
- 复测日期：2026-07-23
- 测试入口：Chrome 登录态打开公开 Deploy Button URL
- 结果：Cloudflare 完成 GitHub 仓库创建、Workers Build、D1/R2 自动 provision、3 个远端 migration、首次部署和后续 `main` push 自动部署。

本次在已有账号中使用全新的隔离 Worker、D1、R2 和 GitHub 仓库，避免接触生产资源。这个路径覆盖了新账号的资源创建行为，同时额外验证了已有账号中默认资源名与生产资源重名时，必须显式选择 `+ 新建`。

## 实测结果

创建页从仓库配置中解析出：

- 项目名称：`flaremo`
- D1 binding：`DB`
- D1 默认资源：`flaremo`
- R2 binding：`ATTACHMENTS`
- R2 默认资源：`flaremo-attachments`
- 环境变量：`FLAREMO_DEPLOY_REPOSITORY`、`FLAREMO_SINGLE_USER_EMAIL`、`FLAREMO_SINGLE_USER_NAME`
- 构建命令：`pnpm run build`
- 部署命令：`pnpm run deploy`

部署前表单使用：

- 项目名称：`flaremo-deploy-test-20260723-1630`
- Git 账号：`realchendahuang`
- D1：`+ 新建`，`flaremo-deploy-test-db-20260723-1630`
- R2：`+ 新建`，`flaremo-deploy-test-assets-20260723-1630`
- 更新仓库：`realchendahuang/flaremo-deploy-test-20260723-1630`

```text
project_name = flaremo-deploy-test-20260723-1630
selected_d1_DBD1Database = __create_new__
DBD1DatabaseName = flaremo-deploy-test-db-20260723-1630
selected_r2_ATTACHMENTSR2Bucket = __create_new__
ATTACHMENTSR2BucketName = flaremo-deploy-test-assets-20260723-1630
FLAREMO_DEPLOY_REPOSITORY = realchendahuang/flaremo-deploy-test-20260723-1630
FLAREMO_SINGLE_USER_EMAIL = owner@flaremo.local
FLAREMO_SINGLE_USER_NAME = FlareMo Owner
build_command = pnpm run build
deploy_command = pnpm run deploy
```

首次 Workers Build `89e37931-7179-485f-96d0-52b7b7ffd03d` 成功，日志确认：

- 创建公开 GitHub 仓库并连接 `main`。
- 创建独立 D1，id 为 `d7dd9a62-c676-4aeb-9f59-2e74e0a16213`。
- 创建独立 R2 bucket。
- 自动执行 `0000`、`0001`、`0002` 三个 migration，`d1_migrations` 远端查询结果完整。
- Worker 绑定指向上述独立 D1/R2，`FLAREMO_DEPLOY_REPOSITORY` 正确写入。
- Worker 部署成功，首页返回 `200` 并包含 `<title>FlareMo</title>`。
- `/api/app/health` 返回 `200`、`ok: true`、版本 `0.3.0` 和正确更新仓库。

验收时测试地址（临时资源已清理）：

[flaremo-deploy-test-20260723-1630.chendanhuang31016.workers.dev](https://flaremo-deploy-test-20260723-1630.chendanhuang31016.workers.dev)

向生成仓库的 `main` 推送空提交 `709b242` 后，Cloudflare 自动触发第二次 Workers Build `cb5c2481-ba2d-45df-9b50-0cc1d7c9037f`。GitHub Check `Workers Builds: flaremo-deploy-test-20260723-1630` 以 `success` 完成，证明后续 push 会自动部署。

验收完成后已显式删除测试 Worker、D1、R2 和 GitHub 仓库；这些临时资源不可恢复。重新授权后的 Cloudflare GitHub App 保留，供正式 Workers Builds 使用。

## GitHub 授权过期的恢复顺序

如果 Cloudflare 返回 `Your GitHub authorization has expired`，只完成 GitHub sudo/passkey 不会刷新连接。按 Cloudflare 官方顺序处理：

1. 在 GitHub 卸载旧的 `Cloudflare Workers and Pages` App。
2. 回到 Deploy Button 表单，点击 `新建 GitHub 连接`。
3. 在带 Cloudflare `state` 参数的 GitHub 页面选择 `Install & Authorize`。
4. GitHub 回调 Cloudflare 后，在表单选择新出现的 Git 账号。

不要先从 GitHub App 页面直接安装再回 Cloudflare；无 `state` 的安装能创建 GitHub App installation，但不会建立当前 Cloudflare 表单所需的 Git 账号连接。

## 自动与手工边界

Deploy Button 自动处理：

- 从 FlareMo 源仓库进入 Cloudflare Workers `deploy-to-workers` 创建流程。
- 读取 `wrangler.jsonc`、`package.json` 和环境变量声明。
- 在表单里映射 Worker 项目名、D1 binding、R2 binding、构建命令和部署命令。
- 允许把 D1 和 R2 binding 切换为 `+ 新建`，由 Cloudflare 创建资源。
- GitHub App 授权有效时，创建 GitHub 仓库连接并用 Workers Builds 执行构建部署。
- `pnpm deploy` 在发布 Worker 前自动应用 D1 migrations。
- 后续 push 到生产分支时自动构建和部署。

仍需手工处理：

- 首次使用或授权过期时，完成 GitHub/GitLab provider 授权；GitHub 可能要求 sudo/passkey、GitHub Mobile、authenticator app 或邮箱验证码。
- 已有账号若存在同名 D1/R2，显式选择 `+ 新建` 或明确选择要复用的资源。
- 配置 Cloudflare Access application、Allow policy、Service Token policy 和公开分享 bypass。
- 绑定自定义域名、DNS 和证书。

## 验收标准

- Cloudflare 能打开 Deploy Button 页面并识别 FlareMo 仓库：通过。
- Cloudflare 能读取 Workers 项目配置：通过。
- D1 database 和 R2 bucket 能由部署流程新建并绑定：通过。
- 部署命令可以自动执行远端 D1 migrations：通过。
- 首次 Worker 部署和后续 push 自动部署：通过。
- 生产访问由 Cloudflare Access 接管，FlareMo 不要求应用内 Bearer token：部署后由使用者配置 Access。

## 部署后仍需人工确认

- Cloudflare Access application 和 policy 是否按自己的域名配置。
- 公开分享路径是否配置 bypass policy。
- 自定义域名、DNS 和证书是否完成。
- 首次导入真实数据前是否做过备份恢复演练。
