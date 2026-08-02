# EVOL — Native dispatch conformance contract

Date: 2026-07-29. Revision 3 (2026-08-02), after two independent adversarial review legs and
the WP6 acceptance criteria. Revision 3 retains all 23 revision-2 dispositions. Its change is
opposability: every retained requirement names evidence, level, and limit.

Rung: **EVOL — paper only.** It authorizes no dispatch code, engine work, package change, publish,
or cutover. Work package: WP13. Track item: 01KWVNYNHVJGA8CCW566PG4WMH.

Backbone: docs/specs/2026-07-18-STUDY_h2a-native-agent-and-session-engine.md §11 and
docs/specs/2026-07-13-SPEC_STUDY_native-agent-via-sentropic.md. Review legs:
docs/specs/reviews/2026-07-29-REVIEW-leg1-native-dispatch-evol.md and
docs/specs/reviews/2026-07-29-REVIEW-leg2-native-dispatch-evol.md.

## 0. Opposability protocol

The clause registers are this EVOL's only normative surface. Narrative, quotations, history, and
current-tree observations give context only. A later DEC can incorporate clause IDs but adds no
unregistered requirement.

| Field | Meaning |
|---|---|
| CLAUSE | One bounded requirement or explicit non-claim. |
| PROOF | Concrete artefact plus inspection/execution path. **not-yet-written** gives an exact future identifier that does not exist in this checkout. |
| ENFORCEMENT-LEVEL | Exactly one rung: structural > test > spec-line > habit. |
| LIMIT | Where the guarantee stops. No clause implies more than this field says. |

structural has a named mechanism that rejects a violation. test has a named test that fails on a
violation. spec-line is written without a rejecting mechanism. habit is practice only. The word
habit is deliberate, not a euphemism for a gate.

**What this document enforces, stated in aggregate so no reader has to total it themselves:
33 of its 35 registered clauses have NO mechanism that rejects a violation.** Exactly two are
`structural` — EXIT-02 and COMPAT-02 — and **no clause is `test`**: the one that claimed that rung
cited a test which rejects a different clause's violation, and was downgraded rather than
re-labelled. Twenty-eight are `spec-line` — written, with nothing that rejects — and five are
`habit`. Twenty-three clauses name a proof marked `not-yet-written`, and every one of those is
`spec-line`: no clause claims a strong rung on a proof that does not exist.

Read `spec-line` carefully rather than reassuringly. It is the rung that misleads most, because
`habit` announces itself while `spec-line` reads like a norm and holds no more. A reader who
counts twenty-seven specification lines and infers an enforced contract has misread this document,
and the fault would be the document's, not theirs.

| ID | CLAUSE | PROOF | ENFORCEMENT-LEVEL | LIMIT |
|---|---|---|---|---|
| EVOL-00 | This paper authorizes no executable dispatch, engine, package, release, or cutover action. | This header; inspect with git show -- docs/specs/2026-07-29-SPEC_EVOL_native-dispatch-successor-contract.md. | spec-line | It can expose a contradictory paper claim; it cannot reject a code commit. |

### 0.1 Current-tree evidence snapshot (re-verified 2026-08-02)

