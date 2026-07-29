# Review leg 1 — native dispatch successor EVOL

- Target: `docs/specs/2026-07-29-SPEC_EVOL_native-dispatch-successor-contract.md`
- Target commit: `3b3fe85e6f2010cfae6b2b104dd5d154783b81af`
- Base: `origin/main` at `190694264b5fb5307b090a05753f77868569595f`
- Role: first independent adversarial leg; not the author and not the builder
- Verdict: **BLOCK — the paper contract is not yet ratifiable**
- Severity count: **4 blocking, 4 major, 0 minor**

## CONFIRMED

### C1 — [blocking] The “single pure classifier” cannot distinguish rows 4 and 10, and the no-migration runtime-parser path does not exist

- **Location:** EVOL D2, lines 54–56; classifier rows 4, 9 and 10, lines 107 and 112–118; fixture scope, lines 160–163 and 175–179. Code: `packages/h2a/src/bin.ts:79–107,298–301`, `packages/h2a/src/bin-routing.ts:47–49`, `packages/h2a-runtime/src/index.ts:2134–2149,9341`.
- **Claimed:** one pure function over `(argv, env, tty)` is the single authority; the optional runtime nevertheless remains the authority that distinguishes a recognized heavy-runtime verb (row 4) from an unknown top-level verb (row 10); rows 9 and 10 may import/resolve the parser but must not migrate config.
- **What the code and logic show:** `(argv, env, tty)` contains no runtime command registry, so a pure core classifier cannot distinguish row 4 from row 10 without reintroducing the core allowlist the EVOL rejects. Today `shouldDispatchRuntime` can only return one boolean from the first token. `bin.ts` then either calls the private async `dispatchRuntime()` or the synchronous `runCli()`. `dispatchRuntime()` imports the runtime and calls `main(process.argv)`; `main()` calls `migrateConfigHomeIfNeeded()` before Commander recognizes any command. There is no exported parse-only/runtime-classification capability. Core-owned help and a D5 refusal could be made reachable by adding a new `bin.ts` decision branch, but D6 readiness/launch and the rows 9/10 no-migration guarantee cannot fire through the named interfaces. As written, the ordering guarantee manufactures assurance.
- **Smallest correction:** specify a two-stage contract rather than one impossible authority: a pure core classifier for core/help/implicit/run-selector classes, plus a versioned, side-effect-free runtime `classifyArgv`/parse-only result for delegated tokens, invoked before runtime migration. Name the async `bin.ts` orchestration seam and state whether `runCli` remains synchronous. Alternatively provide a generated runtime verb manifest, explicitly accepting that this is an allowlist and defining its anti-drift gate.

### C2 — [blocking] The advertised complete grammar leaves reachable argv classes and the native machine grammar undefined

- **Location:** EVOL D5, lines 67–73; classifier rows 1–10, lines 96–113; paper acceptance, lines 239–240; Appendix A, lines 257–261. Code: `packages/h2a/src/bin-routing.ts:47–49`, `packages/h2a/src/cli.ts:474–490,6482–6523`, `packages/h2a-runtime/src/index.ts:5177–5247`.
- **Claimed:** §1 covers every invocation class reachable today and orders help, existing core/runtime behavior, vendor behavior, explicit native behavior and errors deterministically.
- **What the code and logic show:** row 6 says only `h2a run native …` and “explicit machine/headless form”; it never freezes the accepted options, operands, mutual exclusions, or stdin/stdout contract. The backbone mentions `-p`, while the existing `run` parser exposes `--prompt-stdin`, `--headless`, `--background`, `--json`, `--model`, `--effort` and gateway flags. Therefore `h2a run native --headless`, `h2a run native --json`, and `h2a run native -p x` have no determined result. `h2a run native -h` matches row 6, while today's Commander treats `-h` after the selector as run help; row 2 names only selector-less `h2a run -h`. First-token option/terminator forms such as `h2a --root /tmp status`, `h2a -- run`, and combined `h2a -hv` are not “unknown top-level verbs,” so row 10 does not unambiguously cover them. A direct probe of the checkout's `shouldDispatchRuntime` sent all three to the runtime. Finally, Track façade verbs (`report`, `item`, `focus`, etc.) and exact `focus serve|web` have distinct in-process/spawn/`bin.ts` routes but are only implicitly swept into “core/meta” row 3.
- **Smallest correction:** add an exact token grammar (or exhaustive matrix) for native interactive/headless forms, help at every retained position, leading options, `--`, combined shorts, trailing operands, and Track/bin-special routes. Make the catch-all say “any unmatched first token, including option-like tokens and `--`” if that is intended. Do not claim completeness until every matrix cell has one outcome.

### C3 — [blocking] The legacy escape hatch cannot be both pre-import and byte-for-byte equivalent to today's `h2a run`

