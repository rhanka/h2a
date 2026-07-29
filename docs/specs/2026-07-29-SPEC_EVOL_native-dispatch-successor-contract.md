# EVOL — Native dispatch successor contract

Date: 2026-07-29
Rung: **EVOL — paper only.** This document specifies a successor contract and its
acceptance fixtures. It authorizes **no** dispatch code, no native engine work, no package
change, no publish and no cutover. Every realization is gated by §5.
Backbone: `docs/specs/2026-07-18-STUDY_h2a-native-agent-and-session-engine.md` §11 (WP13),
itself grounded on `docs/specs/2026-07-13-SPEC_STUDY_native-agent-via-sentropic.md`.
Work package: WP13. Track item: `01KWVNYNHVJGA8CCW566PG4WMH`.

## Intent

The owner settled a breaking target on 2026-07-18: bare `h2a` and exact, zero-operand
`h2a run` both start the native interactive agent, `h2a run native` is the explicit
equivalent, `native` is the sole implicit runtime, and every vendor stays explicit. That
target contradicts two published behaviors. This EVOL freezes the successor grammar, the
exit taxonomy, the safety guards and the acceptance fixtures **on paper**, so the h2a-side
contract is ratifiable before the cross-owner engine answers arrive — and so that no part
of it can be shipped by accident before they do.

## Grounding — re-verified on `origin/main` @ 1906942 (2026-07-29)

The STUDY's grounding was measured on 2026-07-18. Each load-bearing fact was re-read today
in this checkout; all still hold:

- `packages/h2a/src/cli.ts:6722` — `runCli` maps empty argv, `--help`, `-h` and `help` to
  `renderCliHelp()` and returns 0. The comment at `:6728` names DEC-034's no-argv-is-help
  rule explicitly.
- `packages/h2a/src/bin-routing.ts:47` — `shouldDispatchRuntime` returns `false` for empty
  argv (`argv[0] === undefined`) and `true` for any first word absent from
  `H2A_NATIVE_VERBS`. `run` is in neither `H2A_CLI_VERB_CONTRACTS` nor
  `BIN_HARD_NATIVE_FIRST_WORDS` (`:15`), so `h2a run …` — including `h2a run --help` —
  crosses the lazy runtime boundary today.
- `packages/h2a/src/bin-routing.ts:56,80` — `H2A_RUNTIME_CLI_API_VERSION = 1`;
  `resolveH2aRuntimeDispatch` rejects a legacy `dispatch()`-only module and any version
  mismatch before runtime state operations.
- `packages/h2a/src/bin.ts:92,104` — missing optional runtime exits 127; incompatible
  runtime CLI API exits 64.
- `packages/h2a-runtime/src/index.ts:5177` — `.command("run <profile> [path]")`; exact
  `h2a run` therefore fails Commander's required-argument check.
- `packages/h2a-runtime/src/index.ts:1818` — `localCliCommand(profile)` returns
  `LOCAL_CLI[profile] ?? profile`: an unknown token is executed as an arbitrary command.
- `packages/h2a-runtime/src/profile-menu.ts:20` — `shouldShowProfileMenu(args, tty)` is
  `tty && args.length <= 2`: the historical direct-entry vendor picker.

## Decisions

- **D1 — A successor DEC supersedes DEC-034's no-argv rule and the runtime's
  required-profile `run` contract.** Both changes are labelled breaking, ship in
  coordinated majors of `@sentropic/h2a` and `@sentropic/h2a-runtime`, and require a bump
  of `H2A_RUNTIME_CLI_API_VERSION` so mixed package versions fail *before* launch instead
  of disagreeing about argv. The DEC body is drafted in Appendix A; its number is assigned
  at ratification (DEC-118 was the next free number on 2026-07-29).
- **D2 — One pure ordered argv classifier is the single authority** (§1). It is a pure
  function over `(argv, env, tty)` with no I/O, callable from both `cli.ts` and
  `bin-routing.ts`, and it classifies **before** runtime `main` migrates config.
- **D3 — Help is core-owned and side-effect-free.** `h2a help`, `h2a --help`, the `-h`
  compatibility alias and `h2a run --help` short-circuit in the core front: no optional
  runtime import, no config migration, no PATH probe, no network call, no engine probe, no
  session. `h2a run --help` crossing the lazy boundary today is a defect this contract
  closes, not a behavior it preserves.
- **D4 — `native` is the sole implicit runtime.** h2a never infers a vendor from
  configuration, workspace contents, PATH, prior use, a model or provider identifier, or an
  interactive picker. Every vendor profile and retained alias stays explicit. The historical
  direct-entry picker (`shouldShowProfileMenu`) is retired as an implicit selector,
  separately from the two empty forms.
