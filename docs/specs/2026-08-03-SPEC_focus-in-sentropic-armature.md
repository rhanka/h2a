# SPEC — Focus in the sentropic armature

**Status — DESIGN-ONLY, 2026-08-03. No build was performed and no lane was launched.**

**DECISION 1, in one line — CANONICAL FOCUS:** sentropic `packages/focus` is canonical; h2a
`packages/focus/` MUST be deleted, not renamed or made private, and “the two coexist” is forbidden.
**ENFORCEMENT RUNG:** spec-line; `scripts/check-focus-package-identity.mjs` does not exist yet.
**NAMED PROOF:** that future rejector, absence of the h2a directory in `git ls-tree`, and npm metadata
naming sentropic as the publisher. **LIMIT:** this settles package identity only; it neither removes
`packages/focus-interactive` nor forbids a separately tracked compiled vendor snapshot. §2 carries the
governing rule and the full deletion seam.

**Scope.** The owner cannot use the remote Claude surface and chooses sentropic, the separate
`rhanka/sentropic` web application, as the principal tool. This document specifies how a Focus
decision dossier is reached inside one sentropic workspace and supplies the previously unspecified
armature. It does not implement that path.

## 1. Fresh measurements and authority

Measurements below were repeated while writing. h2a `origin/main` matched its remote at
`5757d35fb8147385f9572b987ffb594de10f08be`. The local sentropic `origin/main` was stale
(`c9e745b…` versus remote `fdee25c…`), so sentropic files were read from the remote `main` URL at
`fdee25c5f45c7c4d9aadfb6170833d451d87bbc7`, the merge commit of sentropic PR #502.

| Observed fact | Command run | Result and limit |
|---|---|---|
| fresh refs | `git rev-parse origin/main` and `git ls-remote origin refs/heads/main` in each repository | h2a local/remote matched; sentropic local/remote differed as stated above. This is a point-in-time ref observation. |
| h2a manifest occurrences | `grep -rl "@sentropic/focus" --include=package.json . --exclude-dir=node_modules --exclude-dir=.git`; `git show origin/main:apps/focus/package.json`; the same command for `packages/focus/package.json` and `packages/focus-interactive/package.json` | Three hits: `apps/focus/package.json`, `packages/focus/package.json`, `packages/focus-interactive/package.json`. This is a string search, not a dependency graph. |
| h2a manifest semantics | `git grep -n "@sentropic/focus" origin/main -- '**/package.json'` | Only `packages/focus/package.json` owns the exact package name. The other manifest hits are the names `@sentropic/focus-app` and `@sentropic/focus-interactive`; neither declares a dependency on `@sentropic/focus`. |
| compiled copy | `git ls-tree -r --name-only origin/main packages/track/src/focus-vendor` and `git show origin/main:packages/track/package.json` | `track` imports a committed compiled vendor tree by relative path; its manifest lists no Focus dependency. This proves presence, not parity with current sentropic source. |
| published package authority | `npm view @sentropic/focus@0.3.0 version repository gitHead --json` | Version `0.3.0`, repository `github.com/rhanka/sentropic`, directory `packages/focus`, `gitHead` `715f88721bb24b2326b31cd7ea03531855643af3`. npm metadata identifies the publisher source; it does not prove current source parity. |
| sentropic package | `curl -fsSL https://raw.githubusercontent.com/rhanka/sentropic/fdee25c5f45c7c4d9aadfb6170833d451d87bbc7/packages/focus/package.json` | Remote main also declares `@sentropic/focus@0.3.0` and the sentropic repository URL. Thus two different codebases on the measured refs carry the same exact npm name and version. |
| h2a absorption history | `git log origin/main --oneline --all --grep='absorb @sentropic/focus render-core into a2a-cli'` | The h2a copy was created by commits titled “absorb @sentropic/focus render-core into a2a-cli”. Commit-title evidence establishes intent, not present parity. |
| one agents contract | `curl -fsSL https://raw.githubusercontent.com/rhanka/sentropic/fdee25c5f45c7c4d9aadfb6170833d451d87bbc7/spec/SPEC_EVOL_AGENTS_SURFACE_FUSION.md` | PR #502's D6 slice-(a) says verbatim: “One agents surface, not two (nor five)” and defines one `AgentsFeedPort` plus the `AgentsEntry` union already located at `packages/chat-ui/src/state/agentsEntry.ts`. |
| `AgentsEntry` union state | `curl -fsSL https://raw.githubusercontent.com/rhanka/sentropic/fdee25c5f45c7c4d9aadfb6170833d451d87bbc7/packages/chat-ui/src/state/agentsEntry.ts` | The file is now 115 lines, not the previously reported 112. Its fields are `id`, `kind`, `title`, `status`, `parentId`, `workspaceId`, `workspaceLabel`, `lastActivityAt`, `lastViewedAt`, `connection`, `pendingPrompt`, `hostKind`; `agentRef` is absent. |
| dossier-format status | `gh pr view 170 --repo rhanka/h2a --json state,headRefName,baseRefName,files,mergeCommit`; `git cat-file -e origin/main:docs/focus/decision-dossier-format.md`; the same command for `docs/focus/2026-08-03-d6-agents-surface-decision-dossier.html` | PR #170 is OPEN from `docs/focus-decision-dossier-d6-example`; both named files are on the PR and absent from h2a `origin/main`. |

