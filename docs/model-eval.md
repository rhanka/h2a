# model-eval — operator notes

Picks `h2a run` launch targets from the Artificial Analysis (AA) index.
Procedure: `packages/h2a/skills/model-eval/SKILL.md`.
Logic: `packages/h2a/src/model-eval/` (TS, built to `dist/`).
Tests: `packages/h2a/test/model-eval.test.js` (node:test, frozen fixture, no network).

## Files under the h2a state dir

`<stateDir>` = `$MODEL_EVAL_STATE_DIR`, else `$H2A_ROOT`, else
`~/h2a-workspace/.h2a` (the shared-bus default from `cli.ts`).

- `model-eval/aa-index.json` — `{ source, fetchedAt, intelligenceIndexVersion,
  models[] }`, written by `fetch`, read by `recommend`/`status`.
- `model-eval/quota-overrides.json` — `{ exhausted: [{ seat, until, note }] }`,
  hand-edited. `seat` matches a profile, a model id, or a mapping alias
  (`terra` for the codex rows). Exhausted while `now < until`.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `ARTIFICIAL_ANALYSIS_API_KEY` | (unset) | AA API key; header only, never printed |
| `MODEL_EVAL_BUILD_MIN_INTEL` | `30` | build-role intelligence floor |
| `MODEL_EVAL_STATE_DIR` | `$H2A_ROOT` / `~/h2a-workspace/.h2a` | state dir (tests use temp dirs) |
| `H2A_ROOT` | `~/h2a-workspace/.h2a` | shared h2a state root |

## Extending the mapping table

`packages/h2a/src/model-eval/mapping.ts` + fixture rows in the test file.
Exact slug beats prefix. Rows need `reviewed: YYYY-MM-DD`. No attested launch
id → `model: null` (excluded, reported). Opus rows additionally need the
recommender flag (`ownerAuthorizedOpus`) at call time.

## Verification

```sh
npx tsc -b packages/h2a
node --test packages/h2a/test/model-eval.test.js
node packages/h2a/dist/model-eval/cli.js status
```

No network in tests (fetch is stub-injected). `h2a install-skills` ships the
skill automatically from `packages/h2a/skills/` (h2a provenance, no manifest
edit — counts are asserted as `>= 1` in `install-skills-hosts.test.js`).
