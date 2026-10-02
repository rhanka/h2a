# h2a_run launch readiness and cancellation

## Objective

- [x] Fix Track 01M3JPMG8NQ6P3PW94M7KY96ZC / 01M3JPSXBHPKN3R5N7VMK84J16 from origin/main on fix/h2a-run-launch-readiness.
- [x] Preserve single-paste/single-submit delivery and stop owned partial launches after timeout.

## Scope / Guardrails

- [x] Allowed: launcher bridge, runtime prompt delivery, native capture, launch guard, their tests, replayable UAT script, dependency needed for VT rendering, this plan and evidence.
- [x] Forbidden: .track writes (h-cond remains single writer), secrets, Python, AI commit attribution, main push, PR creation, merge, CI reruns.
- [x] Add @xterm/headless because stripping escape sequences loses the actual visible screen and retains erased startup text.

## Lots

- [x] Reproduce MCP timeout at 30,039ms with a live Codex session, missing run directory and compact native capture; promote profile failures to RED tests.
- [x] Render the native screen, recognize Codex/Muse composer and loading/modal states, calibrate profile idle CPU, and budget readiness separately from the outer deadline.
- [x] Add independent EOF guard, exact-incarnation cleanup for native agent/sidecar, fenced cleanup receipt and conservative retry safety.
- [x] Add structured provider-blocked evidence for a submitted prompt refused by quota.
- [x] Add script using real provider CLIs, an isolated PTY host/bus, file witnesses, a delayed MCP server and forced cancellation.
- [x] Complete build, typecheck, focused runtime tests and npm test.
- [x] Record final UAT and review limitations.
- [x] Prepare commit and push only fix/h2a-run-launch-readiness after all local gates pass.

## Feedback Loop

- [x] Native trust gates are explicit launch failures; UAT trusts only its owned worktree for that run.
- [x] Muse ready at 3–4s but idle tree measured 1130ms CPU/2.2s: composer evidence must override the generic 0.3-core readiness ceiling; this idle CPU must never count as prompt work.
- [x] Codex launch with 45s delayed MCP measured 55.119s total, prompt delivery 48.581s: former 30s outer deadline was shorter than a legitimate launch. Codex/Muse readiness budget 180s; outer 270s includes delivery, RPCs and cleanup. Other profiles retain 90s readiness with 180s outer budget.
- [x] Independent review selection failed: live llm-mesh catalog contained only muse-spark-1.3 and muse-spark-1.3-contributor; fewer than two eligible Claude-hosted models for the requested author profile. No consensus claimed.
- [x] Muse returned Usage limit reached, reset Oct 4 at 8:00 PM. A provider quota refusal after proven submission is distinct from launch readiness failure.