The 2026-08-01 measurement that the two repositories' eight non-test TypeScript sources were
byte-identical is carried as historical evidence only: aggregate SHA-256
`986c5d95d121512669e953d3fa407baf2512a7e56be74b2f2a07f32d1a786d4f`. It was **not**
re-measured today, so this specification makes no present-parity claim.

## 2. One npm identity and the whole deletion seam

**GOVERNING RULE:** ONE NPM NAME = ONE PUBLISHING REPOSITORY. An identifier that two repositories
can claim is not an identifier. **ENFORCEMENT RUNG:** spec-line; the rejecting script is absent.
**NAMED PROOF:** future `scripts/check-focus-package-identity.mjs`. **LIMIT:** this rejects ambiguous
package ownership, not separately identified source duplication.

The new measurement agrees with the earlier count of three manifest strings but corrects its
interpretation: only one is an exact-name owner, and neither of the other two is presently a Focus
dependency. The consumer and cleanup consequences are therefore:

| ID | Normative clause | Enforcement rung | Named proof observable by another person | Where the guarantee stops |
|---|---|---|---|---|
| D1.1 | Delete h2a `packages/focus/` and remove its root TypeScript-project, lockfile, build, vendor, drift-check, and release-fixture assumptions. | **spec-line**; no rejecting mechanism exists yet | Future h2a deletion diff plus output of `scripts/check-focus-package-identity.mjs`; both are absent today | Does not delete packages with different npm names. |
| D1.2 | h2a release tooling MUST reject any publishable manifest whose exact `name` is `@sentropic/focus`. | **spec-line**; the future rejector is `scripts/check-focus-package-identity.mjs` | Future `scripts/check-focus-package-identity.test.mjs` case `rejects exact-name h2a publisher` | Does not establish who may publish other `@sentropic/*` packages. |
| D1.3 | `apps/focus` has nothing to repoint today; if it later imports the renderer, it MUST resolve the sentropic-published npm package, never an h2a workspace path. | **spec-line** | `apps/focus/package.json` dependency plus lock resolution to the npm artifact | Does not decide whether the existing standalone h2a app remains as tooling; it cannot become a second sentropic agents list. |
| D1.4 | `packages/focus-interactive` remains a distinct private package with no Focus dependency; any later render-core coupling MUST resolve the sentropic-published npm package. | **spec-line** | Its manifest and lock resolution | Does not certify that interactive and render-core APIs are compatible. |
| D1.5 | `packages/track/src/focus-vendor/` MAY remain to avoid the `track → focus → track` runtime cycle, but its refresh input MUST become a pinned sentropic artifact and record upstream version, repository, `gitHead`, and content hash. | **spec-line** | Future `packages/track/src/focus-vendor/PROVENANCE.json` and rewritten `scripts/check-focus-vendor.mjs` output; neither proof exists today | Proves provenance and drift against one pin, not absence of duplicated bytes or fitness of that pin. |
| D1.6 | “The two coexist” MUST fail acceptance even if the h2a copy is renamed or marked private; deletion is the chosen mechanism. | **spec-line** | Future `scripts/check-focus-package-identity.mjs` inventories h2a render-core sources outside the declared vendor, with test case `rejects renamed private render-core copy`, plus absence of `packages/focus/` in `git ls-tree` | Applies to the render-core copy, not the separately named interactive package or a vendor carrying valid D1.5 provenance. |

Thus killing the h2a copy is not one directory deletion: current `package-lock.json`, root
`tsconfig.json`, `scripts/vendor-focus.mjs`, `scripts/focus-vendor-lib.mjs`, and
`scripts/check-focus-vendor.mjs` all encode it; `packages/h2a/test/release-script.test.js` also
contains lock-shape fixtures for its nested Track dependency. The vendor scripts call the h2a directory
“AUTHORITATIVE”; leaving that sentence or input unchanged would preserve the identity split after
the manifest disappeared.