- **Location:** EVOL D8, lines 85–91; row-7 sub-precedence, lines 120–122; fixture 9, lines 183–184; Appendix A, lines 270–274. Code: `packages/h2a/src/bin.ts:79–107`, `packages/h2a-runtime/src/index.ts:2134–2143,5177`.
- **Claimed:** `H2A_LEGACY_EMPTY_DISPATCH=1` restores the current per-invocation result byte-for-byte before any runtime import, and never launches an agent.
- **What the code and logic show:** today's exact `h2a run` result is not a core constant. With no optional runtime it is the core loader's 127 diagnostic; with an incompatible runtime it is the 64 diagnostic; with a compatible runtime, `main()` may first emit a config-migration message and only then Commander emits the missing-`profile` error. A pre-import branch cannot know which of those current results to reproduce, and reproducing the compatible-runtime path byte-for-byte would include the migration side effect that “before any import” forbids. Bare `h2a` does not have this contradiction, but the fixture covers both forms.
- **Smallest correction:** choose one contract. Either define a frozen, environment-independent legacy output for exact `run` (and stop calling it byte-for-byte current behavior), or allow the legacy branch to traverse the current loader/runtime path and drop the pre-import/no-migration claim. In either case add runtime-absent, runtime-incompatible, migration-pending and compatible-runtime cells to fixture 9.

### C4 — [blocking] G4–G6 are prerequisites that require the forbidden realization to have already happened

- **Location:** EVOL paper boundary, lines 4–6; §5 preamble, lines 191–195; G4–G6, lines 211–217; D9, lines 92–94.
- **Claimed:** no dispatch code, native engine work, package change, publish or cutover is authorized until all G1–G6 hold; the gates are hard and checkable.
- **What the logic shows:** G4 can hold only after additive `h2a run native` has been implemented and tested. G5 can hold only after help/diagnostic/package documentation changes have shipped in a release. G6 requires the owner to see bare `h2a` start a native session, which requires the implicit behavior to exist in a build. Those are precisely code/package/release actions that the preamble forbids until G4–G6 already hold. The staged sequence in backbone STUDY §8/§10 is lost, making this EVOL self-blocking rather than safely gated.
- **Smallest correction:** split authorization into phases: seam/engine prerequisites; authorization to implement and test the explicit route; authorization for an announcement-only release; authorization to build a cutover candidate; owner UAT receipt on that candidate; and authorization to publish/cut over. State exactly which earlier gates unlock each phase.

### C5 — [major] The fixture set is not falsifiable under its universal fail-first rule

- **Location:** EVOL §4, lines 158–189, especially fixtures 3, 4, 7 and 9 and the rule at lines 188–189. Existing proof: `packages/h2a/test/bin-routing.test.js:53–87`.
- **Claimed:** every fixture must fail on `origin/main` at `1906942` for the right reason, and each is attached to the existing named functions.
- **What concrete tests would assert:**
  1. **Fixture 3:** for the five help spellings, assert exit 0, exact help stdout, empty stderr, and zero loader/migration/PATH/network/engine/session calls with the runtime absent. `runCli` can cover the top-level forms, but it cannot observe the lazy import; `bin.ts::dispatchRuntime` is private, captures module-scope `argv`, and writes to process globals. A subprocess can characterize the binary, but an import-count/no-import assertion against the named functions needs a new exported or injected front dispatcher.
  2. **Fixture 7:** pass a fake runtime with `H2A_RUNTIME_CLI_API_VERSION + 1` to `resolveH2aRuntimeDispatch`, assert it throws and that the fake dispatcher/session factory was not called. That test already exists and passes today (`bin-routing.test.js:77–87`), so it violates the universal fail-first rule. The readiness half cannot be written yet because no readiness capability exists.
  3. **Fixture 9:** set `H2A_LEGACY_EMPTY_DISPATCH=1`, run bare and exact `run`, compare exit/stdout/stderr with today's golden baseline, and assert no launch. Today the variable is ignored while today's defaults are already the legacy results, so this test can pass without proving that the escape hatch was read. It becomes meaningful only when paired with the env-off successor outcome and an observable pre-import branch.

  Fixture 4 is also a characterization invariant (“unchanged vendor behavior”) and therefore should pass on the base, not fail. Fixture 10's universal “no configuration/workspace/PATH/prior use/model/provider/picker/unknown token” statement is not a finite fixture until each source and a launch spy are named.
- **Smallest correction:** separate **base characterization** fixtures (pass before and after) from **successor delta** fixtures (fail first), split composite fixtures into atomic cases, and name the observable seam/spies for import, migration, readiness and session creation. Retain the three concrete assertions above as the minimum test design.

### C6 — [major] The vendor compatibility/exit claim cites the wrong path for `h2a run <vendor>`

