# x8 WP restructuring — current physical state

> Ratified by Fabien: 11 perennial theme-WPs, including Memory & context. This file records the current `.track` append-only state after the reparent pass that completed before the API-limit interruption.

## Theme IDs

- `MISSING` — Protocol & envelopes
- `MISSING` — Addressing & presence
- `MISSING` — Coordination & loop
- `MISSING` — Governance & RACI
- `MISSING` — Execution & runtime
- `MISSING` — Identity, auth & NHI
- `MISSING` — Infra, deploy & MCP
- `MISSING` — Tracking & record
- `MISSING` — Method & harness
- `MISSING` — Distribution, CLI & packaging
- `MISSING` — Memory & context

## Direct children by theme

## Compatibility note: streams under workpackages

The consensus model wanted milestone-WPs to become closable streams inside a theme. The current track invariant rejects `stream` under `workpackage` (`A2: a stream may only nest at root or under another stream`). Therefore mono-concern historical milestone-WPs already reparented under a theme remain physically `role:workpackage` for now; empty/multi-concern bundles that could be converted at root were converted to `role:stream`. Follow-up: either allow `stream` under perennial `workpackage`, or represent milestones with another role/metadata.

## Old milestone disposition

