---
name: model-eval
description: Pick h2a launch targets from the Artificial Analysis index — most intelligent model for design/spec/review (intelligence > 50, max effort), fastest for build — with quota and opus guards, emitting ready-to-use h2a_run calls. Use when choosing which model should author, review, or build a task.
---

# model-eval

Choose **which model** launches a task through `h2a run`, grounded in the
Artificial Analysis (AA) Intelligence Index crossed with what is actually
launchable. This skill decides the model; the h2a-run skill decides launch
ergonomics.
Both outputs below already follow h2a-run formats — send `mcp` to `h2a_run`
or paste `cli` at a terminal.

## Data source (verified 2026-11-04)

- AA Data API v2, `GET https://artificialanalysis.ai/api/v2/language/models/free`
  (all pages via `?page=`), header `x-api-key: $ARTIFICIAL_ANALYSIS_API_KEY`.
  Free-shape fields used: `evaluations.artificial_analysis_intelligence_index`,
  `performance.median_output_tokens_per_second`,
  `performance.median_time_to_first_token_seconds`, `pricing.price_1m_*_tokens`.
  Any valid key works (Free/Pro/Commercial); without a key the endpoint
  returns 401. The key travels only in the header — never print, log, or
  persist it; refer to it by name only.
- The public leaderboard page is NOT a fallback: it embeds no scores
  (client-side fetch, key-gated) — verified 2026-11-04.
- Snapshot cached at `<stateDir>/model-eval/aa-index.json` with `fetchedAt`
  (`<stateDir>` = `$H2A_ROOT`, else `~/h2a-workspace/.h2a`, override
  `$MODEL_EVAL_STATE_DIR`). Always work offline from the cache and show its
  date. No cache + no fetch possible → typed refusal, never a guess.

## Step 1 — ensure a dated cache

```sh
node packages/h2a/dist/model-eval/cli.js status [--state-dir <dir>]
node packages/h2a/dist/model-eval/cli.js fetch [--state-dir <dir>]  # needs the key
```

`fetch` rewrites the cache with a new `fetchedAt`. `recommend` never touches
the network.

## Step 2 — declare exhausted seats

`<stateDir>/model-eval/quota-overrides.json`:

```json
{ "exhausted": [{ "seat": "codex", "until": "2026-11-07T00:00:00Z", "note": "seat reset" }] }
```

`seat` matches a profile name, a full model id, or a mapping alias. A seat is
exhausted while `now < until`. (No other quota signal exists in-tree as of
2026-11-04; this file is the signal.)

## Step 3 — recommend

```sh
node packages/h2a/dist/model-eval/cli.js recommend --role <design|build|review> \
  --name <label> --workspace <abs path> [--prompt <text>] \
  [--author-model <id>] [--owner-authorized-opus] [--build-min-intel <n>] [--state-dir <dir>]
```

Rules:

- **design** (spec/design/design-review): intelligence strictly **> 50**,
  each pick at its profile's **max effort** (`xhigh`, except agy which caps at
  `high`). Most intelligent available is the author; the reviewer is the most
  intelligent pick on a **different model**. One eligible model → refusal
  (`MODEL_EVAL_NO_REVIEWER`).
- **build**: intelligence ≥ threshold (`--build-min-intel`, else
  `$MODEL_EVAL_BUILD_MIN_INTEL`, else default **30**), fastest
  `outputTokensPerSec` wins.
- **review**: `--author-model` required; most intelligent model distinct from
  it (opus/quota guards apply).
- **Opus guard**: Opus-class entries are excluded unless
  `--owner-authorized-opus` is passed (owner authorized it). The flag never
  invents a launch id — a flagged Opus slug without a mapping row stays
  excluded as unmapped.
- Unknown AA slug (no row, or row without attested launch id) → excluded and
  reported with its reason. Every exclusion is listed in `excluded`.

## Mapping table (reviewed 2026-11-04)

| AA slug | profile | h2a model id | notes |
|---|---|---|---|
| `gpt-5-3-codex` | codex | `gpt-5.6-terra` | Terra xhigh class (h2a-run skill) |
| `gpt-5-5-pro` | codex | `gpt-5.6-terra` | pro GPT via codex lane |
| `gpt-5-5-instant-06-26` | codex | `gpt-5.6-terra` | fast GPT; build-lane candidate |
| `gemini-*` (prefix) | agy | `gemini-3.7-flash-high` | family rule; agy max effort `high` |

AA slugs above were observed on the AA leaderboard page on 2026-11-04; launch
ids are attested by the h2a-run skill. Re-verify each launch id against the
live gateway catalog (`GET <gateway>/v1/models`) before relying on it — the
table is reviewed, not live. To extend: resolve the exact id, add a row with
today's review stamp in `packages/h2a/src/model-eval/mapping.ts`, extend the
fixture in `packages/h2a/test/model-eval.test.js`, rebuild, retest.

No rows exist yet for `muse`, `vibe`, or non-Opus `claude` (no attested launch
ids in-tree) — those AA models are excluded as unmapped until rows are added.
Opus has no launchable row by policy (see guard above).

## Output

One recommendation per role: `profile`, `model`, `effort` (`null` for vibe —
no effort arg), `gateway`, `headless`, `score` (intelligence, tokens/s,
latency), `source` (endpoint + `fetchedAt`), `mappingNote`, plus `mcp`
(ready `h2a_run` arguments) and `cli` (ready `h2a run … --prompt-stdin`).
Typed errors: `MODEL_EVAL_NO_SOURCE`, `MODEL_EVAL_NO_CANDIDATE`,
`MODEL_EVAL_NO_REVIEWER`, `MODEL_EVAL_FETCH_FAILED`, `MODEL_EVAL_BAD_CACHE`,
`MODEL_EVAL_BAD_INPUT` (exit 1 input · 2 state · 3 fetch).
