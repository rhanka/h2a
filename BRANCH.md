# llm-mesh account administration

## Objective

Complete the canonical `h2a llm-mesh account` lifecycle. H2A remains a thin
consumer of the public `@sentropic/llm-mesh` facade and must never read or
mutate the Sentropic keyring directly.

## Base and ownership

- Branch: `fix/llm-mesh-account-admin`
- Base: `origin/main@04537de10ce9e0a3de6a39abcc3cc453ebcbbca4`
- H2A owns command names, rendering, aliases and process exit behaviour.
- Sentropic owns account inventory, owner isolation, credentials and deletion.
- `.track/**` remains single-writer and is forbidden in this worktree.

## Contract

```text
h2a llm-mesh account enroll <cloud-code|codex>
h2a llm-mesh account list [--json]     # alias: ls
h2a llm-mesh account remove <id>       # aliases: rm, unenroll
```

- `list` returns only public metadata for the local `ownerScope`.
- `remove` removes exactly one account in that same scope.
- Neither command exposes tokens, credential envelopes or keyring paths.
- The removed `h2a account` namespace stays removed.

## Scope

- `BRANCH.md`
- `docs/specs/2026-08-20-SPEC_EVOL_llm-mesh-account-administration.md`
- `docs/llm-mesh-account-migration.md`
- `apps/llm-gateway/package.json`
- `packages/h2a-runtime/src/index.ts`
- `packages/h2a-runtime/src/llm-mesh.ts`
- `packages/h2a/src/cli-command-map.ts`
- `packages/h2a/test/fixtures/runtime-help-commands.json`
- directly affected tests and dependency lockfiles

## Lots

- [x] Prove the missing facade seam and write the behavioural spec.
- [x] Write red unit and CLI acceptance tests.
- [x] Consume the published Sentropic account-administration seam.
- [x] Make scoped tests green, then run package build/typecheck/tests.
- [ ] Rebase, review, merge, tag merged `main`, verify CI publication, upgrade.

## Gates

- help exposes all canonical commands and aliases;
- fake-facade unit tests prove owner-scoped list/remove delegation;
- CLI integration tests prove stable JSON/table/error behaviour;
- a temporary isolated keyring proves enroll inventory and removal end to end;
- no legacy account-pool import or secret-bearing output returns;
- tag points to merged `main`; GitHub Actions alone publishes npm.
