# Worker Deployment

Run tasks from the repository root: `mise run worker:dev` starts the local
server, `mise run worker:preview` previews a build, and
`mise run worker:test:watch` opens the Vitest UI.
`mise run worker:build` builds the production artifact.

Production uses the exact Worker artifact validated by CI, with its source
revision and checksum; do not rebuild it during deployment. Main pushes deploy
after all checks pass. For a manual deployment, run **CI** on `main` with
**Deploy the validated Worker** enabled. **Upstream Health** never deploys.

Deployment uses repository variable `CLOUDFLARE_ACCOUNT_ID` and the
existing repository secret `CLOUDFLARE_API_TOKEN`. Production targets the
`production` Environment and Preview targets `preview`; both can use the
repository secret without reading or re-entering its value. An Environment
secret with the same name takes precedence if added later. Moving the token to
Environment secrets is a separate migration: validate both deployment paths
before removing the repository copy. All Worker jobs live in `ci.yml`; only
the Preview and production deploy jobs reference Cloudflare credentials, and
artifact validation runs without them. The token needs
`Individual Workers Editor` scoped to `dotfiles-worker` on account `risu`.
Production uploads the validated artifact with
`cf workers versions create --prebuilt --mode production`, then deploys that
exact version with `cf workers deployments create` to 100% of traffic. It
preserves the existing Custom Domain without updating triggers.

The pinned `cf` beta reads `worker/cloudflare.config.ts` and builds with Vite.
CI archives `.cloudflare/output/v0` and always uses `--prebuilt` when uploading.
PRs use named Workers Previews. CI lets `wrangler-deploy-action` run
`cf previews deploy` without `--prebuilt`, Cloudflare's documented flow, so cf
builds with Preview context and drops production domains. The deploy runs in a
job required by `CI Check`, so a broken Preview build or deployment blocks
merging. Fork PRs only run validation; runs without Preview credentials, such
as Dependabot's, skip the Preview. Superseded PR runs are cancelled with the
rest of CI. Before deploying, the job checks that the PR is open at the tested
head, so re-running an old run cannot replace the current Preview.
Because cf builds while holding the API token, build-time code from
same-repository PRs, including Renovate's dependency updates, can read it.
Cloudflare's documented Preview flow has the same premise; keep the token
scoped to this Worker.
The pinned `wrangler-deploy-action` v3 runs cf for previews, dry runs, and
production. It reads back the deployment to verify the exact version at 100%.
Keep `deploy-triggers` false for routine deployment. The action owns the beta
CLI output contract; validate CLI and action upgrades together.

Previews of closed PRs are not deleted. Cloudflare evicts the least recently
deployed Preview once a Worker reaches its Preview limit, and this Worker has
no storage bindings whose data would outlive the PR. A closed PR's Preview
only stays reachable at its unadvertised Preview URL until it is evicted.
Revisit cleanup if the Worker gains storage bindings or secrets.

Manage Custom Domain and route changes separately with suitable permissions. The
public Custom Domain API advertises Workers Scripts Write; the scoped Individual
Workers Editor token does not declare that grant. The pinned CLI uses different
legacy endpoints whose token acceptance remains unverified. Do not replace
version deployment with `cf deploy` without accounting for its trigger updates.

## Hostname Maintenance

See [hostname maintenance](../worker/HOSTNAME-MAINTENANCE.md) for the separate
manual plan/apply workflow and its current permission limits.
