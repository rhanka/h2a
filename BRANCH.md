# Claude seat connector (lots 2–3 + NO-GO fix pass)

Branch: `feat/claude-seat-h2a-lots` (worktree `claude-seat-lots`).
Scope: Claude subscription seat for llm-mesh — lot 2 (enrollment +
renewable import through the mesh facade) and lot 3 (pinned-CLI runner +
host composition), plus the fix pass answering the opus NO-GO review
(`.h2a/reviews/claude_seat_lots_opus.md`: 7 BLOQUANT, 8 MAJEUR, 7 MINEUR).

State: **enrollment only / execution not-covered**. Seat gateway serving
stays halted (mesh pre-acquire seam gate 3A); the runner refuses spawn
unless every precondition below holds (brief stop condition §7).

Fail-closed preconditions (all tested, tests fail on the bug):
egress attestation + `H2A_CLAUDE_EGRESS_ENFORCED=1`; pinned CLI 2.1.296
with mandatory sha256 fingerprint and digest-bound qualification;
real 2.1.296 stream-json shapes with unknown/double/post-terminal
refusal; per-user private roots with ownership/type checks (no shared
tmp); cleanup failure blocks result; identity-proven lock reclaim and
sweep (run-meta.json, no blind deletes); static-only enrollment errors;
managed-settings refusal with fixed PATH; abort/deadline SIGKILL.

Validation: `tsc -b` clean; seat suites green
(`claude-code-cli-*`, `claude-seat-input`, `llm-mesh-accounts`,
`gateway-host/claude-code-seat-wiring`, `gateway-host/host`);
`gh pr checks 327 -R rhanka/h2a` green. Reports under `.h2a/` stay
untracked; the fix mapping lives in
`.h2a/build/claude_seat_fix_report.md` (untracked).
