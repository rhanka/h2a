# Feature: h2a Codex slash prompt install

## Objective

- [x] Install Codex's native `/h2a` slash prompt when `h2a install-skills --host codex` runs.
- [x] Keep the h2a skill as the single source for command instructions.

## Scope / Guardrails

**Allowed Paths** `packages/h2a/src/cli.ts` `packages/h2a/test/install-skills-hosts.test.js` `BRANCH.md`

**Forbidden Paths** `packages/h2a-runtime/**` `packages/track/**` `package.json` `package-lock.json` `Makefile` `.github/**`

**Conditional Paths**

## Plan / TODO

- [x] **Lot 1: Codex prompt install**
  - [x] Render `~/.codex/prompts/h2a.md` from the bundled h2a skill.
  - [x] Write the prompt during Codex skill install, even when the skill already exists.
  - [x] Cover fresh install and missing-prompt migration with tests.
  - [x] Run build, targeted test, and harness checks.

## Feedback Loop

- [x] Coordinate with live Claude h2a/a2a-cli owner before PR/merge.
