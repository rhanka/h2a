# Workspace scope guard

Owner request: 2026-10-17 following cross-workspace integration #327.

- D1: Pin canonical session worktree in hook command. Payload cwd is a target,
  never authority. Sibling worktrees remain foreign even with the same origin.
  Global agy hooks pin a protected session journal instead: the single absolute
  host `workspacePaths` entry at SessionStart binds its native conversation once.
  Tool arguments and subsequent events cannot replace that binding.
- D2: Resolve shell cwd, repository selectors and remote destinations without
  executing tool commands; also inspect explicit file edits and patches.
- D3: Foreign mutations require exact expiring Ed25519 grants bound to workspace,
  session, repository, action and PR/ref. Owner key is pinned by deployment;
  no wildcard grants or agent trust enrollment.
- D4: Version edits of published packages and release actions require release
  authorization, including commit/push/PR checks for existing branch bumps.
- D5: Append typed denials and accepted grants to local human-readable JSONL.
  Audit failure refuses too; tell agents to hand work to the owning conductor.
- D6 (review #364, tour 2): Ship enforcement for Claude, Codex, agy, Muse,
  Vibe and Gemini. agy has native SessionStart/PreToolUse payloads. Muse's
  project hooks and denial protocol are verified against Meta's public
  1.4.10-R6427.1 artifact; native startup/dispatch run only on temporary profiles.
  Vibe's global profile binds each native session independently, retains explicit
  trust selections, and supports subsequent launches in other workspaces.

Independent design reviews: scope_design_security (authority/bypasses),
scope_design_coverage (host plumbing/false positives). Reconciled into D1–D6.

Boundary: hooks are defense in depth, not an OS sandbox. Arbitrary scripts can
hide writes. Protect hook configuration, pinned public key and owner signing key
outside the agent's writable/readable boundary for adversarial enforcement.
Application append-only writes are not filesystem immutability.