This decision removes ambiguity of **identity**, not duplication. D1.5 records source vendoring as
separately named, pinned, observable debt.

## 3. Armature: one entry, one read port, one detail

The navigation and data flow is:

`AgentsFeedPort → AgentsEntry.dossierRef → DecisionDossierReadPort.read → FocusDossierDetail`

As a non-normative synopsis of D2.1–D2.4, an entry carrying `dossierRef` carries the dossier by
reference and `FocusDossierDetail` is its detail view. The ref is an opaque, workspace-scoped
document locator, not dossier bytes and not an agent,
conversation, or session identifier. `DecisionDossierReadPort` reads the document separately because
dossiers are documents, not agents. Its result carries `provenance.holder` and
`provenance.measuredAt`. `FocusDossierDetail` receives that result and renders it through canonical
`@sentropic/focus`; it owns no store.

| ID | Normative clause | Enforcement rung | Named proof observable by another person | Where the guarantee stops |
|---|---|---|---|---|
| D2.1 | A dossier MUST be reachable from an entry on the single sentropic agents surface; there is NO second list and NO second agents feed port. | **spec-line** | Future `packages/chat-ui/src/components/AgentsList.dossier.test.ts` proves reachability; future `scripts/check-agents-surface-singularity.mjs` rejects a second exported list or feed port | Does not require every entry to have a dossier or forbid non-agents navigation elsewhere. |
| D2.2 | The entry MUST carry only `dossierRef`; document bytes MUST come from a separate `DecisionDossierReadPort`. | **spec-line** | Future `packages/chat-ui/src/state/decisionDossierReadPort.ts` and its adapter fixture | Separates document reads from agent enumeration; it does not choose HTTP, local, or MCP transport. |
| D2.3 | `FocusDossierDetail` MUST be stateless and MUST persist nothing. | **spec-line** | Future `packages/chat-ui/src/components/FocusDossierDetail.svelte` and `FocusDossierDetail.persistence.test.ts` | Covers the renderer; read-port caches and the authoritative holder are outside it. |
| D2.4 | Every returned dossier MUST name its holder and measurement time. | **spec-line** | Future `packages/chat-ui/src/state/decisionDossierReadPort.test.ts` asserting non-empty `provenance.holder` and `provenance.measuredAt` | Establishes provenance, not freshness duration or holder availability. |
| D2.5 | Option (b), a different plane, is not chosen; it MAY be reconsidered only with evidence that a dossier cannot be represented as an entry detail. | **spec-line** | Future superseding `spec/SPEC_EVOL_FOCUS_PLANE.md` containing that evidence | Does not prejudge the result of such evidence. |
| D2.6 | **sentropic ships the LIB and MUST NOT enrol.** `@sentropic/chat-ui` publishes `AgentsFeedPort`, `AgentsEntry`, the list component, `DecisionDossierReadPort` and `FocusDossierDetail`; it renders and defines the ports, and it MUST NOT fetch, MUST NOT enrol an agent, and MUST hold no host state. | **spec-line** | Its published export surface contains no function writing to any host's identity, registry or presence; future `scripts/check-lib-does-not-enrol.mjs` rejects such an export. Today's corroboration, re-runnable: the existing port module at sentropic `fdee25c5` declares itself `Pure module: no stores, no browser API, no HTTP` | Constrains the LIB's surface, not what a host does with it, and not transport choice. |
| D2.7 | **Each host wires the INTEGRATION that enrols.** The feed *source* behind the port — h2a presence, the plugins host, the cowork connector — and the dossier read adapter are owned by the host, never by the LIB. A host either feeds the one port or is not on the surface. | **spec-line** | Each host's adapter module and its fixture; `scripts/check-agents-surface-singularity.mjs` (D2.1) rejects a parallel list | Assigns ownership of enrolment; it does not specify any host's adapter, nor guarantee that a host implements one. |
| D2.8 | h2a MUST consume the LIB as a **published version**, never a workspace path or a checkout link. | **spec-line** | The h2a manifest line and its lock resolving to the npm artifact | The local workspace may still resolve internally; the published manifest is what governs. |

A second list appearing without a decision is exactly the mechanism that produced three Focus
copies: sentropic source, h2a source, and h2a's compiled vendor. D1.5 classifies the vendor's
different role and required provenance explicitly.

## 4. Parallel fronts and their only shared coupling

