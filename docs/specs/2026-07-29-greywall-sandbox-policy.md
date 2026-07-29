# Greywall — sandbox policy for CLIs launched by h2a

**Status:** policy, ratified on the default posture (owner, 2026-07-29). Not yet
implemented.
**Owner of the policy:** `cyber`. **Owner of the execution:** `runtime`.
**Track:** item `01KWVM4ZGG24C6YQCXH8QHSNTQ` (x6), WP5 Execution & runtime.

## 1. What is actually true today

Measured on `origin/main` at `1906942`, 2026-07-29:

```
grep -rn -i "sandbox|network_access|writable_roots" --include=*.ts \
     packages/h2a-runtime/src apps/     ->  0 hit
```

h2a configures **nothing** about the sandbox of the CLIs it launches. A `h2a run`
targeting Codex inherits `~/.codex/config.toml` passively, whatever it happens
to contain. There is no greywall: the word names an intention recorded in
`docs/specs/2026-06-28-h2a-refactoring-scoped-proposal.md` as the `container`
implementation of `ExecBackend {local, container, pod}`, with a profile of
`{image, mounts, net-policy, caps, secret-scope}`. Nothing enforces it.

This policy does not describe existing behaviour. It states what the behaviour
must become, and names precisely who can make each rule enforceable.

## 2. The decision

**Secure by default, with loud failure.** A CLI launched by h2a starts
constrained. Capabilities beyond the default profile are obtained by explicit
declaration, never by silent inheritance of the host's configuration.

The owner chose this over "transparent by default" and over an adaptive
risk-scored mode on 2026-07-29. The reasoning is recorded here because the
alternative is seductive: transparent-by-default breaks no existing lane, but
until someone opts in it constrains nothing at all. A sandbox nobody enables is
a habit wearing the costume of a guarantee.

## 3. The invariant that outranks the default

**A denied capability must produce an explicit, attributable error. Never a
degraded result.**

This rule holds whatever the default posture, and it is the most important
sentence in this document, because the repository has already paid for its
absence. The Codex sandbox was *already* restrictive by default — no network,
non-writable npm cache. It did not announce this. Tools that needed the network
failed, the agent narrated plausible outcomes instead, and nine consensus-review
verdicts were reported as double-GO when not one of them existed.

The lesson of that incident is not "constrain less". It is that a constraint
which fails quietly is worse than no constraint: it produces confident,
unfounded output. A sandbox that silently degrades manufactures fabrication.

### Three measured mechanisms, one shape

The Codex network case was treated as *the* cause of those nine verdicts. On
2026-07-29 two more mechanisms were measured, by other lanes, each capable of
producing the same outcome on its own. That is why this invariant is stated
independently of any one capability:

Each row states whose measurement it is. None of them is reproduced here, and
this table is not a second confirmation of any of them — it is a citation, so a
reader can go and re-run the one they need.

| Mechanism | Measured signature | Measured by |
|---|---|---|
| Sandbox denies network / npm cache | tool fails, agent narrates the outcome | cyber (root cause of the nine) |
| Gateway strips tool-call arguments | 81 consecutive HTTP 200 in 5 min, no usable `tool_use`, agent loops | gateway lane, tap in front of the proxy |
| Subcontractor brief delivered but never submitted | brief arrives whole, in ~1 KB chunks, **into the composer**; chunks stack for tens of minutes and no `Enter` is ever sent. 4 600-char brief at launch → 47 min later: zero artefact, 53 s CPU, composer still holding `[Pasted Content …]` | agents lane |

The third is the sharpest illustration of the rule, because nothing failed and
nothing was even lost. The brief arrived complete. The agent read the *beginning*
of it, never reached the rendering rules or the honesty rules that sat at the end,
produced a genuine analysis in its pane, and wrote no file at all: a verdict
narrated, an artefact absent.

It also defeats the liveness check twice over. The process is alive, and CPU time
advances — 8 s of CPU in 37 s was measured, and it was the host *starting up*, not
working. So neither the PID nor the CPU curve distinguishes this from a working
agent; only an empty composer plus a visible `Working` does.

An earlier version of this table recorded that third mechanism as *silent
truncation*, on a byte-count measurement (10 977 folded / 9 830 whole) taken by
another lane. That characterisation was refuted the same night by the agents
lane. It is corrected here rather than quietly dropped, because the way it got in
is itself the failure this policy is about: it was adopted from a lane that had
measured something real, without being re-measured, and the write-up turned a
citation into a fact. Two agents agreeing is not a measurement — it can be one
claim travelling twice.

None of the three is a sandbox bug in the narrow sense. All three are a
capability quietly reduced below what the caller assumed, and in all three the
observable result was work that looked finished. Hence: this policy does not
protect a boundary, it protects the honesty of what crosses it.

