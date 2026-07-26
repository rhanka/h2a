# Index — capitalising the two native-CLI studies

Added by: this PR (not part of either study's own content).

## What this is

Two owner-authored STUDY documents that existed only as uncommitted, untracked
files in the owner's working tree. They record the design of the h2a native
CLI / agent runtime, co-designed with the architect, and were unreachable by
any other agent or session — including a WP15 (native h2a CLI / agent
runtime) agent that searched for this design, correctly refused to
reinvent it, and returned a named blocker instead.

This PR commits both files **verbatim**, byte-for-byte identical to the
working-tree copies, under `docs/specs/`. No content was edited, reformatted,
translated, or reconciled between the two documents.

## The two studies

1. `2026-07-17-STUDY_h2a-cli-coconception.md` — *Human-centred h2a CLI
   surface and sentropic seam*. Follows the 2026-07-17 co-design brief;
   proposes the target information architecture for the `h2a` command
   surface as the single-plugin front door.

2. `2026-07-18-STUDY_h2a-native-agent-and-session-engine.md` — *The h2a
   native agent and the sentropic session engine*. Records an owner-settled
   design target for `h2a` becoming a native interactive agent (the
   equivalent of Claude Code / Codex / Hermes / agy) over a sentropic-owned
   session engine. States explicitly that it supersedes the 2026-07-17 study
   for the two "empty-dispatch" CLI forms it covers, while the 2026-07-17
   study remains the source for unaffected verbs. Its stated backbone,
   `docs/specs/2026-07-13-SPEC_STUDY_native-agent-via-sentropic.md` (WP13),
   is already committed on `main`.

## What this PR deliberately does NOT do

- It does not reconcile the two studies or decide which parts of each are
  authoritative where they overlap — the 2026-07-18 study itself says which
  parts of the 2026-07-17 study it supersedes and which it doesn't; beyond
  that, adjudication is the owner's call, already flagged as an open
  question by a WP15 agent.
- It does not implement anything the studies propose. Rung is STUDY:
  proposal and recommendations only, no runtime implementation commitment.
- It does not touch any other file in the repository.

## Other untracked studies found, left out of this PR

The same working tree also contains two further untracked STUDY documents
that were not part of this capitalisation because they concern a different
topic (session-identity/addressing bugs, not the native-CLI design the
owner referred to):

- `docs/specs/2026-07-18-STUDY_h2a-named-session-addressing.md`
- `docs/specs/2026-07-20-STUDY_gw-session-identity-isolation.md`

plus two DESIGN and one CR document (tmux status bar / tmux liveness), and
one file under `docs/superpowers/specs/` that already has git history on
other branches and so needs no capitalisation. See the PR description for
the full inventory.
