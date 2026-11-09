# Hostname Maintenance

The manually dispatched **Hostname maintenance** workflow manages only the fixed
production hostname declarations in the application config. Ordinary deployments
keep `deploy-triggers: false`. No Worker version, secret, schedule, workers.dev
setting, Queue consumer or Workflow is written by this maintenance path.

Choose `plan` on current `main` first. It reads metadata, prints explicit
proposed attachments and a SHA-256 digest, and performs no remote writes. To
apply that reviewed result, dispatch `apply` on the same main revision and copy
the digest into `expected-plan-sha256`. An intervening source or metadata change
invalidates the digest. The workflow shares the normal production deployment
lock and uses the existing production Environment credential.

The fixed account, Worker, zone and hostname/pattern allowlists must match the
literal application config; maintenance never executes that TypeScript config.
Only missing attachments can be created. Existing conflicting Worker ownership,
nondefault domain/route settings, or existing DNS at a missing Custom Domain
cause failure. There are no delete or replacement operations. Changing the
hostname, widening a route or moving ownership requires another reviewed
implementation.

The writer uses only the public Custom Domain and zone-route APIs. The public
Custom Domain endpoints advertise Workers Scripts Read/Write; the existing
Individual Workers Editor credential may be denied. A missing domain
additionally requires DNS Read or DNS Write to verify an empty DNS inventory
before attachment. Routes require Workers Routes Read/Write. HTTP 403 fails
before any automatic permission expansion. This change neither identifies the
GitHub secret by its name nor grants a new permission or rotates a token. A
later permission change must specify its exact endpoint and resource scope in
the infrastructure token policy review; broad account Workers Scripts Write is
not assumed approved.

After an authorized apply, the writer reads all intended attachments back and
checks unchanged schedules, workers.dev and unrelated domain/route metadata. A
partial API failure fails the run without retries or automatic rollback. Inspect
the live state and run plan again before recovery. Public application smoke
checks and proof of a GitHub credential's identity remain separate from API
readback.

Offline regression tests run on PRs, main pushes and before maintenance. The
test command is
`mise exec -- node --test .github/scripts/hostname-maintenance.test.mjs`. Status
on 2026-11-10 (Japan time): prepared for review; no workflow dispatch, live
attachment or permission change has been performed for this implementation.
