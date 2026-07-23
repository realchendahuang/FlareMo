# Update FlareMo

FlareMo updates flow through the deployment repository and Cloudflare Workers Builds. The application never stores a GitHub Personal Access Token or Cloudflare API Token.

## Enable updates once

When using the Deploy to Cloudflare button, set `FLAREMO_DEPLOY_REPOSITORY` to the GitHub repository Cloudflare creates, using this format:

```text
your-github-owner/repository
```

For example:

```text
octocat/flaremo
```

In that repository, open `Settings` -> `Actions` -> `General`:

- Allow the repository to run GitHub Actions.
- Under `Workflow permissions`, allow workflows to read and write the repository.
- Allow GitHub Actions to create pull requests.

Then open the Cloudflare Worker's `Settings` -> `Build` and confirm:

- The production branch is the deployment repository's default branch, usually `main`.
- The production deploy command is `pnpm run deploy`.
- The non-production branch deploy command keeps Cloudflare's `wrangler versions upload` default; do not change it to `pnpm run deploy`.

The workflow can only create an update branch and pull request in the deployment repository. It has no Cloudflare credentials and does not deploy production itself.

## Install an update

The `Prepare FlareMo update` workflow checks the latest stable Release once per day and opens an update pull request when needed.

To check immediately, open “System update” in the lower-left corner of FlareMo, select “Go to update,” and then:

1. Open `Actions` -> `Prepare FlareMo update`.
2. Select `Run workflow`; leave the version empty to use the latest stable release.
3. Wait for the update pull request.
4. Review the release notes and changes, then merge the pull request.
5. Cloudflare Workers Builds builds the web app, applies pending D1 migrations, and deploys the new Worker version.

The update pull request can produce a preview version without running a production D1 migration. After merge, the production build applies migrations before publishing the new Worker while the old version remains available. If the build or migration fails, the new Worker is not deployed; inspect the Cloudflare check on GitHub or Build history in the Cloudflare dashboard.

## Custom code and conflicts

The workflow calculates the difference between the installed and target Releases, then uses Git three-way apply against the deployment repository. It does not depend on preserved upstream commit history, keeps customizations, and allows any merge method supported by the repository when there is no conflict.

If a customization conflicts with a release, the workflow stops without changing `main`. Follow the failure log and apply the update manually, or run:

```bash
git remote add flaremo-upstream https://github.com/realchendahuang/FlareMo.git
git fetch flaremo-upstream --tags
git diff --binary --full-index v0.3.0 v0.3.1 > flaremo-update.patch
git apply --3way --index flaremo-update.patch
```

After resolving conflicts, push `main` and Cloudflare Workers Builds will complete the deployment.

## Existing instances

Instances running v0.2.1 or earlier need one final manual update to v0.3.0. New repositories created from v0.3.0 include the update workflow and in-app version entry.

GitHub may disable scheduled workflows after 60 days without public-repository activity. The in-app version check continues to work; re-enable the workflow on the repository's Actions page and run it manually.

GitLab deployments do not yet support this GitHub workflow. Continue to use the manual process in the [deployment guide](./deploy.md).
