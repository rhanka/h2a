# SPEC_STUDY — Native h2a agent runtime via sentropic (WP13)

Rung: **STUDY** (open questions + options + a recommendation each — NOT a committed EVOL).
Owner intent (Fabien, 2026-07-13): "notre propre CLI" (h2a's own agent) is articulated **via
sentropic** (the "agents" lane); the **main loop is managed by sentropic** (potentially rebuilt);
each h2a session runs **local / remote-k8s / in-sentropic**; all of it properly architected.

## Grounding (why this WP exists)
- No native agent exists today: no `@sentropic/agent`, no agent loop (LLM→tool_use→exec→loop).
  `h2a run` wraps claude/codex (host-adapter + auth-bundle + pty); the only LLM code is the GATEWAY
  (proxy for other agents).
- The objective-loop doesn't loop in real use because (a) nothing runs `h2a loop watch --execute`
  continuously, and (b) relaunch of a *stopped* agent is a TODO (request-launch only journals an ASK;
  the conductor handoff is unwired). The decision logic itself is fine (drumbeat fold-in shipped 0.85.16).
- So "make it loop" is NOT a local build — it is exactly this WP: **who runs the loop, where, and how
  relaunch is handed off**. Moving loop ownership to sentropic fixes (a) and (b) structurally.

## Open decisions (STUDY — options + recommendation)

**D1 — Where does the main loop / conductor live?**
Options: (a) sentropic hosts the existing h2a loop engine as a durable service; (b) sentropic has its
OWN native orchestrator that speaks the h2a protocol; (c) hybrid — local `h2a loop tick` stays for
dev/offline, sentropic is the durable primary driver.
→ **Reco: (c).** Sentropic owns a durable, always-on conductor that ticks + owns the relaunch handoff;
local tick remains a thin dev fallback. This is the minimal structural fix for "nothing runs it".

**D2 — What is a "h2a session" as a portable, placeable unit?**
A session must be describable independent of WHERE it runs: `{identity, conversation/context ref,
transport binding, workspace}`. Placements: local (tmux pane), remote (k8s pod — the existing
control-plane), in-sentropic (a sentropic-native runtime).
→ **Reco:** a **Session Descriptor** + a **Placement/Backend** seam (echoes the earlier ExecBackend
{local,container,pod} + adds `sentropic-native`). Sentropic can place/move a session across the 3.

**D3 — What IS the "native agent"? (the strategic fork)**
Option A — build a from-scratch coding agent (huge; competes head-on with Anthropic/OpenAI on the agent).
Option B — a **thin native agent loop** over the EXISTING gateway (LLM→tool_use→exec→loop), reusing the
tool/host surface; h2a's differentiation stays orchestration/governance.
Option C — "native agent" = the **sentropic-managed session experience** wrapping best-in-class agents
(claude/codex): the value is that sentropic drives + relances + governs them, not a new LLM agent.
→ **Reco: C now, B later if needed.** Deliver the managed-session/loop value first (reuses everything
that exists); a thin native loop (B) is an additive option once the orchestration layer is proven.
Avoid A. THIS is the fork the owner should confirm.

**D4 — What "managed by sentropic" implies for identity / gateway / resume:**
Sessions authenticate via the in-flight h2a↔sentropic **enrollment**; LLM via the **gateway** (built);
**resume** via a session store; sentropic owns the durable loop + session snapshots.
→ **Reco:** reuse the in-flight enrollment + gateway + resume work (don't duplicate); WP13 consumes
them. Gated on the same build-lane/architect seams already tracked.

**D5 — Relation to the sentropic "agents" lane (cross-owner):**
The owner said "articulée via sentropic avec le lane agents" — other owners hold the sentropic side.
→ **Reco:** WP13's first real artifact is a **SEAM contract**: h2a owns the session descriptor +
protocol + CLI/host side; sentropic owns the durable conductor + placement/orchestration; define who
owns which half BEFORE building (mirrors how the enrollment/bind seam was routed to the architect).

## Suggested first lots (when it moves from STUDY → EVOL → plan)
1. Seam contract h2a↔sentropic-conductor (D5) — cross-owner, needs the sentropic agents-lane + architect.
2. Session Descriptor + Placement seam (D2) — h2a-side, buildable (Sonnet) once D2 is fixed.
3. Durable sentropic-hosted conductor tick + relaunch handoff (D1) — the "make it loop" payload.
4. (Optional/later) thin native agent loop over the gateway (D3-B).

## Owner clarification (2026-07-13) — "la boucle" = the LLM/tool loop ONLY

The owner scoped it: in this WP, **"la boucle principale" is the agent's LLM/tool loop INSIDE a
session** (loop #2 below) — i.e. the native agent itself. It is NOT the conductor/objective loop
(#1 → that is WP3, the "relance" concern) nor process/session supervision (#3). This resolves most of
the Codex critique:

- **D3 is settled → OWN the loop (option B).** "Managed by sentropic + potentially rebuilt" is only
  possible for a loop we own; you cannot rebuild claude/codex's opaque inner loop. So the native agent =
  a **sentropic-owned agent-loop runtime** (LLM↔tools) that calls the **existing gateway**. Option C
  (wrap opaque vendors) is NOT this WP.
- **D4 contradiction disappears.** An owned loop calls the LLM via the gateway → governance/audit hold.
- **D2 "move is impossible" disappears.** A session = the runtime + its checkpointed context; placing/
  moving it across local/k8s/sentropic = re-instantiate the runtime with the context (well-defined),
  NOT PTY/process migration.
- **Out of WP13 scope:** the conductor/relance loop (#1 = WP3) and local process supervision (#3).

Re-scoped WP13 in one line: **the native h2a agent = a sentropic-owned LLM/tool-loop runtime (reusable,
possibly rebuilt) over the existing gateway, that h2a places as a session in local / k8s / sentropic**
(≈ the finalité-model's `@sentropic/agent`). D1/D2/D4/D5 below are re-read through this lens.

## Codex 5.5-xhigh pass — corrections folded (2026-07-13, one cost-aware leg)

The review found the framing NOT yet EVOL-ready. Key corrections (folded):

- **"The loop" is THREE loops, conflated here — separate them:** (1) the objective/**conductor** loop
  (sentropic CAN own — durable tick + relaunch decisions), (2) the **agent LLM/tool** loop (runs INSIDE
  a session), (3) the **process/session supervision** loop (relaunch/heartbeat). They have different
  correctness properties; D1 must name which one sentropic owns.
- **D1 overclaims the fix.** Moving ownership to sentropic does NOT by itself fix relaunch. Relaunch
  needs: launch authority in the target locale, idempotent lifecycle, heartbeat/lease, a **stop-reason**
  distinction (user-stop ≠ crash ≠ idle ≠ auth-fail ≠ OOM must NOT all relaunch the same), and
  checkpoint/recovery. Crucially: **sentropic cannot relaunch a LOCAL tmux/PTY session without a durable
  LOCAL daemon/agent** — so "managed by sentropic" still requires a local supervision agent for locale 1.
- **Split-brain:** if local `tick` stays as fallback while sentropic is primary, we NEED leader/lease
  rules, else both conductors tick/relaunch/mutate the same session.
- **D2 descriptor is insufficient** to place/move across 3 locales — also needs runtime image/env,
  secrets/capabilities, model+tool surface, workspace-sync semantics, resource/network policy,
  data-residency, checkpoint/resume, schema versioning. And **"move" is undefined**: live-migrating a
  PTY-backed claude/codex is ~impossible — define movement as replay / restart-from-transcript /
  vendor-native-resume / workspace-checkout, NOT process continuity.
- **D3 fork sharpened — C contradicts D4.** Option C (wrap claude/codex) means their LLM traffic goes
  through the VENDOR CLI/auth, NOT the h2a gateway → so C **cannot** simultaneously claim "LLM via
  gateway" (D4) or strong governance (tool execution stays opaque → no reliable policy/audit/budget/
  sandbox). So the real fork is: **own the inner loop (gateway-mediated, governed → toward B)** OR
  **supervise opaque vendor sessions (cheap → C, but then STOP calling it "native runtime" and accept
  weak governance + vendor-dependent resume)**. C's seams risk being throwaway if built around PTY/
  process details instead of lifecycle/events/policy.
- **Single highest-risk assumption:** that a sentropic-managed *wrapper* can give durable resume +
  relaunch + governance + 3-locale placement WITHOUT owning the inner agent loop, state, credentials,
  and tool-execution boundary. If false, the WP's value collapses or forces a late pivot to B.

## Not deciding here — the sharpened owner call
This is a STUDY. The owner's real decision (now clearer): **D3 — does h2a OWN the agent loop
(gateway-mediated + governed, toward B) or SUPERVISE opaque vendor sessions (cheap C, weak governance)?**
That choice shapes everything else (D1 which-loop, D2 move-semantics, D4 gateway, D5 seam). Also: whether
to open the **D5 seam** with the sentropic agents lane now. Then EVOL + plan. No code, no commitment.
