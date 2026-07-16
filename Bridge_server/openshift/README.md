# Deploying to OpenShift (tenant-mgmt-web3270-test)

This deploys the bridge on its own, with no mock-lpar/mock-zvm/mock-tpf/
mock-as400 containers — point `lpars.txt` / `ssh-hosts.txt` at real hosts
reachable from the cluster's network instead.

All manifests assume the `tenant-mgmt-web3270-test` namespace. Adjust if
you're deploying elsewhere.

## 1. One-time setup: image build pipeline

```sh
oc project tenant-mgmt-web3270-test
oc apply -f openshift/imagestream.yaml
oc apply -f openshift/buildconfig.yaml
```

## 2. Build the image (run from the repo root)

This is a **binary** build — it tars up your local working tree (respecting
`.dockerignore`) and sends it straight to the BuildConfig, so it works
whether or not this cluster can reach GitHub.

```sh
oc start-build web3270-bridge --from-dir=. --follow
```

Re-run this same command any time you change the app and want to redeploy.
It creates a new `web3270-bridge:latest` image; the running Deployment picks
it up on the next rollout (see step 4).

## 3. Storage

```sh
oc apply -f openshift/pvc.yaml
```

This backs the three things the app actually writes to at runtime:
`/app/lpars.txt`, `/app/ssh-hosts.txt`, and `/app/macros/local/` (saved
macros). Everything else in the image is read-only. An initContainer in
the Deployment seeds the PVC with empty files/dirs on first run so the app
doesn't need to create them itself.

## 4. Deploy

```sh
oc apply -f openshift/deployment.yaml
oc apply -f openshift/service.yaml
oc apply -f openshift/route.yaml
```

To redeploy after a new build:

```sh
oc rollout restart deployment/web3270-bridge
```

## 5. Get the URL

```sh
oc get route web3270-bridge -o jsonpath='{.spec.host}{"\n"}'
```

Open that URL — TLS terminates at the router (edge termination), the app
itself only speaks plain HTTP/WS.

## 6. Add your real hosts

`lpars.txt` and `ssh-hosts.txt` start empty (the built-in demo entries that
point at mock container hostnames are skipped via
`BRIDGE_SKIP_SHIPPED_PROFILES=true` in the Deployment — those hostnames
don't exist in this namespace). Add real connections through the app's UI:
the Connect dialog's "Add profile" flow writes to `lpars.txt`, and the SSH
connect dialog's "Save host" flow writes to `ssh-hosts.txt`. Both persist to
the PVC.

## Notes / things worth knowing

- **Single replica by design.** Session state (the live mainframe/SSH
  connection and its screen buffer) lives in one process's memory. A second
  replica wouldn't share it — don't scale this past 1 without changing how
  sessions are held.
- **`securityContext` doesn't set `runAsUser`/`fsGroup`.** OpenShift's
  default `restricted` SCC assigns both automatically from the namespace's
  allowed ranges. The image is built to tolerate that (the three writable
  paths are group-writable under gid 0), so this works without requesting
  any elevated SCC.
- **`strategy.type: Recreate`** on the Deployment, not the k8s default
  rolling update — matters because the PVC is `ReadWriteOnce`; a rolling
  update would try to attach it to two pods at once and hang.
- **If your cluster can't pull `node:20-alpine` from Docker Hub** (locked-down
  egress), the binary build will fail on the `FROM` line. You'll need an
  internal mirror or an `ImageContentSourcePolicy` — that's a platform-level
  concern outside this repo.
- **TLS to the target hosts:** `BRIDGE_VERIFY_TLS` is left unset (defaults to
  verifying certs). Only set it to `"false"` in the Deployment if a specific
  target host uses a self-signed cert you can't otherwise trust.
- The starter `example` httpd Pod you tested with can be removed once this
  is confirmed working: `oc delete pod example -n tenant-mgmt-web3270-test`.
