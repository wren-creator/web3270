# Contributing

This repo (`web3270`) is the open-source WebTerm/3270 client and TN3270(E)/TN5250
bridge. It has no accounts, billing, or admin layer, that's a separate paid-tier
product built on top of this code, living in a private repo
(`webterm-3270-saas`) that isn't part of this project.

## Syncing fixes between this repo and the private SaaS repo

The private repo started as a full copy of this one, then grew the paid-tier
layer on top. Because of that, a fix to shared code (the client in `public/`,
the TN3270/TN5250 engines, `handlers/`, `routes/`, `features/`, `macros/`)
found in either repo is usually worth porting to the other. Only the
maintainer has access to both repos, so this is an internal note more than
external contributor guidance, but it's here so the process doesn't have to
be re-derived each time:

1. Before porting a commit either direction, check what it touches:
   ```sh
   git show --stat <commit>
   ```
2. **Private → public**: if the commit doesn't touch anything paid-tier-only
   (billing, accounts/DB, admin, auth, session handling), it can cross as-is —
   `git format-patch -1 <commit>` from the private repo, `git am` onto this
   one. If it's mixed (touches both shared and paid-tier files), pull just the
   shared-file hunks into a fresh commit instead of porting the original.
3. **Public → private**: cherry-pick or `format-patch`/`git am` directly, this
   direction is always safe since this repo has nothing the private one
   doesn't already have a superset of.
4. A handful of shared files (`handlers/ws.js`, `routes/profiles.js`,
   `routes/ssh-hosts.js`, `routes/traffic.js`, `routes/logs.js`,
   `routes/recording.js`, `routes/macros.js`) diverge between the two repos on
   purpose: the private repo keeps a multi-tenant/hosted code path in each,
   gated behind `config.bridge.multiTenant`, that this repo doesn't have. A
   cherry-pick touching those files will likely conflict, that's expected;
   resolve by re-applying just the non-multi-tenant-branch part of the diff.

Everything else (bug fixes, new terminal features, mock LPAR/mainframe work,
tutorials) is normal open-source contribution, standard PR process applies.
