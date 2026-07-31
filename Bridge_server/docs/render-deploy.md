# Deploying to Render (hosted webterm-3270.com)

This deploys the multi-tenant paid product: the bridge, a managed Postgres
for the accounts/billing schema, and the five mock LPARs as private
services. Separate from `openshift/` — that deployment has no account
system and stays on the shared security-tools password.

Read this alongside `render.yaml`; the comments there cover the "why" for
most of the choices, this covers the setup steps.

## 1. Before you start, gather

- A PayPal developer app (sandbox to start): client ID/secret, and one
  subscription plan created per tier (base/training/full) — plan ids go in
  `PAYPAL_PLAN_ID_*`.
- A PayPal webhook pointed at `https://webterm-3270.com/api/billing/webhook`
  subscribed to at least `BILLING.SUBSCRIPTION.ACTIVATED`,
  `BILLING.SUBSCRIPTION.CANCELLED`, `BILLING.SUBSCRIPTION.EXPIRED`, and
  `BILLING.SUBSCRIPTION.SUSPENDED` — its webhook id goes in
  `PAYPAL_WEBHOOK_ID`.
- Telnyx API key + sending number (signup phone OTP).
- SMTP credentials for the relay in `SMTP_HOST` (email verification +
  full-tier disclaimer reach-out notification).
- The email that should receive full-tier disclaimer notifications
  (`ADMIN_NOTIFY_EMAIL`).

## 2. Create the Blueprint

In the Render dashboard: New → Blueprint → connect this repo → pick the
branch to deploy → point the Blueprint file path at
`Bridge_server/render.yaml` (this is a monorepo; the git root and this
app's root aren't the same directory). Render provisions everything in
`render.yaml`: the `webterm3270-bridge` web service, the `webterm3270-db`
Postgres instance, and the five `mock-*` private services.

Render can deploy from any branch, not just `main` — you don't need to
merge a feature branch to `main` before it can go live on Render. Just be
aware that with auto-deploy on (Render's default), the service keeps
tracking whichever branch you picked here. If you later merge that branch
into `main`, flip the branch setting on the `webterm3270-bridge` service
over to `main` at that point, or Render will keep deploying pushes to the
feature branch instead of what actually landed on `main`.

First sync will fail to fully come up — the `sync: false` env vars (PayPal,
Telnyx, SMTP secrets, `ADMIN_NOTIFY_EMAIL`) have no value yet. That's
expected; fill them in next.

## 3. Fill in the secrets

On the `webterm3270-bridge` service's Environment tab, set every var marked
`sync: false` in `render.yaml` from what you gathered in step 1. Trigger a
manual deploy afterward to pick them up.

## 4. Run the first migration

The schema (`db/schema.sql`) needs to be applied to the new database once.
Easiest path: open the Shell tab on `webterm3270-bridge` (or run a Render
one-off Job against the same service) and run:

```sh
npm run db:migrate
```

`DATABASE_URL` is already set on that service from `render.yaml`'s
`fromDatabase` reference, so this points at the right database without
extra flags. Every statement in `schema.sql` is `CREATE TABLE/INDEX IF NOT
EXISTS`, so re-running this later (after a schema change) is safe.

While in that same Shell, create your own admin account (grants `is_admin`
for `/api/logs/*` plus pre-approved full-tier access, skipping the PayPal
checkout and manual review a paying customer would go through):

```sh
npm run admin:create -- you@example.com 'a-real-password'
```

## 5. Point the domain at it

Add `webterm-3270.com` as a custom domain on the `webterm3270-bridge`
service and follow Render's DNS instructions. Once that's live, confirm
`PUBLIC_BASE_URL` in `render.yaml` (or the dashboard override) matches —
PayPal's `return_url`/`cancel_url` and the webhook receiver both build URLs
from it.

## 6. Verify the mock LPARs are reachable

The bridge reaches `mock-lpar`, `mock-zvm`, `mock-tpf`, `mock-as400`, and
`mock-claims` by service name over Render's private networking — same
hostnames `lpars.shipped.txt` already points at, no code changes needed if
that resolves the way Render's private networking is documented to work.
After first deploy, connect to one of the shipped mock profiles (Learning
tier) from the running app and confirm it actually reaches the mock
service rather than failing to resolve; this is the one piece of this setup
that's worth confirming hands-on rather than trusting untested.

## Notes / things worth knowing

- **Single instance by design**, same reasoning as `openshift/README.md`:
  session state (`sessions`, `auth/session-owners.js`, the trafficLog/pcap
  capture buffers) lives in one process's memory. Don't scale
  `webterm3270-bridge` past one instance without changing how session state
  is held.
- **The disk only needs to cover `macros/accounts/`.** Session/SSH connection
  profiles are Postgres-backed per account
  (`db/session-profiles.js`/`db/ssh-host-profiles.js`) — `lpars.txt` and
  `ssh-hosts.txt` are never read or written in multi-tenant mode, so unlike
  the OpenShift PVC, no persistence is needed for those two files here.
- **`BRIDGE_MULTI_TENANT=true` gates everything account/tier-related** —
  `handlers/ws.js`'s sku caps, the per-account profile/macro/traffic
  isolation, admin-only server logs. Never unset this on this service; it's
  what keeps one customer's data from another's.
- **Known gap, not yet fixed:** the main terminal client (`/`) doesn't
  redirect an unauthenticated visitor to `/login` — only `/billing`
  currently checks `/api/me`. Low risk (every account/tier-gated action is
  still enforced server-side regardless of what the client shows), but
  worth fixing before treating this as fully launch-ready.
- **PayPal sandbox vs live:** flip `PAYPAL_ENV` to `live` and fill in the
  `PAYPAL_LIVE_*` vars when ready to take real payments — `billing/paypal.js`
  reads distinct env vars per environment specifically so this never mixes
  sandbox and live credentials.
- **Disk permissions are the other thing worth confirming hands-on.** The
  image runs as the unprivileged `tn3270` user (`Dockerfile`), which owns
  `/app/macros` already, but Render Disks can reset ownership on the
  directory they're mounted onto. If macro saves fail with a permission
  error after first deploy, that's the likely cause — check the Disk's
  mount permissions in the Render dashboard.
