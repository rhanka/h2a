# Fix: unattended relaunch autonomy lock

## Objective

- [x] Make `h2a relaunch --apply <session>` resume a dropped interactive session, clear only Claude's exact long-context confirmation, re-inject a continuation objective, and prove the agent is working before reporting success.
- [x] Verify and report whether durable actor memory is freshly loaded on resume.

## Scope / Guardrails

**Allowed Paths**

- `BRANCH.md`
- `packages/h2a-runtime/src/index.ts`
- `packages/h2a-runtime/src/conv-guard-wiring.test.ts`
- `packages/h2a-runtime/src/prompt-delivery.ts`
- `packages/h2a-runtime/src/prompt-delivery.test.ts`
- `packages/h2a-runtime/src/relaunch.ts`
- `packages/h2a-runtime/src/relaunch.test.ts`
- `docs/uat/**` only for the requested real-session capture.
- `docs/reviews/**` only for harness consensus artefacts.

**Forbidden Paths**

- `.track/**`
- dependency manifests and lockfiles
- objective-loop policy or Track realization state

## Lot 1 — unattended resume and work proof

- [x] Detect Claude's exact stale-session summary confirmation and submit one Enter only for that prompt.
- [x] Re-inject a bounded continuation objective after resume and use the existing prompt-delivery proof to require real processing.
- [x] Fail loudly with the observed pane state when resume parks or a different host modal appears.
- [x] Regression-test confirmation gating, no-confirmation resume, objective selection, and failure behavior.
- [x] Capture a real `h2a relaunch --apply` reaching WORKING unattended.

## Feedback Loop

- [x] Report the SessionStart-versus-actor-RECALL memory finding without widening this fix into a memory redesign.
- [x] Complete two independent review legs and reconcile their findings.
- [ ] Owner UAT remains required; do not mark Track work done.
