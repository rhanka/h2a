---
name: track-operation
description: "Use when the user asks for a track report, status, or advancement/progress report — run the deterministic `track` CLI from the repo root; the in-session agent supplies any contextual prose. Also use when an agent needs to read, update, import, or verify track state; when a BRANCH.md or plan/NN-BRANCH_*.md changed; or when deciding between Track MCP and CLI. MCP remains read-only, writes/imports use the CLI, and .track is append-only/single-writer."
---

# Track Operation

Use this for ordinary track hygiene: reading status, importing BRANCH files, recording item or decision
updates, and verifying that the sidecar is current. This is the general operational skill; use
`present-decision` for human decision dossiers and `propose-workpackages` for backlog restructuring.

## Human deterministic report/status — DO THIS FIRST

For ANY human-facing track report or status (including "fais-moi un track report", "un track report",
"a status", "an advancement/progress report"): run the CLI `track report --wp --decisions --format text`
from the repo root. It is a complete, local projection of the folded log; the agent already in session may
add contextual prose without invoking another model.

- The MCP server is read-only. Use its `track_*` tools only for factual reads; use the CLI for human
  rendering, writes, and imports.
- `track report --wp --decisions --format json` exposes the complete conductor machine view; `--flat` is a
  deterministic diagnostic, never a way to recover rows omitted by the conductor.
- `track snapshot` or `track report --raw` is a **factual snapshot (not an AI report)**. Label it exactly
  that way when returning it to a human; do not turn rule-derived directives into unsupported advice.

## Contract

- Track's read surface is read-only by design. It may report, query, validate, inspect canvas state, or show
  cursor/status data; it must not append to `.track/`.
- **Host MCP singleton:** a host may configure exactly one active h2a endpoint, selected as local stdio or
  remote HTTP — never both. Re-running `h2a host setup --write` replaces that endpoint and removes its
  standalone Track entry rather than stacking servers.
- **Never configure or call `track-mcp` / `h2a track-mcp` directly as a host MCP endpoint.** Track is not a
  second host MCP connection: use the selected h2a endpoint for its read-only `track_*` tools. Use the
  `track` CLI from the repository root for deterministic human reports, writes, and imports.
- Do not treat missing MCP write/import tools as a blocker. Writes and imports are CLI operations.
- Run CLI writes from the target repository root, never from a different checkout. `track branch import
  ../other-repo/plan/X.md` writes to the current repo's `.track/`, not the other repo's store.
- `.track/events.jsonl` is append-only and single-writer. Do not write or commit `.track/` from a
  concurrent worktree unless the user has explicitly designated that worktree as the writer.

## Before A Write

1. Confirm the repository root you are operating in.
2. Confirm `.track/` exists. If it is absent, recommend `track init` and stop unless the user explicitly
   asked to initialize tracking.
3. If you are in a concurrent worktree, update the mergeable source artifact instead, usually the
   `plan/NN-BRANCH_*.md` file. Leave `.track/` import to the designated writer checkout unless told
   otherwise.

## BRANCH Import

When progress is represented by a `BRANCH.md` or `plan/NN-BRANCH_*.md` file:

1. Update the checkboxes in the BRANCH file. Keep the BRANCH file as the source of truth.
2. From the same repo root, run:

   ```bash
   track branch import plan/<BRANCH_FILE>.md
   ```

3. Verify immediately:

   ```bash
   track snapshot --format text
   track validate
   ```

4. If the import reports `0 created, 0 updated`, that is a valid idempotent result when the sidecar was
   already current.

## Direct Writes

Use direct CLI writes only for the event they actually represent:

- New item: `track item new --kind <feature|bug|chore> --title "<title>" --workspace <workspace>`
- Realization: `track item realize <itemId> <in-progress|done|cancelled>`
- Decision dossier: `track decision dossier <decisionId> --context <context>`
- Artifact evidence: `track decision add-artifact <decisionId> ...`
- Workpackage changes: follow `propose-workpackages`; do not reparent without human approval.

## Reporting Back

Report track results from the verified state, not from memory:

- Use `track report --wp --decisions --format text` for the exhaustive deterministic conductor.
- Use `track report --format md` when Markdown is explicitly useful; use `--flat` only for its separate,
  deterministic flat diagnostic.
- Use `track snapshot` or the exact alias `track report --raw` for canonical deterministic facts. Its text
  and Markdown renderers are diagnostics; always label them **factual snapshot (not an AI report)** when
  returning them to a human.
- `track report --format json` and the MCP `track_report` tool are deterministic factual compatibility
  surfaces, not AI-generated reports.
- Mention if `.track/` was intentionally not written because the current checkout is not the designated
  writer.

## Do Not

- Do not say "track write/import is not exposed" when the CLI exists. The correct statement is "MCP is
  read-only; I will use the track CLI from the repo root."
- Do not initialize tracking in another repo without explicit user approval.
- Do not manually edit `.track/events.jsonl` except for a deliberate repair with owner approval.
- Do not commit `.track/` updates produced from the wrong repo root or an undesignated concurrent worktree.

## Per-Agent Mapping

| Capability | Claude | Codex | Gemini-agy |
| --- | --- | --- | --- |
| skill entrypoint | `~/.claude/skills/track-operation/SKILL.md` | `~/.codex/skills/track-operation/SKILL.md` | `~/.gemini/commands/track-operation.toml` |
| read tools | selected h2a `track_*` tools or `track` CLI | selected h2a `track_*` tools or `track` CLI | selected h2a `track_*` tools or `track` CLI |
| write/import tools | `track` CLI | `track` CLI | `track` CLI |

Existing repo methods win on conflict. If a repo has a harness flow, let harness own the BRANCH artifact and
use `track branch import` to project it into the track sidecar.
