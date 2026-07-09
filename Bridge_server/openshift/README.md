# OpenShift deployment

Manifests for running the TN3270/TN5250 bridge and its mock LPAR fixtures on
OpenShift. Companion to the concurrent-session discussion that produced
these three code changes on this branch:

- `routes/health.js` — real `/health` endpoint (`handlers/http.js` wires it
  in first in the route list). OpenShift ignores the Dockerfile's
  `HEALTHCHECK` directive; it needs `livenessProbe`/`readinessProbe` in the
  pod spec, which is what `bridge-deployment.yaml` points at this endpoint.
- `handlers/ws.js` — `BRIDGE_MAX_SESSIONS` is now actually enforced. It was
  previously read into `config.bridge.maxSessions` and never checked.
- `openshift/bridge-route.yaml` — cookie-based session affinity, needed
  because `/api/recording/*` (`routes/recording.js`) is a plain HTTP
  endpoint keyed by `wsId`, a value that only means anything in the memory
  of the one pod holding that WebSocket. Without affinity, a follow-up
  request from the same browser can land on a different pod and 404 (or, in
  a worse case, collide with an unrelated session that reused the same
  numeric id on that pod).

## Before applying

1. **Build and push the images.** These manifests reference
   `tn3270-bridge:latest`, `mock-lpar:latest`, `mock-zvm:latest`,
   `mock-tpf:latest`, `mock-as400:latest` — placeholders. Build from the
   repo root (`Dockerfile`, `mock-lpar/Dockerfile*`) and push to your
   cluster's image registry, then edit the `image:` field in each
   Deployment (or run `kustomize edit set image ...`) to match.
2. **Set the real secret.** `bridge-secret.yaml` ships with
   `SECURITY_TOOLS_PASSWORD: CHANGEME`. Don't commit the real value — either
   edit it locally before applying (and don't commit that edit), or skip the
   file and create the secret out of band:
   ```
   oc create secret generic tn3270-bridge-secret \
     --from-literal=SECURITY_TOOLS_PASSWORD='<real-password>'
   ```
3. **Confirm your cluster has RWX-capable storage** for `bridge-pvc.yaml`
   (NFS, Azure Files, ODF/Ceph-FS, EFS via CSI, etc.), or drop to
   `ReadWriteOnce` and keep the bridge Deployment at `replicas: 1` — see the
   comments in that file for why.

## Apply

```
oc project <your-project>
oc apply -k openshift/
```

## Scaling the bridge past 1 replica

Two things have to both be true first:

1. The PVC is RWX (see above) — otherwise pods disagree on
   `lpars.txt`/`ssh-hosts.txt`/saved macros.
2. The Route's session-affinity annotations stay intact — they're what
   keeps a given browser's WebSocket and its follow-up HTTP calls on the
   same pod.

Sessions themselves don't need a shared store to scale: each one is a live
TCP socket the bridge holds open to a mainframe/AS400/mock host, so it isn't
portable between pods anyway. Scaling out just means more pods, each independently holding
its own set of sessions up to `BRIDGE_MAX_SESSIONS` — session affinity
routes each browser consistently to the pod that has its session, rather
than trying to share that live socket across pods.

## Mock LPARs

`mock-lpar.yaml`, `mock-zvm.yaml`, `mock-tpf.yaml`, `mock-as400.yaml` are
internal-only (no Route) — the bridge reaches them over ClusterIP Service
DNS. Service names match the hostnames already used in `lpars.shipped.txt`
(`mock-lpar`, `mock-zvm`, `mock-tpf`, `mock-as400`), so no config changes
were needed there. Each mock scopes all per-connection state inside its
`net.createServer` connection handler already (see e.g.
`mock-lpar/mock-as400.js`), so they handle concurrent inbound connections
correctly with zero code changes — kept at `replicas: 1` since they're test
fixtures with nothing to gain from scaling out.