- **Location:** EVOL row 5, lines 108–109; exit note, lines 136–140; fixture 4, lines 171–172. Code: `packages/h2a-runtime/src/index.ts:594–730,2302–2409,5177–5715`.
- **Claimed:** explicit vendor adapters retain their current adapter/child result, supported by `runProfile`, and every recognized vendor/host-adapter route preserves argv, PTY/adapter, output and exit behavior.
- **What the code shows:** `runProfile` is used by the direct profile commands (`h2a claude`, `h2a codex`, etc.) and only its local PTY branch assigns `result.exit.exitCode`. The `h2a run <profile>` path is a different Commander action at line 5177; it starts a tmux session and, by default, assigns `attachLocalSession(only.name)` to `process.exitCode` at line 5712. Its detached and structured branches have still other exit/output behavior. The cited function is therefore narrower than row 5 and does not prove the compatibility claim.
- **Smallest correction:** split the compatibility contract and golden fixtures by route: `run <vendor>` interactive attach, detached/headless/structured run, direct vendor command local PTY, and direct vendor command remote. Cite each actual action and freeze its current argv/output/exit semantics separately.

### C7 — [major] Exit 127 does not distinguish a missing optional runtime package

- **Location:** EVOL grounding, lines 37–38; §3 availability table, lines 147–152. Code: `packages/h2a/src/bin.ts:82–94`.
- **Claimed:** “optional runtime package missing” is a distinguishable state evidenced by module-resolution failure and exit 127.
- **What the code shows:** the catch tests only `err.code === "ERR_MODULE_NOT_FOUND"`. The same code is produced when `@sentropic/h2a-runtime` resolves but one of its transitive imports is missing during module evaluation. That case is also reported as “install the runtime” and exits 127. The cited code proves a broad module-not-found bucket, not the specific state named in the table.
- **Smallest correction:** specify direct-specifier discrimination (and the treatment of transitive evaluation failures), then add separate fixtures for “runtime package absent” and “runtime present, transitive dependency/evaluation failure.” Do not label the current error code alone as distinguishing evidence.

### C8 — [major] The gates are called hard, but their evidence predicates are not frozen

- **Location:** EVOL §5, lines 193–217; paper acceptance, lines 243–245.
- **Claimed:** G1–G6 are hard, checkable gates with current status.
- **What the document shows:** G1 does not name the repository artefact in which each A/Q answer must land; G2 says schemas and a mapping are “versioned” and “frozen” without naming schema ids/files/versions or the approval receipt; G3 does not name the attestation evidence; G4 says acceptance “passes” without a command or result artefact; G5 lacks the qualifying release id; G6 is an observation by the owner with no required dated/signable receipt. These can be judged by convention, but the document presents them as structural gates. Nothing here prevents a prose assertion from satisfying them.
- **Smallest correction:** give each gate a required evidence tuple (artefact path or release id, immutable ref/hash, verification command/result where applicable, owner, and dated acceptance/signature). Make the overall gate a deterministic conjunction over those receipts; keep owner UAT as a signed candidate-build receipt, not an undocumented recollection.

## Code-grounding audit

Every citation explicitly required by the brief was re-read in this checkout:

- `packages/h2a/src/cli.ts:6722` and the DEC-034 comment at `:6728`: **confirmed**.
- `packages/h2a/src/bin-routing.ts:47`, `:56`, `:80`: **confirmed**.
- `packages/h2a/src/bin.ts:92`, `:104`: **confirmed**, with C7's specificity qualification.
- `packages/h2a-runtime/src/index.ts:1818`, `:5177`: **confirmed**.
- `packages/h2a-runtime/src/profile-menu.ts:20`: **confirmed**.

The brief's ordering concern is also confirmed: `run` is absent from `H2A_NATIVE_VERBS`; `bin.ts:298–301` chooses runtime dispatch before `runCli`; and runtime `main()` migrates config at `index.ts:2139` before profile-menu handling or Commander parsing.

## SUSPECTED

None. No unverified concern is promoted to a finding.

## Verification obtained and limitations

- `node --test packages/h2a/test/bin-routing.test.js`: **11 passed, 0 failed**.
- `/home/antoinefa/src/h2a/node_modules/.bin/vitest run packages/h2a-runtime/src/profile-menu.test.ts`: **3 passed, 0 failed**.
- Direct current-checkout probes of `shouldDispatchRuntime` confirmed that `run`, `run --help`, leading `--root`, leading `--`, `-hv`, and `run native -h` all cross the current first-word runtime boundary; Track façade `report` does not.
- `npm run build:h2a` did **not** complete. It emitted the core dist and then failed in the runtime because the installed dependency state lacks `@hono/node-ws`, and the installed `@sentropic/llm-gateway` does not export `describeCanonicalTargetRoutes` (with two resulting implicit-`any` errors). No full-build verdict is claimed.
- An attempted end-to-end `bin.js` runtime probe was discarded: Node resolved `@sentropic/h2a-runtime` to the sibling main checkout at commit `996d9cc`, whose `index.ts` bytes differ from this target checkout. No result from that probe is used above.
- The EVOL target file was not modified.
