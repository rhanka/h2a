# H2A Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap the `h2a` repository as a working npm/TypeScript workspace with a tested core package and thin MCP/Codex/Claude wrappers.

**Architecture:** Use a root npm workspace with four packages under `packages/`. Keep the core package dependency-light and implement runtime guards/types for the first envelope and negotiation primitives. Keep the integration packages intentionally thin so the repo can evolve without locking in unstable external APIs.

**Tech Stack:** npm workspaces, TypeScript, Node built-in test runner, assert

---

### Task 1: Workspace Skeleton

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `tsconfig.json`
- Create: `packages/h2a/package.json`
- Create: `packages/h2a/tsconfig.json`
- Create: `packages/h2a-mcp/package.json`
- Create: `packages/h2a-mcp/tsconfig.json`
- Create: `packages/h2a-codex/package.json`
- Create: `packages/h2a-codex/tsconfig.json`
- Create: `packages/h2a-claude/package.json`
- Create: `packages/h2a-claude/tsconfig.json`

- [ ] Add a root workspace `package.json` with `workspaces`, `build`, `test`, `clean`, and `typecheck` scripts.
- [ ] Add shared TypeScript config in `tsconfig.base.json` targeting modern Node ESM output under `dist/`.
- [ ] Add a root references `tsconfig.json` pointing to all four packages.
- [ ] Add package manifests and per-package `tsconfig.json` files for `h2a`, `h2a-mcp`, `h2a-codex`, and `h2a-claude`.
- [ ] Install root dev dependencies needed for compilation only.

### Task 2: Red Tests For Core Envelope Surface

**Files:**
- Create: `packages/h2a/test/envelope.test.js`
- Create: `packages/h2a/test/negotiation.test.js`

- [ ] Write a failing test for creating a valid `H2AEnvelope`.
- [ ] Write a failing test for rejecting an invalid envelope shape.
- [ ] Write a failing test for accepting only the declared negotiation states.
- [ ] Run the package test command and verify failures come from missing exports/behavior, not from a broken harness.

### Task 3: Core Package Minimal Green

**Files:**
- Create: `packages/h2a/src/index.ts`
- Create: `packages/h2a/src/types.ts`
- Create: `packages/h2a/src/envelope.ts`
- Create: `packages/h2a/src/negotiation.ts`

- [ ] Define exported literal unions and structural types for roles, artifact kinds, envelope types, negotiation states, and minimal registration/negotiation records.
- [ ] Implement `createEnvelope`, `isH2AEnvelope`, and `assertValidNegotiationState`.
- [ ] Export the core API from `packages/h2a/src/index.ts`.
- [ ] Re-run the tests until the core package is green.

### Task 4: Thin Integration Packages

**Files:**
- Create: `packages/h2a-mcp/src/index.ts`
- Create: `packages/h2a-codex/src/index.ts`
- Create: `packages/h2a-claude/src/index.ts`

- [ ] Export canonical tool names and adapter metadata from `h2a-mcp`.
- [ ] Export `h2a-codex` metadata referencing the shared core package.
- [ ] Export `h2a-claude` metadata referencing the shared core package.
- [ ] Ensure all packages compile in one workspace build.

### Task 5: Verification And Publish Prep

**Files:**
- Modify if needed: `README.md`

- [ ] Run `npm test` from the repo root.
- [ ] Run `npm run build` from the repo root.
- [ ] Run `git status --short --branch` and confirm only intended files changed.
- [ ] Commit the scaffold in one or more focused commits.
- [ ] Push `main` to `origin`.
