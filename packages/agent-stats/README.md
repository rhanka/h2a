# @sentropic/agent-stats

Per-agent stats from agentic CLI transcripts (evidence-based attribution,
not git authorship): Claude Code, Codex and agy/Antigravity transcripts are
parsed, normalized to session facts, correlated against `git log` and the h2a
registry, and aggregated per agent. Includes the rename-aware project
conversation graph builder.

## Provenance

Imported from the engram repository (memory lot F12, owner decision D-2 = A:
the module leaves engram for a separate repository; h2a is the owning host).

- Source: engram `origin/main` commit `e432240f8d5ea670efe672bfac52969d944cd59f`,
  staging area `_extracted/agent-stats-h2a-module/` (18 `src/*.ts` files) plus
  the six `tests/agent-stats*.test.ts` suites (excluding the "CLI root" half
  of `tests/agent-stats-extraction.test.ts`, which stays in engram) and the
  `tests/fixtures/agent-stats/**` fixtures.
- No behavior change on import; only imports/paths/config were adapted:
  engram's generic git/PR helpers are vendored under `src/vendor/git.ts` and
  `src/vendor/pr.ts` (verbatim copies); the temporal-window filter and the
  studio scene builder used by two suites are vendored under
  `src/vendor/temporal-window.ts` (same closed-v1 semantics) and
  `src/vendor/studio-scene.ts` (verbatim copy).

## Registering the commands in an h2a host

`src/index.ts` is the activity API and `src/cli.ts` exports
`registerAgentStatsCommands` for an h2a host to register the former
`agent-stats` and `project-graph` commands:

```ts
import { Command } from "commander";
import { registerAgentStatsCommands } from "@sentropic/agent-stats/cli";

registerAgentStatsCommands(new Command());
```

Its projection labels are local to this module. It has no import of a legacy
memory surface; a memory engine accepts activity only through the neutral
`ActivityEvidenceSource` contract.

## Known adaptation: `--studio`

The `project-graph --studio` flag keeps engram's guards (missing `graph.json`
and unsafe export-target errors are identical) but h2a ships no prebuilt
studio SPA, so the export always reports the same
`StudioSpaNotBuiltError` engram raises when its SPA is missing. See
`src/vendor/studio-export.ts`.

## Tests

Targeted suites only (the conductor runs the full repo suite at integration):

```sh
npx vitest run --config vitest.config.ts tests/agent-stats.test.ts
```

All six suites use temporary directories only and never touch the live
`~/.claude`, `gh`, or `git log` state (the `gh` runner is injected).