| Observation | Concrete evidence and reproduction |
|---|---|
| The live front authority is the ordered bin.ts chain; its final branch asks shouldDispatchRuntime(argv). | packages/h2a/src/bin.ts:110-284; inspect with nl -ba packages/h2a/src/bin.ts \| sed -n '110,284p'. |
| The lazy predicate is first-token fallback. | packages/h2a/src/bin-routing.ts:31-49. Existing test: packages/h2a/test/bin-routing.test.js, “parité: les verbes runtime (non-natifs) → dispatch runtime”; run npm run build:h2a && node --test packages/h2a/test/bin-routing.test.js. |
| Runtime main migrates configuration before profile-menu or Commander parsing. | packages/h2a-runtime/src/index.ts:2302-2318. |
| Ordinary run resolves LOCAL_CLI[profile] ?? profile, creates local tmux, and enrolls it. | packages/h2a-runtime/src/index.ts:1946-2003, 5344-5945; creation :5728-5747; enrollment :5855-5868. |
| Interactive wrapper changes an ended CLI pane into login shell. | packages/h2a-runtime/src/tmux.ts:92-102. |
| Legacy h2a resume [slug] has its own registry/slug failure handling; it is distinct from frozen top-level h2a --resume. | packages/h2a-runtime/src/index.ts:4948-5341. |
| CI invokes the public-contract script, whose checks are MCP names, CLI verb names, and core anti-cycle. No bare-h2a or --resume behavior check appears. | .github/workflows/ci.yml:60-64; scripts/check-public-contract.sh:12-38; audit with rg -n 'check-public-contract\|h2a-public-contract-v1\|--resume' .github scripts docs packages. |
| dispatchMode and dispatch_mode occur zero times in packages/*/src. Positive control: dispatch occurs 16 times in packages/h2a/src/cli.ts. | rg -n --glob '*.ts' --glob '*.js' 'dispatchMode\|dispatch_mode' packages/*/src; rg -n 'dispatch' packages/h2a/src/cli.ts \| wc -l. |
| Release machinery updates root metadata plus h2a, h2a-cli, h2a-runtime, and track; release CI compares each published package version with tag. | scripts/release.mjs:45-76; .github/workflows/release.yml:76-143. |

## 1. Position, frozen contract, and authority

The frozen public contract names bare interactive h2a, h2a --resume, and h2a run <cli> as grammar
(docs/contracts/h2a-public-contract-v1.md:3-4,19). Current empty argv still follows runCli help/
exit 0 (packages/h2a/src/cli.ts:6778-6779). This is a conformance gap. The frozen contract's
full-surface CI change-control promise has not fired.

| ID | CLAUSE | PROOF | ENFORCEMENT-LEVEL | LIMIT |
|---|---|---|---|---|
| FC-01 | Bare interactive h2a, h2a --resume, and h2a run <cli> remain frozen public grammar; successor path honors rather than silently amends them. | docs/contracts/h2a-public-contract-v1.md:19; classifier evidence in DISP-01 through DISP-04. | spec-line | Current implementation diverges; this is target, not present behavior. |
| FC-02 | Product amendment of a frozen surface remains owner-reserved (P4). | docs/contracts/h2a-public-contract-v1.md:3-4; docs/specs/evidence/2026-07-29-WP13-owner-decision.md (**not-yet-written**). | habit | Repository has no receipt validator before contract edit. |
| FC-03 | Full frozen-surface change control is labelled habit, not described as existing CI gate. | Contract :3-4; §0.1 audit; scripts/check-public-contract.sh:12-38. | habit | Existing script structurally rejects narrow MCP/verb/anti-cycle drift only. |
| AUTH-01 | P1 exact h2a run enters native, P2 h2a run native, and P3 unknown-selector rejection remain owner decisions before realization. | Owner-decision record in FC-02 (**not-yet-written**). | habit | Paper listing does not prevent implementation before record. |
| FC-04 | CI and H2A_LEGACY_EMPTY_DISPATCH are documented frozen-surface environment additions before they affect dispatch. | docs/contracts/h2a-public-contract-v1.md:8; docs/specs/evidence/2026-07-29-WP13-owner-decision.md (**not-yet-written**). | spec-line | No current contract-surface validator covers either variable. |

| Owner decision | Retained reason |
|---|---|
| P1 — exact zero-operand h2a run enters native | Frozen contract does not name it. |
| P2 — h2a run native is explicit spelling and option carrier | It adds reserved selector to frozen verb. |
| P3 — unknown run selector changes from executable fallback to rejection | Source trace reaches persisted state as well as argv. |
| P4 — honor or amend frozen contract | Contract reserves its evolution to owner. |

The 2026-07-17 co-conception study keeps S3 open: bare h2a and h2a --resume are preserved, while
run native is additive after a runtime × placement matrix
(docs/specs/2026-07-17-STUDY_h2a-cli-coconception.md:292-301,305-327). Phase 1 records
co-validation rather than treating it as superseded.

