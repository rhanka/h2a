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
- [x] Allowed: packages/h2a/{src/hosts,src/cli.ts,src/runtime/mcp,skills,hooks,scripts,test,package.json}, scripts, docs, package-lock.json, BRANCH.md.
- [x] Forbidden: main, owner configuration/state, installed distribution, .track writes, unrelated fixes.
- [x] Conditional: CI wiring for named tests and Node 22/24 parser checks only.

## Lots
- [ ] A1: isolated source runner and historical render catalog/generator.
- [ ] A2: safe native artifact writer, TOML 1.0 validation, ownership/backups/concurrency.
- [ ] A3: Vibe guard/lifecycle wrappers and independent qualification freshness.
- [ ] A4/E: skills/resources, VIBE_HOME, Muse and shared agy/Gemini ownership.
- [ ] A5/E: doctor/status/install/plugin convergence and setup/connect diagnostics.
- [ ] A6: explicit upgrade convergence and in-memory MCP operator notices.
- [ ] A7/C: opt-in bounded qualification pilot, fork wording and phase-2 budget proof.
- [ ] C: clean package consumer, named Node 22/24 checks, two-peer review and docs.
- [ ] Delivery: conventional commits, fast-forward push, English PR, CI/report in French.

## Feedback Loop
- [x] B receipt discovery/API not accepted: no production reader or invented MCP writer.
- [x] Native target-host qualification and common RC-3 remain external acceptance gates.
- [x] bwrap unavailable; scoped shell calls require reviewed escalation.
