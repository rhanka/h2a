# Claude 5.5 through AGY

The `agy` profile accepts `claude-opus-5-5-{low,medium,high}` and
`claude-sonnet-5-5-{low,medium,high}`. Always select the model explicitly:
AGY's default is Gemini 4 Argon. Interactive and headless launches apply
`--model` before starting the agent. Effort accepts low, medium and high;
max maps to high, while xhigh returns `agy-effort-unsupported`. An explicit
effort replaces the model's effort suffix (low + max launches high).

Reserve this precious Claude credit pool for reviews and adversarial challenges
first. Never use it for bulk builds without explicit owner/caller opt-in.
`--role build` requires `--allow-claude-build`; the MCP equivalents are
`role: "build"` and `allowClaudeBuild: true`. Review and challenge roles do
not require that flag. Role is a caller declaration, not a classifier of prompt
intent; callers must label build work honestly.

```sh
printf '%s' 'Challenge this design and write review.md' |
  h2a run agy "$PWD" --name agy-review --background --no-attach --no-h2a \
    --model claude-opus-5-5-high --role challenge --headless --prompt-stdin \
    --output-file "$PWD/review.md" --json
```

Headless AGY uses stream-json input/output. The brief travels on stdin,
never in argv: do not use `agy -p --model X "prompt"`, because `-p` can
swallow `--model`. The private run-once supervisor is shared by native and
tmux hosts and records `.h2a/runs/<name>/output.log` and `result.json`.

## Results and quota

The launch receipt's `session.model` is the resolved model applied to the
process, with `modelSource: "launch-argument"`. It is not a provider identity
attestation: `effectiveModel` stays `unknown` until AGY emits a model in its
JSON output. The final result records that observation, and a different model
fails with `agy-model-mismatch`. H2A never changes to Argon or another model.

`AGY_ERROR` resource-exhausted/429 quota diagnostics produce
`agy-claude-quota-exhausted`, even if AGY exits 0 or marks them retryable.
The typed failure has `retryable: false`, `retrySafe: false`, and, when the
provider says `Resets in <duration>`, an absolute ISO `resetsAt` timestamp
both at the top level and under `quota`. There is no automatic retry or
fallback; the caller chooses the next action.

Run is asynchronous: its initial receipt says started. Read `result.path` for
the final completion, or repeat the same `h2a_run` name on the same MCP server
to read the durable completion without launching again. A quick quota refusal
can already appear in the initial CLI/MCP response.

`--output-file` / MCP `outputFile` declares the artifact expected from the
agent. Completion distinguishes `written`, `missing`, and `unchanged`; a missing
or unchanged artifact fails with `agy-output-missing` unless a quota error
takes priority. The captured log is not proof that the requested artifact was
written. Without a declared artifact, output status is `not-requested`.

`h2a doctor` exposes `agyClaudeQuota`; AGY Claude launch receipts and final
results also include the last known quota observation. The observation lives
under `$XDG_STATE_HOME/h2a/agy-claude-quota.json` (the standard user state
directory otherwise). No quota probe or model call is made. Without provider
evidence status is `unknown`. A recorded reset time is an estimate derived
from the provider duration at observation, not proof that credits are now
available; an elapsed reset does not silently clear the historical observation.

## Verification boundary

Tests use a fake AGY and temporary HOME/XDG roots on Node 22/24. They cover
argv/stdin, effort mapping, build admission, quota/reset, output absence, model
mismatch, doctor and MCP completion polling. They make no real model calls.
Real AGY/native host acceptance and cross-platform qualification remain owner
integration work.