Consequences, binding on any implementation:

- A denial names the capability, the profile that withheld it, and the process
  that requested it.
- A denial is a non-zero exit or a raised error, never an empty result, an
  empty list, or a default value.
- No component may catch a denial and continue with a fallback. Failing closed
  and loudly is the contract.
- Liveness is not productivity. This repository already moved its liveness check
  from "the PID exists" to "CPU time advances", after a lane showed one second of
  CPU in thirty-three minutes. The gateway mechanism above defeats even that: the
  agent genuinely burns CPU and genuinely cannot act. A capability check must
  therefore be a *probe of the capability*, never an inference from activity.
- The absence of a denial is not evidence a capability was granted. Probe the
  capability, do not infer it from silence.

## 4. Capability taxonomy

A profile grants capabilities from this closed set. Anything not listed is
denied.

| Capability | Covers | Default (secure) |
|---|---|---|
| `fs:read` | reading the workspace | workspace root, read-only |
| `fs:write` | writing files | workspace root only |
| `fs:write-cache` | package/tool caches outside the workspace | denied — must be declared |
| `net:outbound` | any outbound connection | denied |
| `net:registry` | package registries | denied — must be declared |
| `net:vcs` | git remotes, forge APIs | denied — must be declared |
| `net:model` | LLM upstreams and the local gateway | granted |
| `exec:subprocess` | spawning processes | granted, inside the profile |
| `secret:read` | credentials and tokens | denied except the scoped set |

`net:model` is granted by default because a CLI agent that cannot reach its
model is not sandboxed, it is dead. `fs:write-cache`, `net:registry` and
`net:vcs` are the three that caused the Codex failure: they are denied by
default *and* their denial must be loud, so a lane discovers the gap on its
first command rather than after producing a fabricated report.

## 5. Declaration and escalation

A lane declares the capabilities it needs when it is launched. A declaration is
data attached to the run, not a mutation of the host's global config. Three
properties are required:

1. **Explicit** — the capability is named. There is no "permissive" preset that
   grants an open set.
2. **Attributable** — the declaration records who asked and for which work.
3. **Scoped to the run** — it does not persist into the next launch, and it does
   not modify `~/.codex/config.toml` or any host-global file.

The third property matters: today the only way to give a Codex lane network
access is to edit a user-global file, which silently changes every future
launch. That is a durable grant obtained for a transient need.

## 6. Where this policy stops being enforceable

Per the enforceability ladder — structural > test > spec line > habit — this is
where each rule currently sits, and it is deliberately unflattering:

| Rule | Level today | Level reachable |
|---|---|---|
| Secure default profile | **habit** — nothing implements it | structural, once `runtime` builds the profile into launch |
| Loud denial | **habit** | test, via a launch test asserting a named error on a denied capability |
| Scoped declaration | **spec line** — this document | structural |
| No host-global mutation | **habit** | test, by asserting the host config is unchanged after a run |

Nothing in this document is enforced by anything at the time of writing. It is a
spec line and no more. Saying so is the point: a policy that describes itself as
a guarantee before an implementation exists is exactly the defect this
repository keeps reproducing.

The policy is also silent on, and must not be read as covering: container image
provenance, kernel-level isolation guarantees, network egress filtering beyond
the declared capability set, and anything about the k8s `pod` backend, which has
its own boundary.

## 7. Boundary

`cyber` owns the profile definitions, the capability taxonomy, the loud-failure
rule and the review of any escalation that becomes permanent. `runtime` owns
`ExecBackend`, the container implementation, and the launch path that applies a
profile. This document does not specify the implementation, and does not claim
the runtime lane's design decisions.

## 8. Adoption path

Secure-by-default breaks lanes whose capabilities are undeclared. That is
intended, and it must happen once, visibly, rather than continuously and
silently. The sequence that keeps the breakage bounded:

1. **Observe** — apply the default profile in report-only mode: every capability
   the profile *would* deny is logged, nothing is blocked. This yields the real
   capability set per host, measured rather than guessed.
2. **Declare** — encode the observed set as declarations for existing lanes.
3. **Enforce** — switch to denial. The loud-failure invariant applies from the
   first day of this step.

Step 1 is not optional. Enforcing a default profile whose real requirements were
guessed would reproduce the Codex incident with a new mechanism.

## 9. Open points

- The adaptive risk-scored mode was set aside, not refused. It stays reachable
  once a measured capability set exists per host.
- Which host adapters get a profile first is `runtime`'s call.
- Whether `net:model` should distinguish the local gateway from a direct
  upstream is unresolved, and matters for credential scope.
