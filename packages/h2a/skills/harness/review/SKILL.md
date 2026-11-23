---
name: review
description: Use when completing a feature, a design step, or before merging — runs a ≥2-peer consensus review and reconciles the findings, instead of a single rubber-stamp pass.
---

# harness/review

Native sentropic code/design review. Stronger than a single review: **≥2 independent peers**, distinct
lenses, reconciled. Open it with `harness review "<target>" --consensus [--peers <n>]` (records a
WorkEvent).

## Author-complementary selection

Before selecting a reviewer, create a repo-local Markdown review dossier tied to the target's exact
commit/path and, for a working-tree target, the SHA-256 of the bytes from
`git diff HEAD --no-ext-diff`. It MUST record the author's `host`, exact `model`, and `effort`. Host means
`claude`, `codex` or `vibe`, the reviewer-capable profiles the launch operation actually accepts. **Unknown author means no
acceptable review:** write `status: selection-failed` and `observed-failure` to that dossier, then stop;
never infer missing metadata from the current CLI.

```yaml
review-author:
  host: codex
  model: <exact-model-id>
  effort: <low|medium|high|xhigh>
target-ref: <commit/path>
target-diff-sha256: <required for a working-tree target>
```

Build candidates as `(profile, model, effort, lens)` from the currently reachable h2a/llm-mesh set. Resolve
model ids through the `h2a-run` skill/live mesh; never freeze a routing table here. Mechanically keep a
candidate only when:

```
candidate.profile != author.host && candidate.model != author.model
```

Deduplicate surviving `(profile, model)` pairs and require ≥2. Complementarity is on the **host**, not
only the model: Codex authors get Claude-hosted legs; Claude authors get Codex-hosted legs. If fewer than
two eligible legs remain, write `status: selection-failed` and `observed-failure` to the dossier; do not
claim consensus.

## Dispatch through h2a

Keep legs blind and give each the same target plus a distinct adversarial lens. For a code target, also
give each leg the same change-risk table (`harness/test`), computed once at `target-ref`: it is shared
evidence, not a lens, and a leg does not recompute it. Launch only through the
installed h2a MCP server's `h2a_run` tool — that is how a skill user reaches the `h2a run` operation.
The packaged Claude Code hook also refuses direct `h2a` CLI calls from Bash.

The MCP call requires `profile: "claude"|"codex"|"vibe"`, a unique `name`, `prompt`, `background: true`, and an
absolute existing directory `workspace` that realpaths inside the MCP startup root and outside the OS temp
directory. It optionally accepts `model`, `effort: low|medium|high|xhigh`, `gateway: auto|required|off`,
`headless`, and `h2aSidecar`; `required` is Claude-only, so Codex and Vibe use `auto|off`.
A vibe leg is always direct (its own plan-billed Mistral credential), is interactive/background only
(`headless` is rejected — `vibe -p` takes the prompt as argv), and does not carry `model`/`effort` on the
launch argv (they are vibe config concerns: `VIBE_ACTIVE_MODEL`, `/thinking`), so a vibe candidate records
the model id resolved through the live mesh catalog and never attests an enforced effort.
Use no other profile or field. Never embed an endpoint or credential: h2a and the llm-mesh own accounts,
reachability, routing, and fallback.

The selector compares the exact **declared/requested** model ids. Today's launch receipt does not attest
the effective post-routing model or effort, so it cannot expose an unreported fallback. Never describe the
request, receipt, or reviewer's self-report as proof of effective identity.

## One readable artefact per leg

Create a readable Markdown stub at a unique repo-local path before dispatch and put that exact path in the
prompt. Use a machine-readable header:

```yaml
status: dispatched|completed|failed
reviewer-host: claude|codex|vibe
reviewer-model: <declared/requested-model-id>
reviewer-effort: <low|medium|high|xhigh>
target-ref: <commit/path>
target-diff-sha256: <required for a working-tree target>
lens: <assigned-adversarial-lens>
observed-failure: <required when failed>
```

A completed leg adds readable reasoning, findings, and a verdict. A failed leg has no verdict. A launch
result proves only that a session started; a table saying `GO` is not a leg artefact.

Launch rejection, agent error, timeout, missing/unreadable file, or mismatch among selected/requested/
declared metadata is the leg's `FAILED` result. The coordinator writes the observed failure to the stub;
never report the verdict the tool would have produced and never hide a failed leg behind an unrecorded
retry.

## Consensus protocol

1. Dispatch ≥2 eligible independent peers on the SAME diff/design, each blind to the others.
2. Use distinct lenses where a finding can fail in more than one way: correctness · security · performance
   · does-it-actually-reproduce.
3. Refute by default. A finding survives only if it withstands the skeptics; a kill needs a majority.
4. Reconcile only completed leg artefacts. Preserve disagreements and classify accept / reject / defer
   with a one-line rationale; do not average.
5. Write the aggregate result to the review dossier with links to every leg, using:

   ```yaml
   status: completed|incomplete|selection-failed
   legs:
     - path: <repo-local-leg-path>
       status: completed|failed
   consensus-verdict: <required only when status is completed; omit otherwise>
   observed-failure: <required when status is incomplete or selection-failed; omit otherwise>
   ```

   `completed` requires ≥2 eligible completed legs and no failed dispatched leg. Any dispatched leg that
   fails makes the dossier `incomplete`; selection failure and incomplete review have no consensus verdict.

   For a code target, the dossier also carries the change-risk counter, next to the aggregate result:

   ```yaml
   change-risk:
     pr: <pull request or branch; the tally keeps the last round of each PR>
     touched: <units in the table>
     alerts: <units that trip the ratchet: added or made more complex, and over 30>
     not-relevant: <alerts both legs judge not relevant>
     na: <touched units without coverage>
   ```

## Receiving review (technical rigor, not performative agreement)

Before implementing a suggestion, verify it. If feedback is unclear or technically questionable, push back
with evidence rather than complying blindly. Apply what's correct; refute what's wrong; ask when genuinely
ambiguous.

## Severity & gate

Findings that gate a lot escalate to a `VerificationRun` (`harness verify --category static`). Narrative
findings stay a `WorkEvent`. Blocking findings must be resolved before merge; non-blocking are logged in
`BRANCH.md` `## Feedback Loop` with owner + status.

Change risk (`harness/test`) is reported with its table and its counter; it does not block a merge by
itself. One case blocks today: a score brought down by tests that assert nothing. For a `switch`, judge
before asking for a split: delegating cases are not counted, and a function still over 30 because its
cases hold logic may read better left whole — say which, and why. An alert both legs find not relevant
is counted as `not-relevant`.

## Enforcement boundary

**Structural > test > spec line > habit.** The MCP schema and Claude Code Bash guard are structural for
launch shape only. This skill states the metadata, selector, artefact, and failure contract (spec line),
but an agent still applies the predicate, trusts declared identities, and checks outputs (habit). No code
in this design enforces author exclusion or attests the effective model; do not present either as
structural or test-backed.

The change-risk number comes from a script and its tests; what a reviewer does with it is habit.
