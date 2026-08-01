---
name: track-operation
description: "Use for operational Track hygiene: read, write, import, or verify state; handle BRANCH.md or plan/NN-BRANCH_*.md imports; and decide between Track MCP and CLI. For an owner-facing contextual report, load `harness/track-report`, which bootstraps this checkout's binary — the bare `track report` here is the deterministic conductor for operational/machine use, not the owner report. MCP remains read-only, writes/imports use the CLI, and .track is append-only/single-writer."
---

# Track Operation

Use this for track hygiene: reading status, importing BRANCH files, recording an item or an
owner-ratified decision, and verifying the sidecar. Use `present-decision` for an owner decision
dossier and `propose-workpackages` for backlog restructuring.

## Deterministic report/status

An owner-facing contextual report belongs to `harness/track-report`, which bootstraps this checkout's
`track` binary and applies the validated four-section format. The command below is the operational
deterministic route, not that report. It is a deterministic
conductor over the folded log, with exactly four sections — FAIT / À-FAIRE / DÉCISIONS / RECOMMANDATION
— for text and Markdown, plus a machine handle-resolution block. It never
invokes an adapter, gateway, subprocess, or model.

- `track report --format text` is the default conductor.
- `track report --format md` is the same deterministic view in Markdown.
- `track report --flat` explicitly requests the legacy bucket dump.
- `track report --format json` is the flat machine contract; add `--wp` to carry the additive conductor
  view model. Do not pass `--flat` with JSON.
- `track snapshot` or `track report --raw` is a factual diagnostic projection, not a reporting-period
  cursor or an executable plan.

There is no HTML surface. `track report --format html` is rejected; the DS fragment is focus's own
renderer, not the report's.

Scope the report to a period rather than asking a reader to filter it:

- `track report --period today|week|month|all` selects a named window.
- `track report --since <YYYY-MM-DD|commit> [--until <YYYY-MM-DD|commit>]` selects an explicit one; each
  bound must be a calendar date or a resolvable commit, never a literal that silently degrades.
- `--since` and `--period` are mutually exclusive, `--until` requires `--since`, and `--since` must not be
  after `--until` nor after the journal head.

Paste deterministic command output verbatim when that is what was requested. Do not call it
AI-prepared, cited AI, or adapter-backed.

## Contextual synthesis is advisory

An agent may add a contextual rendering, but no command, MCP tool, hook, or validator proves that it was
run or that its prose is complete. Before writing it, identify an explicit report window, focus order,
lane/concurrency policy, and model/effort policy. If any required input is absent, say that no executable
recommendation can be made; never infer it from an arbitrary event tail or session memory.

Do not invent options or recommendations for a legacy decision. A decision without recorded structured
options and recommendation keeps its row in **DÉCISIONS** but reads `à structurer`: it reserves no
D-number, carries no option letters, and is never offered in the reply line. An owner-ratified revision
supplies the actual existing `Option { id, title, summary }` objects and recommendation; an owner
selection is persisted with `track decision select <decisionId> <optionId>`.

## Contract

- The MCP server is read-only. It may report, query, validate, inspect canvas state, or show cursor/status
  data; it must not append to `.track/`.
- Do not treat missing MCP write/import tools as a blocker. Writes and imports use the `track` CLI from the
  target repository root.
- Run CLI writes from the target repository root, never from another checkout. `.track/events.jsonl` is
  append-only and single-writer; do not write or commit it from a concurrent worktree unless the user
  designated that writer.
- Never configure `track-mcp` / `h2a track-mcp` as a second host endpoint. Use the host-selected read-only
  endpoint for `track_*` tools and the CLI for local commands.

## Before a write

1. Confirm the target repository root and `.track/` ownership.
2. Confirm that the write represents the named owner-approved fact.
3. In a concurrent worktree, update the mergeable source artifact instead; leave `.track/` import to its
   designated writer unless explicitly told otherwise.

## Direct writes

- New item: `track item new --kind <feature|bug|chore> --title "<title>" --workspace <workspace>`
- Realization: `track item realize <itemId> <in-progress|done|cancelled>`
- Structured decision creation: `track decision new ... --context <text> --options-json <json> --recommendation <optionId> --rationale <text>`
- Legacy dossier migration: `track decision dossier <decisionId> --options-json <json> --recommendation <optionId> --rationale <text>`
- Owner choice: `track decision select <decisionId> <optionId> [--outcome go|no-go]`
- Artifact evidence: `track decision add-artifact <decisionId> ...`

## BRANCH import

When progress is represented by a `BRANCH.md` or `plan/NN-BRANCH_*.md` file, update that source artifact,
then run from the same repository root:

```bash
track branch import plan/<BRANCH_FILE>.md
track snapshot --format text
track validate
```

An import reporting `0 created, 0 updated` is valid when the sidecar is already current.

## Do not

- Do not manually edit `.track/events.jsonl` except for an owner-approved repair.
- Do not turn a generic rule-derived action into an owner decision.
- Do not claim a contextual report is machine-enforced.
- Do not initialize tracking in another repository without approval.
