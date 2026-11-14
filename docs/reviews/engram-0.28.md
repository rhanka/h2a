# Engram 0.28.0 dependency upgrade

## Inventory and scope

| Surface | Finding / change |
| --- | --- |
| Package pins | `packages/h2a/package.json` pins `@sentropic/engram` 0.28.0; the root lockfile resolves that same release. No other manifest pins Engram. |
| CLI / skill | The npm dependency supplies `engram` and the compatibility `graphify` CLI. `cli.ts` resolves `skills/engram-memory` and its resources directly from that dependency and records its package version on installation. No Engram binary or skill is vendored in `packages/h2a/skills` or `vendor`. |
| Installation test | The published-package test now requires 0.28.0; its source-byte and installation-receipt checks remain. The published memory skill bytes are unchanged. Synthetic 0.22.x producers exercise older receipts, conflicts and upgrades; they are not executable Engram installations. |
| Historical modules | `engram-live` contracts, registration, PR sync and retention entries are a separate frozen API mirrored by `copy-vendored-engram-live.mjs`. The memory port's historical contracts are also independent of graph persistence. Neither includes a graph writer or Engram CLI. |
| Git / persisted graphs | No tracked `.engram/`, `.graphify/` or `graph.json`; no Engram merge driver in attributes, scripts or local Git configuration. No graph migration or first v2 file write occurs, so no graph backup is needed in this checkout. |
| Other graph code | The h2a-owned agent-stats module has historical graph utilities and its own legacy project-graph projection; it does not import the Engram runtime. Track emits extraction fragments. The pre-incident MCP fixture names an unrelated historical graphify package and is preserved by its configuration test. |

## Graph compatibility findings

- No h2a consumer reads an Engram `degree` result. The independent agent-stats
  scene builder computes a local incidence count named `degree` for glyph sizing;
  it does not read the changed upstream metric. Its existing rendering contract
  and legacy project-graph format are unchanged by this dependency bump.
- Agent-stats and Track deduplicate edges by **source, target and relation**.
  The temporal filter retains links individually. No pair-only edge identity was
  found in these integration paths.
- No test byte-compares rebuilt Engram graph files. Skill receipts and vendored
  JavaScript mirrors do compare bytes, which is unrelated to graph provenance.
  `graph.provenance.observed_at` must be excluded from any future rebuild-byte
  comparison. `degree` means distinct neighbours; `edgeCount` means incident links.

## One-way door and rollout

Engram 0.28.0 writes `graph_format: "engram-graph/2"` with `multigraph: true`.
A pre-0.28 writer can collapse parallel links when rewriting a v2 file.
**Upgrade the runtime, every Git merge driver and installed skill copies together
on every branch exchanging graph files. Back up those files before the first v2
write.** Legacy graphs still load. Refresh managed skills with `h2a install-skills`
for each host/scope in use after upgrading; resolve any customized-skill conflict
before enabling v2 writes. This PR changes the distributed dependency and verifies
installation in disposable fixtures; it does not alter external host installations.

## Verification

- The registry's dependency, optional-dependency, peer, engine and binary metadata
  exactly match 0.23.1. Only the release version, tarball and public integrity in
  the lock entry change. `npm ci --ignore-scripts --no-audit --no-fund` passes.
  A fresh `npm install` resolution encounters the existing optional peer ranges
  (cluster-mesh expects Engram <0.23; Engram expects mcp-platform 0.4.0). Preserve
  the validated lock layout; no peer override or unrelated upgrade is included.
- `npm run typecheck` and `npm run build` pass.
- Published-skill test RED: `0.28.0 !== 0.23.1`; only the expected version changes.
- Targeted Node tests: 76 pass, 0 fail, 0 skip, 1 existing explicit TODO for
  producer wire descriptors. Command: `node --import
  ./packages/h2a/test/helpers/native-isolation.js --test --test-concurrency=1
  --test-reporter=spec` with the six files under `packages/h2a/test/`:
  `install-skills-hosts.test.js`, `native-host-shared-skills.test.js`,
  `native-host-package.test.js`, `package-plugin-manifest.test.js`,
  `registry-memory.test.js`, `registry-memory-round3.test.js`.
- `npm exec -- vitest run tests/agent-stats-project-graph.test.ts` in
  `packages/agent-stats`: 33 pass. `npm exec -- vitest run
  src/graph-export.test.ts` in `packages/track`: 2 pass. No skips.
- `node node_modules/@sentropic/engram/dist/cli.js --version`: `0.28.0`.
- In-memory smoke: v2 marker, three directed assertions including parallel
  relations and a reverse link, serialization round-trip, neighbour degree 1,
  incident-link count 3 and legacy loading all pass. No graph file is written.

## Review availability

`status: selection-failed`. No installed h2a MCP launch tool is available in this
session, so the required independent host-complementary review cannot be launched.
No peer consensus is claimed. The diff receives local scope and compatibility review.