Conversation restitution and Focus touch different objects. h2a
`packages/h2a-runtime/src/restore.ts` discovers and resumes conversation files held at the CLI host;
the measured study `docs/specs/2026-08-01-STUDY_terminal-substrate-tmux-vs-native.md` establishes that
the terminal is a VIEW, not the session. Focus reads and renders a document. Neither object requires
the other to be completed first.

The shared seam is the durable identity slot. D6 reserves `agentRef`, but the current published port
does not contain it — measured at sentropic merge commit `fdee25c5`: zero occurrences of `agentRef`,
positive control `hostKind` present.

**Correction, 2026-08-03, made before this document was reviewed.** An earlier draft of this section
stated that the reclaim key "contains precisely what changes between conversations", i.e. that reprise
never fires. **That is measured false and is withdrawn.** Sequential resume RECLAIMS: the same
`providerSessionId` returns the existing binding and the same identity (traced as `[mint, reclaim,
mint]` by WP5). A per-conversation identity is *intended*, not a defect — keying on `workspaceId`
instead once collapsed two concurrent conversations in one repository onto a single id and inbox.
The real defect is **narrower**: a concurrency race in which concurrent first-connects on the same key
each mint before the prior binding's proof is registered — reproduced with 12 synchronised workers
yielding 3 mints instead of 1, and matching a measured historical excess of 6 651 identities across
4 548 keys in one store while the live store shows zero. Owner of the fix: WP5, and it is a
concurrency guard, not a key rewrite.

**Consequence for this document, and it makes D3.3 stronger rather than weaker.** There is at present
**no durable cross-conversation anchor at all**: `agentUuid` was measured NOT stable across
conversations, so "documented perennial" was not "is perennial". Leaving the slot absent is therefore
not a temporary courtesy until a value arrives — it is the only honest state until a durable anchor is
built by someone.

**Where each fact above comes from, separated so nothing reads as more resolvable than it is.**

| Fact | Status | How a reader resolves it |
|---|---|---|
| `agentRef` absent from the published port | measured by this document | `curl -fsSL https://raw.githubusercontent.com/rhanka/sentropic/fdee25c5f45c7c4d9aadfb6170833d451d87bbc7/packages/chat-ui/src/state/agentsEntry.ts \| grep -c agentRef` → `0`; control `grep -c hostKind` → `1` |
| 4 548 keys minted more than once, 6 651 excess identities in one store, zero in the live store | measured by this document | Group `identity/bindings.jsonl` by `(host, providerSessionId)` in each store and count keys whose lines carry more than one distinct `instance`; run against `~/h2a-workspace/.h2a` and `~/src/a2a-cli`. Point-in-time: the first store grew during the measurement. |
| sequential resume reclaims — `[mint, reclaim, mint]` | **attribution to WP5**, not re-run here | Not resolvable from any repository artifact today; WP5 holds the trace |
| 12 synchronised workers yield 3 mints instead of 1 | **attribution to WP5**, not re-run here | Same — no artifact yet |
| `agentUuid` not stable across conversations | **attribution to WP5**, not re-run here | Same — no artifact yet |

The three attributed rows are the ones that overturned the earlier diagnosis, and they carry the weight
of this section. They are stated as WP5's because they are WP5's; until WP5 publishes them, a reader
cannot check them, and this document does not pretend otherwise. This specification does not specify
the anchor.

| ID | Normative clause | Enforcement rung | Named proof observable by another person | Where the guarantee stops |
|---|---|---|---|---|
| D3.1 | Conversation restitution and Focus-in-sentropic MUST advance in parallel. | **spec-line** | Future `.track/events.jsonl` realization records for the two items show overlapping active intervals before either completion | Does not permit either front to invent the shared identity semantics, and each front can still fail independently. |
| D3.2 | The `AgentsEntry` contract MUST reserve `agentRef` once as a provider-independent durable-identity slot before any feed source populates it. | **spec-line** | Future `packages/chat-ui/src/state/agentsEntry.ts` diff plus `git merge-base --is-ancestor <contract-commit> <each-adapter-population-commit>` | Reserves and orders a slot; it does not reclaim or mint the durable identity. |
| D3.3 | Both fronts MUST consume that reserved slot and MUST leave it absent when no durable identity is available. | **spec-line** | Future `packages/chat-ui/src/state/agentsEntryIdentity.test.ts` absent-identity adapter fixtures | An absent value does not make the entry itself undisplayable; existing entry `id` remains a view key. |
| D3.4 | Neither front may put a conversation id, session id, or `providerSessionId` into `agentRef`. | **spec-line** | Future `packages/chat-ui/src/state/agentsEntryIdentity.test.ts` rejection fixtures for all three ephemeral inputs; the test does not exist today | Rejects known ephemeral classes; it does not prove an arbitrary supplied value is durable. |
| D3.5 | Welding an ephemeral identifier into `agentRef` is the only cross-front failure mode of this parallelism. | **spec-line** | Future `scripts/check-focus-restore-decoupling.mjs` inventories imports, ports, stores, and identifiers and rejects any shared seam beyond `AgentsEntry.agentRef` | Covers coupling between the fronts; either front can still fail independently. |