- **D5 — Automation and TTY guards precede everything.** A nonempty `CI` refuses the two
  *implicit* native forms even under a pseudo-TTY; otherwise both `stdin.isTTY` and
  `stdout.isTTY` must be true for any interactive native form. A redirected `stderr` alone
  does not make an invocation noninteractive. Refusal writes one actionable diagnostic to
  stderr, nothing to stdout, exits 1, and never degrades into help — silently turning an
  automation failure into a success is the unsafe outcome. Explicit `h2a run native`
  remains allowed under `CI` when its interactive-TTY or headless grammar is satisfied.
- **D6 — Readiness is probed side-effect-free, and there is no fallback.** After the
  guards, the front validates the optional runtime and probes native availability. Missing
  package → 127; incompatible runtime CLI API → 64; compatible runtime with no usable
  native engine, failed authentication/placement or rejected admission → 2, with an
  actionable diagnostic, no session created, and no fallback to help, a vendor, an
  arbitrary executable or the picker.
- **D7 — The unknown-`run`-selector executable fallback is removed, and that removal is
  itself a ratified safety break.** `LOCAL_CLI[profile] ?? profile` today turns a typo into
  an arbitrary command execution. The successor rejects an unknown selector as a usage
  error. If custom adapters must survive, the successor DEC gives them an unambiguous
  explicit selector; a typo is never an adapter. This is never described as "preserved".
- **D8 — Migration is announced, time-boxed and measurable without new telemetry.**
  `H2A_LEGACY_EMPTY_DISPATCH=1` restores the previous per-invocation result before any
  import for exactly one major, then is removed. The change is announced in top-level help,
  in the exact-`run` missing-profile diagnostic, in release notes and in the upgrade guide
  for at least one release beforehand. No ambient telemetry is created; if an existing
  consented sink exists, only coarse invocation-class/TTY/guard/outcome counts are recorded
  — never argv values, prompt, cwd, model, profile, session id or content.
- **D9 — Both implicit forms flip atomically, and only last.** There is no intermediate
  release in which bare `h2a` has changed but exact `h2a run` has not, or the reverse.
  Additive explicit `h2a run native` must pass acceptance first (§5).

## 1. The ordered classifier

Evaluated in order, before any generic fallback. "None" in the last column means: no
optional runtime import, no config migration, no PATH/profile probing, no network call, no
engine probe, no session creation.

| # | Invocation / condition | Outcome | Exit | Pre-session side effects |
|---:|---|---|---:|---|
| 1 | `h2a help`, `h2a --help`; compatibility `h2a -h` | Top-level help | 0 | None |
| 2 | `h2a run --help`; compatibility `h2a run -h` | Run help, intercepted by the core front before the lazy runtime boundary | 0 | None |
| 3 | Existing non-run core/meta verb, including version | Existing core behavior | Existing contract | Existing contract |
| 4 | Recognized existing non-run heavy-runtime verb (`ls`, `attach`, `stop`, `resume`, `delegate`, `jobs`, `workspace`, `install`, …) | Existing lazy-runtime dispatch and command contract | Existing contract | Existing runtime behavior |
| 5 | `h2a run <known vendor / retained alias> …`, or a retained direct vendor alias | Existing PTY/vendor adapter; never native | Adapter/child result | Existing vendor behavior only |
| 6 | `h2a run native …` | Native grammar; interactive unless an explicit machine/headless form is given | §2 | Readiness probe before creation |
| 7 | Exact bare `h2a`, or exact `h2a run` | Same implicit native flow, subject to D5/D6/D8 guards | §2 | Guards, then readiness probe |
| 8 | `h2a run --<non-help-option>` or `h2a run --`, with no selector | Usage error; stderr only, no stdout | 1 | None |
| 9 | Unknown `run` selector | Usage error (D7); never executable, native, vendor or help fallback | 1 after a compatible lazy boundary; otherwise 64/127 | Runtime parser resolution only |
| 10 | Unknown top-level verb | Runtime parser usage error; never an executable/native/vendor fallback | 1 after a compatible lazy boundary; otherwise 64/127 | Runtime parser resolution only |

Row 4 preserves `shouldDispatchRuntime`'s deliberate non-core fallback rather than
introducing a drifting core allowlist: the optional runtime stays the authority that
recognizes its own non-run verbs. Rows 9 and 10 may therefore resolve/import the runtime
parser, but must not migrate config or launch anything.

