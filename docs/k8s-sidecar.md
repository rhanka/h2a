# h2a as a Kubernetes sidecar

> Scenario A of [DEC-056](../DECISIONS.md#dec-056--instruction-note-k8s-deployment--remote-controle-interop), implemented by DEC-058.

This page describes how to embed `h2a mcp-serve` as a Pod sidecar so a CLI agent running inside a Kubernetes Pod (typically a [`@sentropic/remote-controle`](https://github.com/rhanka/remote-controle) session Pod) can join the h2a coordination bus.

## Why

The h2a default transport (`<root>/.h2a/` local-files) needs all cooperating agents to share a filesystem. In a Kubernetes context, that is a per-Pod `emptyDir` if the agents already share the same Pod, or a shared PVC for cross-Pod coordination (see Scenarios B/C in DEC-056).

The sidecar pattern is the smallest viable unit: one container hosting the agent's interactive CLI (Claude Code / Codex / Gemini binary, or a shell), one sidecar running `h2a mcp-serve`, both seeing the same `/workspace/.h2a/` directory.

## Render the fragment

```bash
h2a deploy k8s-sidecar \
  --instance "remote-controle:my-session" \
  --cli-version 0.1.20
```

The default output is a JSON resource envelope (DEC-034) carrying the structured pieces (`container`, `volume`, `mainContainerVolumeMount`) plus a `yaml` rendering for direct merge.

To write the YAML straight to disk:

```bash
h2a deploy k8s-sidecar --write ./deploy/h2a-sidecar.yaml
```

## Two image strategies

| Strategy | Trigger | What runs | When to use |
|---|---|---|---|
| `npm-runtime` (default) | omit `--image` | `node:22-alpine` + `npm i -g @sentropic/h2a-cli@<cliVersion>` at Pod start | PoC, demos, dev clusters. Trade-off: ~10s install latency. |
| Pre-built OCI image | `--image ghcr.io/rhanka/h2a-cli:<version>` | The published image (DEC-060), `h2a` already on PATH | Production. No install latency, deterministic image. |

`--cli-version` only applies to `npm-runtime` and defaults to `latest`. Pin it for reproducible Pods.

### Published OCI image (DEC-060)

From v0.1.23 onward, every released tag is also built and pushed to GitHub Container Registry by `.github/workflows/docker.yml`:

- `ghcr.io/rhanka/h2a-cli:<version>` — pinned to a specific release, e.g. `ghcr.io/rhanka/h2a-cli:0.1.23`.
- `ghcr.io/rhanka/h2a-cli:latest` — tracks the most recent published release.

The image is multi-arch (`linux/amd64`, `linux/arm64`), runs as a non-root `h2a` user (UID 1001), and carries the built dist/ of both `@sentropic/h2a` and `@sentropic/h2a-cli` plus their production dependency closure — about 150 MB total.

Switching the sidecar to the pre-built image:

```bash
h2a deploy k8s-sidecar --image ghcr.io/rhanka/h2a-cli:latest
# or for a pinned, reproducible deploy:
h2a deploy k8s-sidecar --image ghcr.io/rhanka/h2a-cli:0.1.23
```

The renderer keeps `npm-runtime` as the default because the image only exists from v0.1.23+; downgrading a Pod to an older release should not silently change image strategy. Explicit opt-in.

## Resource defaults

The sidecar declares `50m/64Mi requests` and `200m/256Mi limits` — these fit within the `400m/768Mi` `sentropic-remote` tenant contract (DEC-056) and leave headroom for the runtime CLI itself.

Override with the `resources` option of `renderK8sSidecar()` if you call the library programmatically; the CLI verb keeps the defaults to stay predictable.

## Identity bridge with `@sentropic/remote-controle`

The sidecar exports three env vars used by the agent on `h2a_session_open`:

| Variable | Default | Role |
|---|---|---|
| `H2A_INSTANCE` | `remote-controle:${SESSION_ID:-unknown}` | h2a identity. The `${SESSION_ID}` placeholder is resolved by remote-controle's Pod template at Pod creation. |
| `H2A_HOST` | `remote-controle` | Host hint reported to peers via the presence file. |
| `H2A_ROOT` | `/workspace/.h2a` | Filesystem path for the h2a bus. Must match the `mainContainerVolumeMount.mountPath`. |

The agent's `/h2a connect` skill picks these up automatically (see `packages/h2a-cli/skills/h2a/SKILL.md`).

## Merge the fragment

`h2a deploy k8s-sidecar` does not modify your existing manifests. The output is a fragment you append to your Pod spec. The expected merge points:

1. `spec.containers[]` — append the rendered `container`.
2. `spec.volumes[]` — append the rendered `volume`.
3. The **main runtime container** of the Pod must also mount the same volume at the same path. The fragment includes a commented-out `mainContainerVolumeMount` hint.

Example merge inside a `remote-controle` session manifest (sketch):

```yaml
spec:
  containers:
    - name: runtime
      image: ghcr.io/remote-controle/runtime:1.0.0
      # ... existing fields ...
      volumeMounts:
        - name: workspace
          mountPath: /workspace
        - name: h2a-workspace     # ← from the fragment
          mountPath: /workspace/.h2a

    - name: h2a-mcp                # ← from the fragment
      image: node:22-alpine
      command: ["sh", "-c"]
      args:
        - "set -euo pipefail && npm i -g @sentropic/h2a-cli@latest && mkdir -p /workspace/.h2a && h2a init --root /workspace/.h2a || true && exec h2a mcp-serve --root /workspace/.h2a"
      env:
        - name: H2A_INSTANCE
          value: "remote-controle:${SESSION_ID:-unknown}"
        - name: H2A_HOST
          value: "remote-controle"
        - name: H2A_ROOT
          value: "/workspace/.h2a"
      volumeMounts:
        - name: h2a-workspace
          mountPath: /workspace/.h2a

  volumes:
    - name: workspace
      persistentVolumeClaim:
        claimName: session-workspace
    - name: h2a-workspace          # ← from the fragment
      emptyDir: {}
```

## Limits and out-of-scope

- **Single Pod only.** This fragment only enables h2a coordination *within one Pod*. Two `remote-controle` sessions in different Pods will not see each other through their `emptyDir` sidecars. That requires Scenario B (cluster-wide tenant with RWX storage) or Scenario C (network broker), both deferred — see [DEC-056](../DECISIONS.md#dec-056--instruction-note-k8s-deployment--remote-controle-interop).
- **No image is published yet.** The default `npm-runtime` strategy works today; an explicit `ghcr.io/rhanka/h2a-cli` image is a future deliverable.
- **No NetworkPolicy.** The sidecar speaks stdio to the runtime container in the same Pod. There is no cross-Pod traffic and therefore nothing to allow/deny at the network layer. If you later move to a broker, that page needs to be reopened.

## Related

- [DEC-056](../DECISIONS.md#dec-056--instruction-note-k8s-deployment--remote-controle-interop) — full instruction note with the three scenarios.
- [`docs/tutorial-cross-cli.md`](./tutorial-cross-cli.md) — local-machine equivalent walkthrough.
- [`packages/h2a-cli/src/runtime/deploy/k8s-sidecar.ts`](../packages/h2a-cli/src/runtime/deploy/k8s-sidecar.ts) — the renderer source.