D3.1–D3.4 make the ordering explicit: the durable slot's meaning and empty-state behavior precede
either adapter writing it, while both fronts proceed concurrently around that seam. If one front
welds an ephemeral id into the slot, the other inherits the weld; no other coupling was identified.

## 5. Decision-dossier format — was in flight, LANDED 2026-08-07

The owner-validated substance-first format comments each spec decision, states its risk, includes
each reviewer's real review and the open stakes, and requires no forced signature. Its artifacts are
`docs/focus/decision-dossier-format.md` and
`docs/focus/2026-08-03-d6-agents-surface-decision-dossier.html`.

**Status changed after this document was drafted, and re-measured before merge.** When §1 was written
they were in flight on branch `docs/focus-decision-dossier-d6-example` and absent from `origin/main`.
PR #170 **merged on 2026-08-07 at 15:43Z**, and both files are now on `origin/main` — re-measured with
`git cat-file -e origin/main:docs/focus/decision-dossier-format.md` and the same for the HTML, both
succeeding. The §1 row recording them as absent is a **dated observation that has since been
overtaken**, and is left standing there rather than rewritten, because §1 is a log of what was
measured while writing.

Consequence: the artifacts are now **stable and citable by path on `origin/main`**, so D4.1 below —
which required every citation to carry "in-flight", branch and PR number — is **discharged** by the
merge rather than satisfied by compliance. It is kept in the table with that state recorded, because
a clause that silently disappears leaves a reader unable to tell whether it was met or dropped.

| ID | Normative clause | Enforcement rung | Named proof observable by another person | Where the guarantee stops |
|---|---|---|---|---|
| D4.1 | ~~Until PR #170 merges, every citation to either format artifact MUST include “in-flight”, branch name, and PR number.~~ **DISCHARGED 2026-08-07 by the merge of #170**, not by compliance. Citations now resolve by path on `origin/main`. | **spec-line**, now moot | `git cat-file -e origin/main:docs/focus/decision-dossier-format.md` succeeds; `gh pr view 170` shows merged 2026-08-07T15:43Z | Recorded as discharged rather than deleted, so a reader can tell it was met and not dropped. |
| D4.2 | The armature MUST accept the dossier as a document from the read port and MUST NOT freeze the example's HTML as a transport or persistence contract. | **spec-line** | Future `packages/chat-ui/src/state/decisionDossierReadPort.test.ts` plus `rg` showing no example-HTML parser in adapters | Preserves format evolution; it does not guarantee backward compatibility after publication. **Now sharper, not weaker**: the example is on `main`, so freezing it is easier and the prohibition matters more. |

This qualification is load-bearing: this repository has repeatedly paid for citations to documents
a reader cannot resolve. PR metadata is the present resolver; a main-branch path is not.

## 6. What was not verified, and ownership

- Current cross-repository source parity was not verified. The 2026-08-01 hash belongs to that dated
  measurement; the Focus package custodians own a fresh pin/hash before the h2a deletion migration.
- No future proof artifact named in the enforcement tables exists yet, and no structural or test rung
  is claimed for it. The Focus-in-sentropic implementation lane owns those artifacts after launch.
- No build, runtime, browser, transport, persistence, or fixture behavior was exercised. The sentropic
  LIB owner owns component/read-port proof; each host integration owner owns its adapter proof.
- The owner's validation of PR #170's substance was accepted as an input, not independently replayed.
  The owner/conductor own ratification; PR #170's author owns keeping its in-flight citation resolvable.
- Durable identity recovery itself was not designed or verified here. The h2a identity owner owns that
  repair; this specification only protects the reserved slot from known ephemeral identifiers.

## 7. Open concerns

No objection to the endorsed decisions. The open implementation concern is honest enforcement: every
row currently stops at **spec-line**. Claiming structural or test enforcement before the named
rejectors and fixtures exist would turn this armature into an assertion rather than a proof.
