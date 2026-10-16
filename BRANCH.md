# Vibe native equipment and registry transition

## Objective
- [ ] Implement validated spec-astra-v9 and close the three Opus v9 minor findings.

## Scope / Guardrails
- [x] Branch feat/vibe-host-equip; base origin/main 58f111b3; package 0.98.6.
- [x] Isolated HOME/XDG roots, repository sources only, named tests, no Python or installed h2a.
- [x] Preserve historical Claude/Codex contracts, guards, customizations and registry prerequisites.
- [x] No real-host qualification inferred from fixtures; Muse/agy M-B remains required.
- [x] Track imports reserved for the conductor in this concurrent worktree.

## Branch Scope Boundaries
- [x] Allowed: packages/h2a/{src/hosts,src/cli.ts,src/runtime/{mcp,upgrade},skills,hooks,scripts,test,package.json}, scripts, docs, package-lock.json, BRANCH.md.
- [x] Forbidden: main, owner configuration/state, installed distribution, .track writes, unrelated fixes.
- [x] Conditional: CI wiring for named tests and Node 22/24 parser checks only.

## Lots
- [x] A1: isolated source runner and historical render catalog/generator; offline tests 2/2.
- [x] A2: safe native artifact writer, TOML 1.0 validation, ownership/backups/concurrency.
- [x] A3: Vibe guard/lifecycle wrappers and independent qualification freshness; hooks 2/2, convergence 2/2.
- [x] A4/E: skills/resources, VIBE_HOME, Muse and shared agy/Gemini ownership.
- [x] A5/E: doctor/status/install/plugin convergence and setup/connect diagnostics.
- [x] A6: explicit upgrade convergence and in-memory MCP operator notices.
- [x] A7/C: opt-in bounded qualification pilot, fork wording and phase-2 budget proof.
- [x] C/code: clean tarball consumers, 17 named files / 93 pass, 0 fail/skip on Node 22.22.1 and 24.14.0; four package typechecks on both.
- [x] Opus minors: mandatory doctor diagnostic oracle; corrected two-session phase-2 double with inclusive child accounting; session/fork default attachment wording.
- [ ] C/acceptance: genuine native observations/config persistence and author-complementary harness consensus remain unqualified.
- [ ] Delivery: conventional commits, fast-forward push, English PR, CI/report in French.

## Feedback Loop
- [x] B receipt discovery/API not accepted: no production reader or invented MCP writer.
- [x] Native target-host qualification and common RC-3 remain external acceptance gates.
- [x] bwrap unavailable; scoped shell calls require reviewed escalation.

## Delivery evidence
- [x] Two confined technical reviews reconciled in docs/reviews/2026-10-16-native-host-equipment.md; no harness consensus claimed.
- [x] Main inherited red: CI 38885431018, npm-test-trust-root B5 harmless proc entry case 2; legacy inventory 250ms exceeded. No guard weakened.
- [ ] B/R5/R7 receipt API, target-post Vibe qualification, Muse/agy M-B and common RC-3 remain external; A/E does not close the original MCP demand.

## Integration with refreshed main
- [x] Merge origin/main d2e0cfdc (PR 339 CI fixes); keep exact lockstep pins and vendored live-copy build step.
- [x] Track tree identical on both parents (3f3318b40d597af507216a184b9bd0e054987168); no Track repair/import/consolidation in this concurrent conductor-owned store.
- [x] CI-revealed help golden, documentation status and Focus dependency fixture corrected; three named files: 19/19 on Node 22 and 24.
