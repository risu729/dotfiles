# Worker Maintenance

Run tasks from the repository root: `mise run worker:dev` starts the local
server, `mise run worker:preview` previews a build, and
`mise run worker:test:watch` opens the Vitest UI.

Production uses the exact Worker artifact validated by CI, with its source
revision and checksum; do not rebuild it during deployment. Main pushes deploy
after all checks pass. For a manual deployment, run **CI** on `main` with
**Deploy the validated Worker** enabled. **Upstream Health** never deploys.

Deployment uses repository variable `CLOUDFLARE_ACCOUNT_ID` and secret
`CLOUDFLARE_API_TOKEN`. The token needs `Workers Scripts: Edit` on account
`risu` and `Workers Routes: Read` on zone `risunosu.com`. Wrangler reads routes
to check for conflicting assignments before publishing the Custom Domain;
Cloudflare creates its DNS record and certificate. If switching to an ordinary
route, use `Workers Routes: Edit` instead.
