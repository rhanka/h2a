# Instruction note — h2a on Kubernetes + interop with `@sentropic/remote`

> Status: **research / design proposal, not implementation**. Sourced 2026-05-23 from `../poc-k8s` and `../remote` (`@sentropic/remote`).
> Promotes to a DEC once we commit to a deployment slice.

## What exists today (verified, not aspirational)

### `../poc-k8s`

- Single Scaleway Kapsule cluster `poc` (3 vCPU / 4 GiB DEV1-M baseline + burst pool).
- One namespace per tenant under `tenants/<name>/` with a contract `BRxx-EXn` quota model.
- Existing tenant `sentropic-remote` already provisioned with `400m / 768Mi requests` (cap 4 concurrent session-agent Pods).
- Manifests for the workload itself stay in the workload's repo and are applied AFTER the tenant namespace and quotas (`make scw-deploy` pattern).

### `../remote` (`@sentropic/remote`)

- TypeScript control plane (`apps/control-plane`) + Svelte operator UI (`apps/operator-ui`).
- `packages/protocol` already defines a `SessionDescriptor` (workspace path `/workspace`, CLI profile, target, browser/UAT, resource limits).
- `packages/k8s-orchestrator` materializes a session into a Pod + PVC + Service + Secret on demand.
- `packages/session-agent` runs inside the session Pod and exposes terminal, health, events, file ops via WebSocket back to the control plane.
- `packages/terminal-transport` handles xterm.js ↔ control plane ↔ session-agent PTY relay.
- Deployment recipes in `deploy/scw/` consumed by `make scw-deploy SCW_INGRESS=1`.

## Overlap with h2a

| Concept | `remote` | `h2a` |
|---|---|---|
| Session | Runtime environment (workspace PVC, browser, UAT) | Heartbeat-bounded protocol attachment (`H2ASession`) |
| Actor identity | `SessionDescriptor.createdBy` + workspace path | `<instance>:<workspace>` registered in `<root>/.h2a/registry/` |
| Coordination state | WebSocket events to control plane (live, no replay) | Append-only journals + presence files (replay-friendly) |
| Cross-session | Not modeled (the control plane is the only consumer of session events) | First-class via `h2a_discover_sessions` + push notifications |
| Persistence | PVC `/workspace` per session | Shared filesystem under `<root>/.h2a/` |
| Auth | mTLS+OIDC roadmap (not yet) | None V1 (DEC-032), V2 deferred |

The two are not redundant — they're complementary:

- `remote` runs **one CLI inside k8s** and gives it a workspace + terminal + browser.
- `h2a` runs **multiple CLIs that talk to each other** through shared state.

If a `remote` session also opens an h2a session, the operator UI gets to see *who else is on the bus* and *what messages were exchanged*, on top of seeing one isolated terminal stream. That's the value of the interop.

## Three concrete deployment scenarios

### Scenario A — h2a `mcp-serve` as a sidecar in a `remote` session Pod

- The session Pod already contains the user's CLI (claude/codex/gemini binary) running against `/workspace`.
- Add an `h2a-mcp` sidecar container in the same Pod. The Pod shares `emptyDir` mounts so the sidecar and the host CLI share `<root>/.h2a/`.
- The host CLI's MCP config points at `localhost:<port>` (or stdio over a unix socket exposed via the shared mount).
- All sessions in the same `remote` workspace are visible to each other through the local `.h2a/` mount.

Pros: trivial to ship (one sidecar definition). No cross-Pod traffic. Reuses existing PVC.
Cons: peers across different `remote` workspaces are NOT visible. h2a stays per-workspace.

### Scenario B — Cluster-wide h2a tenant on `poc-k8s` with a shared `<root>` PVC

