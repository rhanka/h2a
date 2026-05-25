# h2a as a Kubernetes cluster tenant

> Scenario B of [DEC-056](../DECISIONS.md#dec-056--instruction-note-k8s-deployment--remote-interop), implemented by DEC-067 (building on the lease lock of DEC-065/066).

This page describes how to run h2a as its own namespaced tenant whose store lives on a shared **ReadWriteMany** volume, so multiple Pods — potentially on different nodes — coordinate through one h2a bus. Where the [sidecar](./k8s-sidecar.md) (Scenario A) is per-Pod, the tenant is cluster-wide.

## Why

The h2a default transport (`<root>/.h2a/` local-files) needs all cooperating agents to share a filesystem. The sidecar gives you one Pod's worth of coordination via an `emptyDir`. To coordinate **across** Pods you need two things:

1. A volume that more than one Pod can mount read-write at once — a `ReadWriteMany` (RWX) PVC. This is available natively on Scaleway and most managed clusters (NFS / CephFS / cloud filestore classes).
2. A lock that is safe when the holders live in different Pods on different nodes. The default same-machine advisory lock (DEC-036) recovers stale locks by probing the holder's PID, which is meaningless across hosts. The **lease lock** (DEC-065) replaces PID-liveness with a wall-clock TTL, so a crashed holder's lease is safely reclaimed from any Pod.

Scenario B ties these together: an RWX PVC plus the lease lock turned on.

## Render the manifest

```bash
h2a deploy k8s-tenant \
  --namespace h2a \
  --replicas 2 \
  --storage 1Gi \
  --storage-class scw-bssd-rwx
```

The default output is a JSON resource envelope (DEC-034) carrying the structured `documents` array plus a `yaml` rendering. Unlike the sidecar (a fragment you merge), this is a **complete multi-document manifest** ready to apply:

```bash
h2a deploy k8s-tenant --storage-class scw-bssd-rwx | jq -r .yaml | kubectl apply -f -
```

Or write it to disk first:

```bash
h2a deploy k8s-tenant --write ./deploy/h2a-tenant.yaml
kubectl apply -f ./deploy/h2a-tenant.yaml
```

## What it renders

Four documents in apply order:

| Kind | Purpose |
|---|---|
| `Namespace` | The tenant boundary (default `h2a`), labelled `app.kubernetes.io/part-of: h2a`. |
| `ResourceQuota` | `requests.cpu` / `requests.memory` sized as `replicas × per-Pod requests`, plus one PVC. |
| `PersistentVolumeClaim` | `accessModes: [ReadWriteMany]` — the shared store. `storageClassName` is emitted **only** when you pass `--storage-class`. |
| `Deployment` | `replicas` Pods running `h2a mcp-serve` against the shared PVC, with the lease lock turned on (see below). |

## The lease lock is turned on by env

The Deployment injects:

| Variable | Value | Role |
|---|---|---|
| `H2A_LOCK_MODE` | `lease` | Routes every store critical section through the cross-host lease lock (DEC-065/066) instead of the same-machine PID lock. |
| `H2A_LEASE_MS` | `--lease-ms` (default `30000`) | Lease duration. Must exceed the longest critical section plus inter-host clock skew. |
| `H2A_ROOT` | `--root` (default `/workspace/.h2a`) | Filesystem path for the h2a bus, mounted from the RWX PVC. |
| `H2A_INSTANCE` | `h2a:$(POD_NAME)` | h2a identity; `POD_NAME` comes from a downward-API `fieldRef` so each Pod is distinct. |

`createLocalStore` resolves its lock strategy as **explicit option → `H2A_LOCK_MODE` env → `pid` default** (and `leaseMs` from `H2A_LEASE_MS`). That single fallback means the long-running `mcp-serve` *and* any one-shot `h2a` verb run inside the Pod both honour the env without extra flags. The same env vars work outside Kubernetes too — e.g. a shared NFS mount on bare metal.

## Two image strategies

Identical to the [sidecar](./k8s-sidecar.md#two-image-strategies):

| Strategy | Trigger | What runs | When to use |
|---|---|---|---|
| `npm-runtime` (default) | omit `--image` | `node:22-alpine` + `npm i -g @sentropic/h2a-cli@<cliVersion>` at Pod start | PoC, demos, dev clusters. ~10s install latency. |
| Pre-built OCI image | `--image ghcr.io/rhanka/h2a-cli:<version>` | The published image (DEC-060), `h2a` already on PATH | Production. No install latency, deterministic. |

`--cli-version` only applies to `npm-runtime` and defaults to `latest`. Pin it for reproducible Pods.

## Picking a StorageClass

The PVC requests `ReadWriteMany`, which only some StorageClasses satisfy. `storageClassName` is left **unset by default** so the manifest stays portable (the cluster-default class is used). Pass `--storage-class` with an RWX-capable class for your cluster:

- **Scaleway** — an RWX-capable class (NFS-backed). RWX is available natively; an earlier project note that claimed otherwise was wrong.
- **GKE** — `standard-rwx` (Filestore) or a CephFS class.
- **EKS** — an EFS-backed class.
- **Bare metal** — NFS / CephFS provisioner classes.

If the chosen class cannot bind RWX, the PVC stays `Pending` and the Deployment never schedules — check `kubectl describe pvc h2a-store`.

## Resource defaults

Each Pod declares `50m/64Mi requests` and `200m/256Mi limits`. The `ResourceQuota` is sized at `replicas ×` the requests so the Deployment schedules. Override per-Pod resources via the `resources` option of `renderK8sTenant()` if you call the library programmatically; the CLI verb keeps the defaults to stay predictable.

## Replicas and the lease lock in practice

The default `--replicas 2` is the smallest count that actually exercises cross-Pod locking — the property Scenario B exists to provide. With two Pods writing the same negotiation journal, the lease lock serializes the critical sections: whichever Pod wins the `O_EXCL` create on the lock file holds the lease; the other waits, and if the holder crashes its lease expires after `H2A_LEASE_MS` and is reclaimed. Scale up freely; the only tuning knob is `--lease-ms`, which must stay above your worst-case critical-section duration plus clock skew.

## Limits and out-of-scope

- **Shared-filesystem semantics.** Coordination correctness rests on the RWX volume honouring POSIX `O_EXCL` create atomicity across nodes. NFS/CephFS/cloud filestore classes do; exotic CSI drivers should be validated.
- **Clock skew.** The lease is wall-clock based. The 30s default leaves wide margin over sub-second store sections, but if your nodes' clocks drift by more than a few seconds, raise `--lease-ms`.
- **No network broker.** This is still a filesystem-coordinated tenant, not a service. Cross-cluster or WAN coordination is Scenario C (network broker), deferred to V2 — see [DEC-056](../DECISIONS.md#dec-056--instruction-note-k8s-deployment--remote-interop).

## Related

- [`docs/k8s-sidecar.md`](./k8s-sidecar.md) — Scenario A, per-Pod sidecar.
- [DEC-056](../DECISIONS.md#dec-056--instruction-note-k8s-deployment--remote-interop) — full instruction note with the three scenarios.
- [DEC-065](../DECISIONS.md) / [DEC-066](../DECISIONS.md) — the lease lock primitive and its store wiring.
- [`packages/h2a-cli/src/runtime/deploy/k8s-tenant.ts`](../packages/h2a-cli/src/runtime/deploy/k8s-tenant.ts) — the renderer source.
