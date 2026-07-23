# 更新 FlareMo

FlareMo 的更新由部署仓库和 Cloudflare Workers Builds 完成。应用不会保存 GitHub Personal Access Token 或 Cloudflare API Token。

## 首次启用

使用 Deploy to Cloudflare 按钮创建实例时，把 `FLAREMO_DEPLOY_REPOSITORY` 填成 Cloudflare 创建的 GitHub 仓库，格式为：

```text
你的 GitHub 用户名/仓库名
```

例如：

```text
octocat/flaremo
```

然后在该仓库中打开 `Settings` -> `Actions` -> `General`：

- 允许仓库运行 GitHub Actions。
- 在 `Workflow permissions` 中允许 workflow 读取和写入仓库。
- 允许 GitHub Actions 创建 pull request。

再到 Cloudflare Worker 的 `Settings` -> `Build` 确认：

- Production branch 是部署仓库的默认分支，通常为 `main`。
- Production deploy command 是 `pnpm run deploy`。
- Non-production branch deploy command 保持 Cloudflare 默认的 `wrangler versions upload`，不要改成 `pnpm run deploy`。

这个 workflow 只向当前部署仓库创建更新分支和 pull request。它不持有 Cloudflare 凭据，也不负责生产部署。

## 日常更新

仓库中的 `Prepare FlareMo update` workflow 每天检查一次最新稳定 Release。发现新版后会创建一个升级 pull request。

你也可以在 FlareMo 左下角打开“系统更新”，点击“前往更新”，然后在 GitHub 手动运行 workflow：

1. 打开 `Actions` -> `Prepare FlareMo update`。
2. 点击 `Run workflow`；版本留空表示使用最新稳定版。
3. 等待升级 pull request 创建。
4. 查看版本说明和文件变化，然后合并 pull request。
5. Cloudflare Workers Builds 会自动构建前端、执行尚未应用的 D1 migrations，并发布新的 Worker 版本。

更新 PR 可以生成 preview version，但不会执行生产 D1 migration。合并到 production branch 后，生产部署才会先执行 migration 再发布 Worker；期间旧版本继续服务。如果构建或 migration 失败，新 Worker 不会发布；到 GitHub 的 Cloudflare check 或 Cloudflare Dashboard 的 Build history 查看错误。

## 自定义代码和冲突

更新会计算“当前已安装 Release 到目标 Release”的差异，再用 Git three-way apply 把差异应用到部署仓库，因此不要求部署仓库保留上游提交历史，也能保留自定义内容。无冲突时，更新 PR 可以使用仓库允许的任意合并方式。

如果本地修改与新版本冲突，workflow 会失败并停止，不会覆盖 `main`。这时按照失败日志手工应用更新，或在本地运行：

```bash
git remote add flaremo-upstream https://github.com/realchendahuang/FlareMo.git
git fetch flaremo-upstream --tags
git diff --binary --full-index v0.3.0 v0.3.1 > flaremo-update.patch
git apply --3way --index flaremo-update.patch
```

解决冲突后推送 `main`，Cloudflare Workers Builds 会继续完成部署。

## 现有实例

从 v0.2.1 或更早版本升级到 v0.3.0 时，需要先按旧的手工流程更新一次。v0.3.0 起，Deploy Button 创建的新仓库会自带更新 workflow 和应用内版本入口。

GitHub 可能会在公开仓库连续 60 天没有活动后暂停定时 workflow；应用内版本检查不受影响。此时到仓库 Actions 页面重新启用 workflow，再手工运行一次即可。

GitLab 部署暂不支持这个 GitHub workflow；请继续按 [部署文档](./deploy.md) 的手工升级流程操作。
