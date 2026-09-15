# Deploy FlareMo with GitHub Actions

This guide is for **your deployment repository** (a fork or copy of FlareMo). The workflow is `.github/workflows/deploy-cloudflare.yml`. It only runs from a manual `Run workflow` click; pushes do not publish. The upstream repository `realchendahuang/FlareMo` never runs this job.

The maintained paths remain local `pnpm deploy`, or the [Deploy to Cloudflare](./deploy.md#one-click-deploy-community-supported) button with Workers Builds. Do not put `BETTER_AUTH_SECRET` or `FLAREMO_BOOTSTRAP_SECRET` in the workflow file, issues, PRs, chat, or `workflow_dispatch` inputs: GitHub stores those form values in the run record. Keep them in repository **Settings → Secrets**.

## Prerequisites

- The deployment repository includes `.github/workflows/deploy-cloudflare.yml`.
- The Cloudflare account has Workers enabled and an account-level `*.workers.dev` subdomain.
- Two distinct random secrets of at least 32 characters, stored in a password manager first:

```bash
openssl rand -base64 48
openssl rand -base64 48
```

Use them as `BETTER_AUTH_SECRET` (session signing) and `FLAREMO_BOOTSTRAP_SECRET` (one-time `/setup` passphrase). GitHub cannot show a saved Secret again.

## 1. Create a Cloudflare API token

Open [API Tokens](https://dash.cloudflare.com/profile/api-tokens) → Create Token. Start from **Edit Cloudflare Workers** and add:

- Account → D1 → Edit
- Account → Workers R2 Storage → Edit
- Account → Queues → Edit
- Account → Vectorize → Edit
- Account → Workers Scripts → Edit (usually included)

The Account ID is on the right side of the Cloudflare dashboard home page.

## 2. Enable Actions on the repository

In the deployment repository, open `Settings` → `Actions` → `General`:

- Allow GitHub Actions.
- If you also use the [update flow](./update.md) to open upgrade PRs: grant read/write workflow permissions and allow Actions to create pull requests. Deploy-only runs only need contents read.

## 3. Configure GitHub Secrets

Open `Settings` → `Secrets and variables` → `Actions` and add:

| Name | Required | Purpose |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Yes | Token from step 1 |
| `CLOUDFLARE_ACCOUNT_ID` | Yes | Cloudflare account ID |
| `BETTER_AUTH_SECRET` | Yes if you need login | ≥32 characters; synced to the Worker secret store |
| `FLAREMO_BOOTSTRAP_SECRET` | Yes if you need `/setup` | ≥32 characters, different from the previous value |

Do not set:

- `FLAREMO_D1_DATABASE_ID`: the workflow creates or reuses D1 `flaremo` by name.
- `FLAREMO_PUBLIC_URL`: if empty, it becomes `https://flaremo.<account workers.dev subdomain>.workers.dev`.
- `WRANGLER_JSONC`: only if you already have a full `wrangler.jsonc` that cannot be generated from the example.

For a custom domain, bind it to the Worker in Cloudflare, set repository **Variable** `FLAREMO_PUBLIC_URL` to that origin (for example `https://notes.example.com`, no path), then run the workflow again.

## 4. Run Deploy to Cloudflare

Open `Actions` → `Deploy to Cloudflare` → `Run workflow`:

1. On the first attempt, enable `dry_run`: build and Wrangler dry-run only. No remote D1 migration, publish, or secret sync.
2. Leave `provision` enabled: create missing D1, R2, Queue, and Vectorize resources. Existing names are skipped.
3. After dry-run succeeds, run again **without** `dry_run`, with `provision` still enabled.

A production run will:

1. Generate a job-local `wrangler.jsonc` from `wrangler.jsonc.example` (not committed).
2. Create or reuse D1 `flaremo`, R2 `flaremo-attachments`, queues `flaremo-member-removal` and `flaremo-data-export`, and Vectorize indexes `flaremo-memos` and `flaremo-memories` (1024 dimensions, cosine).
3. If `FLAREMO_PUBLIC_URL` is unset, write `https://flaremo.<subdomain>.workers.dev`.
4. Run `pnpm deploy`: build the web app, apply remote D1 migrations, publish the Worker.
5. Copy GitHub Secrets `BETTER_AUTH_SECRET` and `FLAREMO_BOOTSTRAP_SECRET` onto the Worker. Logs show `***`.

If those two GitHub Secrets are missing, the sync step skips and deploy still finishes; `/setup` and login will fail until you add the Secrets and run again without `dry_run`, or add them in Cloudflare Dashboard → Worker → Settings → Variables and Secrets.

## 5. Open /setup

The deploy log or Cloudflare Dashboard → Worker `flaremo` shows an origin such as:

```text
https://flaremo.<subdomain>.workers.dev
```

Open `https://<that origin>/setup` and enter:

- Setup secret: the `FLAREMO_BOOTSTRAP_SECRET` value
- Username, display name, email, and an initial password (8–128 characters)

Success redirects to `/login` and public signup closes. Do not paste secrets or passwords into issues, PRs, logs, or chat.

## 6. Later updates

| Situation | What to do |
| --- | --- |
| You changed application code | Push the default branch, then run `Deploy to Cloudflare`. You can uncheck `provision` once resources exist. |
| Upstream published a stable release | Follow the [update guide](./update.md) to run `Prepare FlareMo update`, review and merge the PR, then run `Deploy to Cloudflare`. Merging the PR does **not** publish when you use this workflow. |
| Rotate auth secrets | Change the GitHub Secrets and run a production deploy (overwrites the Worker secrets). |
| Switch to a custom domain | Bind the domain in Cloudflare, set Variable `FLAREMO_PUBLIC_URL`, deploy again. |

This workflow never publishes on push. Every production deploy is a `Run workflow` click.

`Prepare FlareMo update` only opens an upgrade PR and does not hold Cloudflare credentials. Publishing is still `Deploy to Cloudflare`, local `pnpm deploy`, or Workers Builds.

## 7. Not required on first install

These cannot be set in the FlareMo UI. Add them in Cloudflare when you need the feature:

| Item | When |
| --- | --- |
| `FLAREMO_RECOVERY_SECRET` | Break-glass owner password reset without email; delete or rotate after use |
| `FLAREMO_ASR_DASHSCOPE_API_KEY` | Default DashScope voice capture |
| Tencent ASR secret ID / key | When `FLAREMO_ASR_PROVIDER` is `tencent` |
| VAPID public/private keys | Web Push; these are vars, not secrets, and need a redeploy |
| Telegram / Cloudflare Access secrets | When those integrations are enabled |

## 8. Troubleshooting

- No `Deploy to Cloudflare` workflow: you are on the wrong repository, or the file is not on the default branch.
- workers.dev subdomain lookup fails: register the account subdomain under Workers in the Cloudflare dashboard.
- `/setup` fails: the two auth GitHub Secrets are missing or invalid, or the last run was `dry_run` only.
- Queue / Vectorize / D1 create fails: the API token is missing permissions from step 1.
- `provision` still checked on later deploys: existing names are skipped; that is expected.

The local equivalents (with Wrangler logged in) are `pnpm provision:remote`, `pnpm deploy`, and `pnpm secrets:sync`. The full CLI path is in the [deployment guide](./deploy.md).
