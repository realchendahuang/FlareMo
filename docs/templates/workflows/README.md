# GitHub Actions workflow 模板

上游仓库 **不包含** `.github/workflows/`，也不在 push 或 CI 中部署。这里的两个文件是给**自托管部署仓库**用的模板，复制过去后手动运行：

| 模板 | 复制到 | 用途 |
| --- | --- | --- |
| `deploy-cloudflare.yml` | `.github/workflows/deploy-cloudflare.yml` | `workflow_dispatch` 手动生产部署（`pnpm provision:remote` → `pnpm deploy` → `pnpm secrets:sync` → `pnpm smoke:check`） |
| `flaremo-update.yml` | `.github/workflows/flaremo-update.yml` | 每日检查上游最新稳定 Release，创建升级 PR（不持有 Cloudflare 凭据，不部署） |

复制命令（在部署仓库根目录执行）：

```bash
mkdir -p .github/workflows
cp <FlareMo 仓库>/docs/templates/workflows/deploy-cloudflare.yml .github/workflows/
cp <FlareMo 仓库>/docs/templates/workflows/flaremo-update.yml .github/workflows/
```

完整步骤见 [用 GitHub Action 部署](../github-action-deploy.md) 和 [更新指南](../update.md)。