## 2. Dispatch classification and the new closed-mode schema

Stage A is core, pure, and no-I/O. It handles help, version, frozen implicit spellings, top-level
--resume, selector-less errors, and delegation. Stage B is a future versioned runtime parse-only
capability before runtime main. Current main migrates configuration before parsing (§0.1), so no
side-effect-free Stage-B capability exists today.

This closed schema is **new work**. The §0.1 measurement shows no dispatchMode or dispatch_mode
field in packages/*/src. There is no open schema to “close”: this is the first validator and its
unknown-mode case is the first rejection test, not a repair of an existing guard.

| DispatchMode value | Invocation class | Outcome | Exit | Allowed effects |
|---|---|---|---:|---|
| HELP | h2a help, --help, -h; h2a run --help or -h; h2a run native --help or -h | matching help | 0 | none |
| VERSION | h2a --version, -v, version | existing bin.ts route | existing | none |
| CORE | existing core/meta and Track-façade routes | existing route | existing | existing route only |
| RUNTIME | recognized non-run runtime verb | existing lazy route | existing | existing route only |
| RUN_VENDOR | h2a run <recognized vendor or retained alias> … | existing vendor route | existing | existing route only |
| NATIVE_EXPLICIT | h2a run native … | explicit native | §4 | readiness then lifecycle |
| NATIVE_IMPLICIT | exact bare h2a and, after P1, exact h2a run | native interactive | §4 | preguard, admission, lifecycle |
| NATIVE_RESUME | h2a --resume [<ref>] | native resume | §3 | preguard, admission, lifecycle |
| LEGACY_EMPTY | exact empty forms while legacy escape applies | frozen replacement legacy output | 0 or 1 | none |
| USAGE_REJECT | selector-less non-help run option; leading unmatched option/terminator; unmatched first token; unknown run selector; value outside DispatchMode | stderr-only refusal | 1 | no runtime main, migration, PATH probe, engine probe, tmux, or session |

Each DispatchMode row is data under DISP-03 and inherits its PROOF, ENFORCEMENT-LEVEL, and LIMIT.

| ID | CLAUSE | PROOF | ENFORCEMENT-LEVEL | LIMIT |
|---|---|---|---|---|
| DISP-01 | Stage A is exported pure classifier and reconciled with bin.ts rather than layered beside an unexamined authority. | packages/h2a/src/native-dispatch.ts::classifyNativeDispatch (**not-yet-written**); packages/h2a/test/native-dispatch-contract.test.js, “classifies every DispatchMode row without I/O” (**not-yet-written**); run npm run build:h2a && node --test packages/h2a/test/native-dispatch-contract.test.js. | spec-line | No export/test exists; paper does not choose bin.ts refactor versus fence. |
| DISP-02 | Stage B classifies delegated argv before runtime main migrates configuration. | packages/h2a-runtime/src/native-dispatch.ts::classifyNativeDispatch (**not-yet-written**); packages/h2a-runtime/src/native-dispatch.test.ts, “classifies unknown selector before migrateConfigHomeIfNeeded” (**not-yet-written**); run npx vitest run packages/h2a-runtime/src/native-dispatch.test.ts. | spec-line | Current runtime exports main only; new capability needs phase-1 seam work. |
| DISP-03 | DispatchMode is exhaustive. A value outside it is rejected, never inferred, defaulted, or executed. | packages/h2a/src/native-dispatch.ts::assertDispatchMode (**not-yet-written**); packages/h2a/test/native-dispatch-contract.test.js, “rejects an unknown DispatchMode before migration or session creation” (**not-yet-written**); command in DISP-01. | spec-line | Named rejection test is planned, not present; it proves new mechanism only after implementation. |
| DISP-04 | Top-level h2a --resume [<ref>] classifies as NATIVE_RESUME rather than unknown option. | packages/h2a/test/native-dispatch-contract.test.js, “classifies --resume and --resume <ref> as NATIVE_RESUME” (**not-yet-written**); command in DISP-01. | spec-line | Current first-token fallback routes --resume to runtime (packages/h2a/src/bin-routing.ts:31-49); resume semantics remain limited by ID-02. |
| DISP-05 | Help rows work before lazy boundary when optional runtime/native engine are unavailable. | packages/h2a/test/native-dispatch-contract.test.js, “core help rows do not load runtime” (**not-yet-written**); command in DISP-01. | spec-line | Existing binary lacks spies for import/migration absence. |
| DISP-06 | Selector-less run options and every unmatched token class produce USAGE_REJECT. | packages/h2a-runtime/src/native-dispatch.test.ts, “rejects selector-less run options and unmatched top-level argv” (**not-yet-written**); command in DISP-02. | spec-line | Runtime parser and native option grammar remain separate. |

Native option grammar remains unfrozen. Current run has headless, JSON, model, effort, background,
prompt-stdin, and gateway inputs (packages/h2a-runtime/src/index.ts:5344-5402). The exhaustive
promise is classification only, not a new native machine surface.

### 2.1 Current defect: failure indistinguishable from success

This names a **form only**. For a simple unknown run selector, source
trace supplies three success signals although no valid dispatch mode was recognized:

1. ordinary normal tmux detach returns exit 0 through attachLocalSession;
2. startLocalSession persists launch context and enrollFromRun records a session;
3. LOCAL_WRAPPER keeps the pane as interactive login shell after unknown executable exits.

Evidence: packages/h2a-runtime/src/index.ts:1946-2003, 5544-5569, 5610-5747, 5855-5868, 5940-5953;
packages/h2a-runtime/src/tmux.ts:92-102, 848-994, 1860-1871. This is source-trace verification,
not direct runtime invocation because main migrates configuration first. The signals do not
distinguish done, deposited/pending, and not-dispatched. Reports of the same form elsewhere are not
evidence in this EVOL.

| ID | CLAUSE | PROOF | ENFORCEMENT-LEVEL | LIMIT |
|---|---|---|---|---|
| DISP-07 | Successor replaces the failure-indistinguishable-from-success form for unknown run selector with USAGE_REJECT: exit 1, one stderr diagnostic, no stdout, tmux, launch context, or enrollment. | packages/h2a-runtime/src/native-dispatch.test.ts, “unknown run selector refuses without tmux session, launch context, or enrollment” (**not-yet-written**); command in DISP-02. | spec-line | Changes only unknown-selector behavior after P3; persisted entries are COMPAT-04. |

## 3. Admission, identity, launch, and resume

TTY and CI remain preguards: stdin and stdout TTY are required for implicit interaction; nonempty CI
refuses implicit form under pseudo-TTY. They decide environmental conditions only. Admission
discriminates this invocation by exact workspace binding: resolved workspace matches WorkspaceBinding
in SessionLaunchIntent and native capability accepts binding, policy, and quota.

The pair below is measurable: matching binding passes; different or absent binding refuses. It does
not claim to infer a human's intent inside an already-admitted workspace.

| ID | CLAUSE | PROOF | ENFORCEMENT-LEVEL | LIMIT |
|---|---|---|---|---|
| ADMIT-01 | Implicit native reaches readiness only after TTY and CI preguards pass; refusal is stderr-only, exit 1, no fallback. | packages/h2a/test/native-dispatch-contract.test.js, “implicit native refuses non-TTY and CI before readiness” (**not-yet-written**); command in DISP-01. | spec-line | Ambient checks do not establish workspace admission. |
| ADMIT-02 | Native launch admission requires exact resolved-workspace/WorkspaceBinding match plus capability policy/quota acceptance. | packages/h2a-runtime/src/native-admission.test.ts, “admits a ready native intent bound to its resolved workspace” (**not-yet-written**); run npx vitest run packages/h2a-runtime/src/native-admission.test.ts. | spec-line | Engine capability and binding store do not exist in this checkout. |
| ADMIT-03 | Ready-looking intent with different or absent WorkspaceBinding refuses before CreateSession. | packages/h2a-runtime/src/native-admission.test.ts, “rejects a ready native intent whose workspace binding is different or absent” (**not-yet-written**); command in ADMIT-02. | spec-line | Cannot distinguish mistaken intent inside correctly bound workspace. |

Existing seam proposal supplies SessionLaunchIntent correlation/binding and SessionProjection executionId/
receipt (docs/specs/2026-07-18-STUDY_h2a-native-agent-and-session-engine.md:511-540).

| Operation | Identifier at request | Reference after success | Failure return; created-session result |
|---|---|---|---|
| Native launch | caller correlationId and idempotency key/scope, WorkspaceBinding, descriptor revision | SessionProjection.executionId, revision, immutable receipt; attach/control only if advertised | Usage/preguard: 1, no intent/session. Runtime missing/incompatible: 127/64, no intent/session. Binding/policy/quota/readiness/engine: 2 with structured reason plus correlationId, no executionId. Local I/O: 3 with correlationId and no claimed executionId. Post-create attach failure: 3 with executionId/receipt retained. |
| Native resume with explicit <ref> | correlationId/idempotency key plus existing session or checkpoint ref, WorkspaceBinding, descriptor revision | successor SessionProjection.executionId, revision, immutable receipt; input ref is lineage, not PTY continuity | Usage/preguard: 1. Missing/foreign/expired/unauthorized ref or binding/policy/quota/readiness: 2 with reason/correlationId, no successor. Runtime: 127/64. I/O: 3. Post-create attach failure: 3 with successor retained. |
| Frozen h2a --resume without <ref> | **Known gap:** frozen contract supplies spelling, not a last-native resolver. | None claimed. | Classifier reaches NATIVE_RESUME; phase 1 supplies resolver or structured exit-2 native-resume-reference-unavailable. No session creation is claimed first. |

The identity table is the data of ID-01 through ID-03 and inherits their PROOF,
ENFORCEMENT-LEVEL, and LIMIT.

| ID | CLAUSE | PROOF | ENFORCEMENT-LEVEL | LIMIT |
|---|---|---|---|---|
| ID-01 | Native launch follows first identity row; executionId is authoritative and correlationId is caller linkage. | packages/h2a-runtime/src/native-session-contract.ts::createNativeSession (**not-yet-written**); packages/h2a-runtime/src/native-session-contract.test.ts, “CreateSession returns executionId, revision, and immutable receipt” (**not-yet-written**); run npx vitest run packages/h2a-runtime/src/native-session-contract.test.ts. | spec-line | Seam types are proposed; no native engine returns them now. |
| ID-02 | Explicit native resume follows second row; successful resume returns successor projection, not implicit PTY continuity. | packages/h2a-runtime/src/native-session-contract.ts::resumeNativeSession (**not-yet-written**); packages/h2a-runtime/src/native-session-contract.test.ts, “Resume returns successor projection for session and checkpoint references” (**not-yet-written**); command in ID-01. | spec-line | Zero-argument spelling has documented gap pending phase 1. |
| ID-03 | Unresolved zero-argument h2a --resume creates and attaches no native session merely because preguards passed. | packages/h2a/test/native-dispatch-contract.test.js, “resume without resolvable native reference refuses before CreateSession” (**not-yet-written**); command in DISP-01. | spec-line | Leaves open last-native record, chooser, or owner-approved alternative. |

## 4. Exits and compatibility

| Exit | Meaning |
|---:|---|
| 0 | help/version, clean native completion, explicit quit, or legacy bare result |
| 1 | usage/schema error or implicit safety refusal |
| 2 | readiness, authentication, admission, engine-state, policy, budget, or native-reference failure with structured reason |
| 3 | local I/O or OS failure |
| 64 | runtime API incompatibility at lazy boundary |
| 127 | broad module-not-found bucket at lazy boundary |
| 128 + signal | signal termination |

Each exit row is data under EXIT-01 and inherits its PROOF, ENFORCEMENT-LEVEL, and LIMIT.

127 remains broad: bin.ts checks ERR_MODULE_NOT_FOUND, covering missing optional runtime and possible
transitive evaluation failure (packages/h2a/src/bin.ts:77-105).

| ID | CLAUSE | PROOF | ENFORCEMENT-LEVEL | LIMIT |
|---|---|---|---|---|
| EXIT-01 | Exit table is successor native taxonomy; exit alone does not assert cause more specific than its row. | packages/h2a/test/native-dispatch-contract.test.js, “maps successor failure classes to published exits” (**not-yet-written**); command in DISP-01. | spec-line | Vendor-child behavior remains outside normalized native taxonomy. |
| EXIT-02 | API incompatibility rejects before runtime dispatch through current capability resolver. | packages/h2a/src/bin-routing.ts:65-85; packages/h2a/test/bin-routing.test.js, “runtime dispatch: rejects an incompatible capability version”; command in §0.1. | structural | Covers current runtime dispatch, not native parser/readiness. |
| COMPAT-01 | Vendor compatibility is per route: interactive run attach, detached/headless/structured run, direct local PTY, direct remote. | packages/h2a-runtime/src/native-dispatch.test.ts, “characterizes run vendor interactive attach”, “characterizes run vendor structured launch”, “characterizes direct vendor local PTY”, “characterizes direct vendor remote” (**all not-yet-written**); command in DISP-02. | spec-line | Characterizes retained routes; does not freeze native options. |
| COMPAT-02 | Lockstep release set includes h2a, h2a-cli, h2a-runtime, and track; successor major has collateral track impact. | scripts/release.mjs:45-76; .github/workflows/release.yml, `Version sanity gate (tag vs package.json)`:70-107, whose named h2a/cli/runtime/track mismatch branches exit 1; inspect nl -ba scripts/release.mjs \| sed -n '45,76p'. | structural | Proves current tooling, not approval for independent versioning. |
| COMPAT-03 | Runtime capability bump breaks every heavy runtime verb in mixed install; H2A_LEGACY_EMPTY_DISPATCH covers two empty forms only and is not rollback for that break. | packages/h2a/src/bin-routing.ts:55-85; packages/h2a/package.json:58-64; incompatibility test in EXIT-02. | spec-line | No complete heavy-surface mixed-version strategy exists here. |
| COMPAT-04 | P3 covers argv and persisted entries whose saved tool is unknown; migration/refusal shares owner decision. | packages/h2a-runtime/src/index.ts:1961-1963 and :5122-5159; packages/h2a-runtime/src/native-dispatch.test.ts, “refuses legacy persisted unknown selector with named diagnostic” (**not-yet-written**). | spec-line | No adoption measurement or new telemetry is authorized. |
| COMPAT-05 | Profile picker is not live shipped-bin implicit selector. | packages/h2a-runtime/src/profile-menu.ts:20-25; packages/h2a/src/bin.ts:281-284; predicate test packages/h2a-runtime/src/profile-menu.test.ts, profile menu / “only appears for bare interactive remote invocations”; run npx vitest run packages/h2a-runtime/src/profile-menu.test.ts. | spec-line | Predicate test does not exercise the full published-bin route; claim is limited to that route. |
| COMPAT-06 | During first successor major only, H2A_LEGACY_EMPTY_DISPATCH gives exact bare h2a help/0 and exact h2a run frozen stderr-only/1 output before runtime import, migration, or native launch; it is removed in next major. | packages/h2a/test/native-dispatch-contract.test.js, “legacy empty dispatch uses frozen output without runtime effects” (**not-yet-written**); command in DISP-01. | spec-line | Exact run output is replacement output, not a byte-for-byte Commander reproduction; lever covers neither heavy verbs nor mixed installs. |

## 5. Fixtures, observable seams, and change control

Realization exposes one injectable front seam, packages/h2a/src/native-dispatch.ts::
dispatchNativeSuccessor (**not-yet-written**), with import counter, migration spy, Stage-B classifier,
admission probe, and session factory. That seam observes no import, no migration, no session, and
normalized launch intent. Current private dispatchRuntime closes over process argv and cannot do so.
The source basis for that limit is packages/h2a/src/bin.ts:30,77-105.

| Fixture set | Exact case identifier | Baseline |
|---|---|---|
| Base characterization | packages/h2a-runtime/src/native-dispatch.test.ts, “unknown selector currently creates, enrolls, and leaves login shell” (**not-yet-written**) | passes on source-harness baseline; records three-signal defect |
| Base characterization | packages/h2a-runtime/src/native-dispatch.test.ts, four COMPAT-01 cases (**not-yet-written**) | passes before and after successor work |
| Base characterization | packages/h2a/test/bin-routing.test.js, “runtime dispatch: rejects an incompatible capability version” | exists and passes today |
| Successor delta | packages/h2a/test/native-dispatch-contract.test.js, “implicit spellings normalize to one NativeLaunchIntent” (**not-yet-written**) | fails before successor implementation |
| Successor delta | packages/h2a/test/native-dispatch-contract.test.js, “rejects an unknown DispatchMode before migration or session creation” (**not-yet-written**) | fails before schema/rejection mechanism |
| Successor delta | packages/h2a-runtime/src/native-dispatch.test.ts, “unknown run selector refuses without tmux session, launch context, or enrollment” (**not-yet-written**) | fails before P3 implementation |
| Successor delta | packages/h2a/test/native-dispatch-contract.test.js, “implicit native refuses non-TTY and CI before readiness” (**not-yet-written**) | fails before implicit implementation |
| Successor delta | packages/h2a-runtime/src/native-admission.test.ts, ADMIT-02 and ADMIT-03 cases (**not-yet-written**) | fails before admission capability |

The fixture rows are data under TEST-01 and TEST-02 and inherit their PROOF, ENFORCEMENT-LEVEL,
and LIMIT.

| ID | CLAUSE | PROOF | ENFORCEMENT-LEVEL | LIMIT |
|---|---|---|---|---|
| TEST-01 | Every successor-delta condition names observable dependencies and test case failing for stated violation. | Fixture register; dispatchNativeSuccessor (**not-yet-written**). | spec-line | Names protect nothing until seam/tests exist. |
| TEST-02 | Base-characterization fixtures do not use universal fail-first rule. | Fixture register only. No test rejects a violation of THIS clause: `packages/h2a/test/bin-routing.test.js:77` was previously cited here, but it asserts that `resolveH2aRuntimeDispatch` rejects an incompatible capability version — that is a violation of EXIT-02, not of TEST-02. A fixture-shape test (**not-yet-written**) would be needed. | spec-line | Nothing rejects a characterization fixture written with a fail-first assertion; a reviewer must catch it by reading. |
| CC-01 | Full frozen-surface change control remains explicitly habit until a gate watches bare h2a, h2a --resume, h2a run, and declared contract version together. | FC-03; current scripts/check-public-contract.sh is only named existing script. | habit | Written downgrade makes no false current-CI claim. |

## 6. Phased authorization

| Phase | Entry evidence | Paper authorization after entry |
|---|---|---|
| 0 — paper | this EVOL plus both review legs | none |
| 1 — seam | P1–P4 owner record; sentropic A1–A4 / Q1–Q5 and S3 co-validation; Stage-B capability and stop-reason mapping | specify Stage B |
| 2 — explicit route | phase-1 record; DISP-01/02/03, ADMIT-02/03, ID-01 evidence | additive h2a run native, retained behavior unchanged |
| 3 — compatibility | phase-2 evidence; COMPAT-01; release-set/heavy-verb strategy record | announcement-only release |
| 4 — candidate | phase-3 release id; legacy-empty/mixed-version evidence | candidate behind legacy behavior |
| 5 — cutover | dated owner observation on candidate for admitted bare launch/non-TTY refusal | atomically flip NATIVE_IMPLICIT and publish |

Each phase row is data under PHASE-01 through PHASE-03 and inherits their PROOF,
ENFORCEMENT-LEVEL, and LIMIT.

| ID | CLAUSE | PROOF | ENFORCEMENT-LEVEL | LIMIT |
|---|---|---|---|---|
| PHASE-01 | Phase entry is conjunction of named evidence, immutable ref, command/result, and owner/date where applicable. | docs/specs/evidence/2026-07-29-WP13-native-dispatch-phase-1-seam.json, phase-2-explicit-route.json, phase-3-compatibility.json, phase-4-candidate.json, phase-5-owner-uat.md, and 2026-07-29-WP13-native-dispatch-evidence.schema.json (**all not-yet-written**). | spec-line | No evidence evaluator exists now. |
| PHASE-02 | No phase authorizes later-phase work. | Phase table and EVOL-00. | spec-line | Paper cannot reject out-of-order implementation. |
| PHASE-03 | Phase 5 needs dated owner receipt of candidate bare launch and non-TTY refusal; green suite alone is insufficient. | docs/specs/evidence/2026-07-29-WP13-native-dispatch-phase-5-owner-uat.md (**not-yet-written**). | habit | Human observation/signature is not mechanically reproducible. |

Phase 1 is open. A1–A4 / Q1–Q5 correspondence is acknowledged but unrendered; S3 remains the
cross-owner fork. This status authorizes no phase-2 work.

## 7. Revision-2 reconciliation retained

| Review finding(s) | Retained disposition |
|---|---|
| L1-C1, L2-M6 | two-stage contract; bin.ts present authority; no-migration awaits Stage B |
| L1-C2, L2-B4, L2-m1 | --resume, leading options/terminator, option-like tokens, Track derivation, unfrozen native options |
| L1-C3, L2-M5 | byte-for-byte exact-run legacy claim withdrawn; replacement output environment-independent |
| L1-C4, L1-C8 | phased authorization/evidence tuples replace self-blocking prose gates |
| L1-C5 | base characterization split from delta; observable seam named |
| L1-C6 | vendor compatibility per route, not runProfile |
| L1-C7 | 127 broad module-not-found bucket |
| L2-B1, L2-B2 | actual lockstep set and uncovered heavy-verb mixed-install break explicit |
| L2-B3 | frozen contract re-frames work as conformance and exposes failed change control |
| L2-M1 | S3 phase-1 co-validation input |
| L2-M2 | bare h2a safer; TTY/CI preguards plus admission discriminator |
| L2-M3, L2-M4 | unknown selector persisted state and three-signal baseline |
| L2-M7 | picker unreachable through shipped h2a bin |
| L2-M8 | identity/reference/failure tables expose zero-ref resume gap |
| L2-m2, L2-m3 | diagnostic language/environment surface remain owner/version evidence items |

Both review legs declined direct shipped-CLI run because shell hook and real configuration mutation
made it unsafe. This revision uses source-trace baseline and names end-to-end tests; it does not
convert that limit into a success claim.

## 8. Paper acceptance

| ID | CLAUSE | PROOF | ENFORCEMENT-LEVEL | LIMIT |
|---|---|---|---|---|
| ACCEPT-01 | Paper acceptance requires registers for retained normative claims, LIMIT for every guarantee, and concrete closed-schema/admission rejection identifiers. | Review with rg -n 'ENFORCEMENT-LEVEL\|PROOF\|LIMIT\|unknown DispatchMode\|workspace binding' docs/specs/2026-07-29-SPEC_EVOL_native-dispatch-successor-contract.md. | spec-line | Self-check is not independent ratification and authorizes no realization. |
| ACCEPT-02 | All 23 review findings remain reconciled; formatting rework silently reopens or rejects none. | §7 and both review files. | spec-line | Records document consistency only; later independent review remains separate. |

### Appendix A — DEC ratification map

The successor DEC refers to FC-01 through FC-04 for frozen-contract posture; DISP-01 through DISP-07
for dispatch; ADMIT-01 through ADMIT-03 and ID-01 through ID-03 for admission/session semantics;
EXIT-01 through COMPAT-06 for compatibility; TEST-01 through CC-01 for evidence/change control; and
PHASE-01 through PHASE-03 for authorization. This appendix adds no requirement and authorizes no code.
