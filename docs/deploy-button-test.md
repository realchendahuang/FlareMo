# Deploy Button 实测记录

这份记录只保存当前公开入口的实测结论。每次修改 `wrangler.jsonc`、部署脚本、D1/R2 binding 或 README 部署入口后，都应该更新这份文档。

## 测试入口

[Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/realchendahuang/FlareMo)

## 当前结论

- 状态：创建页、资源新建表单和 Git 账号选择已实测；完整部署被 GitHub App 重新授权的 sudo/passkey 验证挡住
- 复测日期：2026-06-30
- 测试入口：Chrome 登录态打开公开 Deploy Button URL
- 结果：Cloudflare 正确进入 Workers `deploy-to-workers` 创建流程，并在 Dashboard URL 中携带 FlareMo 仓库地址。

2026-07-23 增加的 `FLAREMO_DEPLOY_REPOSITORY` 表单项和部署前自动 migration 尚未完成新的 Deploy Button 端到端复测；本次只通过项目配置检查、测试和 `pnpm deploy:dry-run` 验证。完整复测仍受下述 GitHub App 重新授权步骤阻塞。

已确认的跳转目标：

```text
https://dash.cloudflare.com/?to=/%3Aaccount/workers-and-pages/create/deploy-to-workers&repository=https%3A%2F%2Fgithub.com%2Frealchendahuang%2FFlareMo
```

Chrome 登录态下的实际创建页目标：

```text
https://dash.cloudflare.com/<account>/workers-and-pages/create/deploy-to-workers?repository=https%3A%2F%2Fgithub.com%2Frealchendahuang%2FFlareMo
```

创建页已经确认能从仓库配置中解析：

- 项目名称：`flaremo`
- D1 binding：`DB`
- D1 默认资源：`flaremo`
- R2 binding：`ATTACHMENTS`
- R2 默认资源：`flaremo-attachments`
- 环境变量：`FLAREMO_SINGLE_USER_EMAIL`、`FLAREMO_SINGLE_USER_NAME`
- 构建命令：`pnpm run build`
- 部署命令：`pnpm run deploy`

为避免误连现有生产资源，本次测试把表单切换为独立测试资源：

- 项目名称：`flaremo-deploy-button-test-20260630`
- Git 账号：选择已有连接 `realchendahuang`
- D1：选择 `+ 新建`，数据库名 `flaremo-deploy-button-test-db-20260630`
- R2：选择 `+ 新建`，bucket 名 `flaremo-deploy-button-test-attachments-20260630`

点击部署前确认到的表单状态：

```text
project_name = flaremo-deploy-button-test-20260630
selected_d1_DBD1Database = __create_new__
DBD1DatabaseName = flaremo-deploy-button-test-db-20260630
selected_r2_ATTACHMENTSR2Bucket = __create_new__
ATTACHMENTSR2BucketName = flaremo-deploy-button-test-attachments-20260630
FLAREMO_SINGLE_USER_EMAIL = owner@flaremo.local
FLAREMO_SINGLE_USER_NAME = FlareMo Owner
build_command = pnpm run build
deploy_command = pnpm run deploy
```

第一次点击部署时，如果没有选择 Git 账号，Cloudflare 返回表单错误：

```text
Connect a Git account to continue.
```

选择 Git 账号后再次点击部署，Cloudflare 进入：

```text
正在设置您的存储库。这可能需要几秒钟时间...
```

随后 Cloudflare 返回：

```text
HTTP 400
Your GitHub authorization has expired. Please reauthorize your GitHub connection by reinstalling the Cloudflare GitHub App:
https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/#reinstall-the-cloudflare-github-app
```

继续选择 `新建 GitHub 连接` 后，浏览器跳到 GitHub：

```text
https://github.com/settings/installations/55919692
Confirm access
Signed in as @realchendahuang
Passkey
Use passkey
Use GitHub Mobile
Use your authenticator app
Send a code via email
```

也就是说，FlareMo 的 Deploy Button、仓库解析、Git 账号选择和 D1/R2 新资源表单映射已验证；完整 Workers Builds 部署还需要先完成 GitHub sudo/passkey 重新授权。这个动作发生在 GitHub 账号侧，必须由账号本人完成。

完整新账号路径继续跟踪在 [issue #1](https://github.com/realchendahuang/FlareMo/issues/1)。

## 自动与手工边界

Deploy Button 自动处理：

- 从 FlareMo 源仓库进入 Cloudflare Workers `deploy-to-workers` 创建流程。
- 读取 `wrangler.jsonc`、`package.json` 和环境变量声明。
- 在表单里映射 Worker 项目名、D1 binding、R2 binding、构建命令和部署命令。
- 允许把 D1 和 R2 binding 切换为 `+ 新建`，由 Cloudflare 在部署流程里创建测试资源。
- GitHub App 授权有效时，创建 Git 仓库连接并用 Workers Builds 执行构建部署。
- `pnpm deploy` 在发布 Worker 前自动应用 D1 migrations。

仍需手工处理：

- 首次使用或授权过期时，先完成 GitHub/GitLab provider 授权；GitHub 可能要求 sudo/passkey、GitHub Mobile、authenticator app 或邮箱验证码。
- 部署成功后，在生成的项目配置里确认 D1 database id、R2 bucket 名和 `FLAREMO_DEPLOY_REPOSITORY`；migrations 已包含在部署命令中。
- 配置 Cloudflare Access application、Allow policy、Service Token policy 和公开分享 bypass。
- 绑定自定义域名、DNS 和证书。

## 验收标准

- Cloudflare 能打开 Deploy Button 页面并识别 FlareMo 仓库。
- Cloudflare 能读取 Workers 项目配置。
- D1 database 和 R2 bucket 绑定能被部署流程识别。
- 部署命令可以自动执行远端 D1 migrations。
- 生产访问由 Cloudflare Access 接管，FlareMo 不要求应用内 Bearer token。

## 部署后仍需人工确认

- Cloudflare Access application 和 policy 是否按自己的域名配置。
- 公开分享路径是否配置 bypass policy。
- 自定义域名、DNS 和证书是否完成。
- 首次导入真实数据前是否做过备份恢复演练。
