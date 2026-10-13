# Claude seat on the common seat model (realign 2026-10-13)

Branch: `feat/claude-seat-h2a-lots` (worktree `claude-seat-lots`).
Scope: Claude subscription seat for llm-mesh, realigned on the model every
other seat follows (owner decision 2026-10-13, DEC-118): same facade
enrollment shape, mesh-side storage/refresh, gateway registry wiring, same
test families — nothing Claude-specific.

State: **enrolled seats route through the mesh; serving needs the
owner-qualified pinned CLI**. The gateway composes mesh
`ClaudeCodeRuntimeClient` on the h2a runner into the provider registry via
`AnthropicAdapter` when `H2A_CLAUDE_BINARY_PATH` +
`H2A_CLAUDE_BINARY_DIGEST` are set; unconfigured composes no Anthropic
route (same fail-closed per-attempt outcome as a seat with no enrolled
account). The pre-acquire seam halt is gone — account locking lives in the
mesh directory like every other seat.

Removed without replacement (no other seat carries them): egress/netns
guard (`egressNetnsReader`, `H2A_CLAUDE_EGRESS_ENFORCED`, `/proc` netns
checks), org-proof handoff, managed-config + registry/MDM guards, h2a-side
account lease lock, seam-gate attempt binding.

Kept: facade enrollment (OAuth default + `--from cli` official store +
`--from token` secret-manager pipe, DEC-119), mesh keyring
storage/refresh, pinned-CLI qualification per attempt (absolute path,
2.1.296, digest match, attestation), sandbox transport, identity-proven
reaping/sweeps, cleanup blocking the result, static error boundary, masked
TTY input / piped-token boundary (never argv, never logged).

Validation: `tsc -b` clean; seat suites green
(`claude-code-cli-*`, `claude-seat-input`, `llm-mesh-accounts`,
`gateway-host/claude-code-seat-wiring`, `gateway-host/host`);
`gh pr checks 327 -R rhanka/h2a` green. Reports under `.h2a/` stay
untracked; the realign report lives in
`.h2a/build/claude_seat_realign_report.md` (untracked) and the seat-model
inventory in `.h2a/build/seat_model_inventory.md` (untracked).