Sub-precedence inside row 7: (1) `H2A_LEGACY_EMPTY_DISPATCH=1` — legacy result, before any
import; (2) `CI` / TTY guard (D5); (3) side-effect-free readiness probe (D6); (4) only then
one normalized native launch intent, shared byte-for-byte by all three spellings.

## 2. Exit taxonomy

| Exit | Meaning |
|---:|---|
| 0 | Help/version, clean native completion, explicit in-session quit |
| 1 | Usage/selector error, or interactive safety refusal (non-TTY / `CI`) |
| 2 | Native readiness, authentication/admission, engine state/protocol, policy or budget failure; structured output carries the exact reason |
| 3 | Local I/O or OS failure |
| 64 | Core/runtime CLI API incompatibility at the existing lazy boundary |
| 127 | Missing optional runtime package at the existing lazy boundary |
| 128 + signal | Signal termination (SIGINT = 130) |

Explicit vendor adapters keep returning their current adapter/child result and are **not**
normalized into this table (`packages/h2a-runtime/src/index.ts`, `runProfile`). Until the
engine supplies its stop-reason taxonomy (§5), "runtime failure = 2 plus a structured
reason" is the compatibility floor, and that floor must be replaced by a frozen
stop-reason-to-exit mapping before any implicit cutover.

## 3. Versioned boundary

The successor bumps `H2A_RUNTIME_CLI_API_VERSION` (currently `1`) and adds one
side-effect-free `native` availability result distinguishing four states:

| State | Exit | Distinguishing evidence |
|---|---:|---|
| optional runtime package missing | 127 | module resolution failure at `bin.ts:92` |
| runtime CLI API incompatible | 64 | `resolveH2aRuntimeDispatch` mismatch at `bin-routing.ts:80` |
| runtime present, native engine/admission unavailable | 2 | engine capability/readiness probe result |
| ready | — | normalized launch intent produced |

The probe is a capability question, not a session request: it performs no session creation,
no config migration and no credential mutation. Implementing the engine behind it is out of
scope for this EVOL.

## 4. Acceptance fixtures (specification, not yet written)

Golden parser/dispatch cases must cover, by name, the functions verified in §Grounding:
`cli.ts::runCli`, `bin.ts::dispatchRuntime`, `bin-routing.ts::shouldDispatchRuntime` and
`::resolveH2aRuntimeDispatch`, the runtime `main` / Commander `run <profile>` path, and
`profile-menu.ts::shouldShowProfileMenu`.

Positive:
1. Every row of §1 maps to its stated outcome and exit.
2. With an eligible TTY, bare `h2a`, exact `h2a run` and interactive `h2a run native`
   normalize to **one identical** launch intent.
3. `h2a help`, `h2a --help`, `h2a -h`, `h2a run --help`, `h2a run -h` exit 0 **and work
   when the optional runtime or the native engine is absent**.
4. Every recognized vendor/host-adapter route keeps its argv, PTY/adapter, output and exit
   behavior unchanged.

Negative (the load-bearing half):
5. No import, no config migration, no PATH probe, no network call, no engine probe and no
   session for: help rows, core-resolved selector-less syntax errors, and automation
   refusal.
6. Unknown delegated grammar (rows 9, 10) may resolve the runtime parser but performs no
   config migration and no launch.
7. Readiness failure and mixed package versions create no session.
8. `CI` set: both implicit forms refuse with exit 1, stderr only, empty stdout — under a
   pseudo-TTY as well.
9. `H2A_LEGACY_EMPTY_DISPATCH=1` reproduces the *current* per-invocation results
   byte-for-byte, and never launches an agent.
10. No configuration, workspace content, PATH entry, prior use, model, provider, picker or
    unknown token can select a vendor.

Each fixture must fail against today's code for the right reason before the successor is
written; a fixture that passes on `origin/main` @ 1906942 is testing nothing.

## 5. Realization gates — what this EVOL does NOT authorize

These are hard gates, not a checklist of good intentions. None of the following is
authorized before **all** of them hold:

- **G1 — cross-owner answers.** Sentropic has answered A1–A4 (architect: descriptor schema
  ownership, intent/projection vs narrow job-submit, the local-placement fork, acceptance of
  the capability-requirements framing) and Q1–Q5 (llm-mesh: session-creation API,
  capability inventory against R1–R15, model-intent passthrough + stable catalog read,
  identity/lease/budget accounting, local placement). Status on 2026-07-29: **open** —
  deposited 2026-07-18 to targets that were registered but not live; no answer is recorded
  anywhere in this repo. Re-sent 2026-07-29 to the reachable architect instance.