- New tenant `tenants/h2a/` in `../poc-k8s` with its own namespace + quota.
- A `Deployment` running `h2a mcp-serve` per CLI agent (per-Pod for isolation) plus a shared `PersistentVolumeClaim` mounted at `/h2a-root`.
- `remote` session Pods opt-in by mounting the same PVC (ReadWriteMany — Scaleway block storage doesn't support this natively, would need NFS-backed PVC or a small dedicated `h2a-store` Pod exposing the filesystem over a synced protocol).
- Each session calls `h2a_session_open` and is then visible cluster-wide.

Pros: any two cooperating sessions, regardless of workspace, can discover each other.
Cons: RWX storage is a real constraint on Scaleway; cluster-scoped tenancy raises blast-radius concerns.

### Scenario C — `h2a` over the network via `@sentropic/remote` transport (V2 territory)

- The originally-intended-but-not-built third h2a transport.
- `mcp-serve` exposes a network endpoint (HTTPS or WebSocket) that speaks the h2a wire protocol authenticated by ed25519 signatures.
- `remote` control plane hosts a single `h2a-broker` Deployment exposed via the existing traefik ingress.
- Sessions across machines and tenants connect to the broker as h2a clients; presence and notifications are routed cluster-wide.

Pros: solves cross-machine cooperation, not just cross-workspace.
Cons: largest scope; depends on V2 transport auth (DEC-032 deferred) and a real broker implementation.

## What an interop contract with `remote` would say

A draft `CONTRACT` artefact between `@sentropic/h2a` and `@sentropic/remote`:

1. **Identity bridge** — when `remote` creates a session with `SessionDescriptor.id = X`, the in-Pod `mcp-serve` MUST open an `H2ASession` with `instance = "remote:" + X` and `host = profile.cli`.
2. **Lifecycle** — the `session-agent`'s `lifecycle:changed` event (`provisioning → running → terminating → ended`) MUST be mirrored to `H2ASession.state` (`opening → live → draining → closed`).
3. **Resource limits** — `SessionDescriptor.resourceLimits` MUST be reflected as labels on the h2a `presence/<sid>.json` (informational only; h2a does not enforce CPU/RAM).
4. **Disclosure** — the operator UI of `remote` MAY consume h2a's `h2a_discover_sessions` to enrich the session list with peer presence, but MUST NOT bypass `h2a_session_open` (i.e. presence and registry are h2a-owned).
5. **Auth boundary** — until V2 transport auth lands, the shared `<root>` filesystem trust boundary is the **`remote` workspace boundary**. Cross-workspace cooperation requires Scenario C.

This belongs in `@sentropic/remote`'s `packages/protocol` as a new schema (an `h2aBridgeSchema`) and in `@sentropic/h2a`'s `DECISIONS.md` as a sibling DEC once we commit.

## Proposed CLI verbs (if we ship deployment in a future slice)

These are sketches, not implemented:

```
h2a deploy --target k8s --tenant <name> [--namespace <ns>] [--kubeconfig <path>]
  → renders the Deployment + PVC + Service manifests against the contract in
    ../poc-k8s/tenants/<name>/ ; prints by default ; --write merges in place

h2a deploy --target remote --session <id> [--mode sidecar|peer]
  → registers a session-agent extension that, on Pod start, runs `h2a mcp-serve`
    against the session's /workspace/.h2a/ directory

h2a remote connect --broker <url> --instance <id>
  → V2 only ; speaks the network h2a protocol against a hosted broker
```

The first two would land in `h2a-cli`. The third belongs to a future `@sentropic/h2a-remote` companion package (analogous to `@sentropic/remote`).

## What to instrument in `../remote` from h2a's side

Without modifying `../remote` today (out of scope of this repo), `h2a` can ship:

1. A reference Helm chart / kustomize overlay under `packages/h2a-cli/deploy/k8s/` for a per-session sidecar (Scenario A).
2. A documented `CONTRACT` JSON artefact for the identity bridge (Scenario A/B), validatable via `@sentropic/h2a`'s existing audit functions.
3. A skeleton `tenants/h2a/` directory we can propose-via-PR into `../poc-k8s` (Scenario B).

## Recommendation

**Start with Scenario A** as the next sizeable slice (DEC-057 or later). It is the smallest unit of new capability: a sidecar manifest + a docs page + a session-agent integration point that `../remote` can adopt without re-architecting. Scenarios B and C remain open.

Scenario A would deliver:
- `packages/h2a-cli/deploy/k8s/sidecar.yaml` — kustomize-friendly Pod sidecar.
- `h2a deploy --target k8s-sidecar --output <path>` verb that materializes the manifest with substituted env (root, instance, image tag).
- Updates to `docs/tutorial-cross-cli.md` adding a "cooperate from inside k8s" section.
- A `docs/contracts/remote-bridge.md` documenting the identity bridge contract.

Out of scope of this instruction note:
- Actual deployment to `poc-k8s` (requires negotiating the tenant slot with the cluster owner).
- Modifications to `../remote` (requires a separate change in that repo).
- V2 transport auth (DEC-032 still deferred).

## Open questions for the user

1. Do we own a new `tenants/h2a/` in `poc-k8s` (Scenario B), or do we live as a sidecar of `sentropic-remote` (Scenario A)?
2. RWX storage on Scaleway: are we ok with a small NFS-style Pod, or do we accept per-workspace partitioning until V2?
3. Should the interop contract with `remote` be one-way (h2a documents the expectations) or two-way (both repos commit to the same schema)?
4. Is `@sentropic/h2a-remote` a real future package, or do we fold the network transport into `@sentropic/h2a-cli` once it's needed?