- **G2 — versioned seam.** §5.1 of the STUDY has versioned Create/Attach/Send/Stop schemas,
  capability/readiness and authentication/admission probes, the full
  auth/revision/idempotency/fencing/receipt envelope, and a **frozen stop-reason-to-exit
  mapping**.
- **G3 — intent coverage.** Every parity flag marked *(t)* in STUDY §7 maps to a named
  intent field the engine can honor, and `h2a run native --model <mesh-id>` reaches at
  least two providers through the gateway with a service-attested
  `ResolvedModelProjection`.
- **G4 — explicit before implicit.** Additive `h2a run native` passes interactive and
  explicit-headless acceptance before either implicit spelling changes.
- **G5 — announcement served.** At least one release has shipped the advance
  help/diagnostic/release-note notices, and the rollback path (`H2A_LEGACY_EMPTY_DISPATCH`)
  has a passing fixture.
- **G6 — owner UAT.** No item under this EVOL is declared done on a green suite. The owner
  must see bare `h2a` start a native session, and see an implicit form refuse under `CI`.

**Ownership caveat, unresolved.** The track report carries D5 — "Comment lancer le moteur
natif H2A ?" — with recommendation A: *h2a owns the loop and runs it locally; sentropic
stays a consumer*. That is the inverse of this contract's backbone constraint (the session
engine is sentropic's; h2a coordinates it), settled 2026-07-13 and reaffirmed 2026-07-18 as
E2(a). Nothing in §1–§4 depends on the answer — the classifier, guards, exits and fixtures
are h2a front-door semantics either way — but §5's engine gates do. The contradiction is
routed to the architect (2026-07-29) and must be resolved before G2.

## Adversarial review reconciliation

**Not yet run.** This EVOL has had zero review legs at the time of writing. Repository rule:
no merge without a test *and* two independent review legs, and the author is never one of
them. This section stays empty until two legs that did not write this document have
reported, and their findings are reconciled here — not summarized.

## Acceptance (of this EVOL, as paper)

- The successor DEC body (Appendix A) explicitly supersedes DEC-034's no-argv behavior and
  the runtime's required-profile `run` contract, names both as breaking, and requires
  coordinated majors plus a runtime CLI capability bump.
- §1 covers every invocation class reachable today, including the retained vendor routes,
  the `-h` aliases and the two empty forms.
- §2 preserves the already-observable loader codes 64 and 127 and adds no new public code
  beyond the STUDY's taxonomy.
- §4 names each fixture against an existing function, and states the fail-first rule.
- §5 states each realization gate with its current status, and G1 is honestly reported as
  open.

---

## Appendix A — successor DEC, ready to append at ratification

> **## DEC-NNN — Native dispatch successor contract (supersedes DEC-034's no-argv rule)**
>
> **Date**: TBD at ratification. **Refers**: DEC-034, WP13,
> `docs/specs/2026-07-18-STUDY_h2a-native-agent-and-session-engine.md`,
> `docs/specs/2026-07-29-SPEC_EVOL_native-dispatch-successor-contract.md`.
>
> **Decision**: bare, no-argv `h2a` and exact, zero-operand `h2a run` start the native
> interactive agent; `h2a run native` is the explicit equivalent and owns the
> option-bearing and headless native forms; `native` is the sole implicit runtime and every
> vendor profile or host adapter remains explicit; canonical help is `h2a help`,
> `h2a --help` and `h2a run --help`, all core-owned and side-effect-free.
>
> **Breaking**: yes, twice. Bare `h2a` prints help and exits 0 today
> (`packages/h2a/src/cli.ts:6722`); exact `h2a run` is rejected for a missing required
> `<profile>` today (`packages/h2a-runtime/src/index.ts:5177`). A third, separately
> ratified safety break removes the arbitrary unknown-token execution in
> `localCliCommand` (`:1818`). None of these may be described as preserving the frozen CLI
> contract.
>
> **Consequence**: coordinated major releases of `@sentropic/h2a` and
> `@sentropic/h2a-runtime`; `H2A_RUNTIME_CLI_API_VERSION` bumped from 1 so mixed versions
> fail before launch; `H2A_LEGACY_EMPTY_DISPATCH=1` restores the previous behavior for
> exactly one major and is then removed; the historical direct-entry vendor picker
> (`profile-menu.ts:20`) is retired as an implicit selector; both implicit forms flip in
> the same release or neither does.
>
> **Gate**: realization is blocked on the sentropic seam answers (EVOL §5, G1–G6). This DEC
> records the target contract; it does not authorize the cutover.
