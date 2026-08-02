# REVIEW leg 2 — EVOL native dispatch successor contract

Date: 2026-07-29
Target: `docs/specs/2026-07-29-SPEC_EVOL_native-dispatch-successor-contract.md` (278 lines)
Reviewed at: `3b3fe85e` (worktree `wp13-evol-leg2`), based on `origin/main` @ `19069426`
Lens: **decision-worthiness, operator reality, absent subjects, independent citation re-verification.**
Deliberately NOT a completeness/internal-consistency audit (leg 1's lens).
Author of the EVOL: not me. I did not write it and am not its builder.

## Independence

`docs/specs/reviews/` did not exist in this worktree; no first-leg findings were present and I did
not search for them. Everything below is my own reading.

## Measurement environment — what I ran, and what I could not

- `npm ci` (exit 0) then `npm run build` (exit 0) in **this** worktree. Package versions in-tree:
  `@sentropic/h2a` 0.88.0, `@sentropic/h2a-runtime` 0.88.0 — equal to the globally installed pair,
  so no stale-install skew.
- Pure functions exercised against the freshly built `dist/`: `shouldDispatchRuntime`,
  `H2A_NATIVE_VERBS`, `shouldShowProfileMenu`. Commander's missing-argument behaviour measured
  against **`packages/h2a-runtime/node_modules/commander` 15.0.0** — the manifest declares
  `^15.0.0`; the root-hoisted `commander` is 4.1.1 (sucrase's transitive dep). A first measurement
  against the hoisted 4.1.1 was discarded. `npm ls commander --all` is the config that decides.
- **I could not run the `h2a` CLI itself.** A session hook refuses `h2a` invocations from a shell
  ("Use the H2A MCP tools/skill"), which is also this review's mandate. Every statement about
  end-to-end CLI behaviour below is therefore derived from the built modules and the source, and is
  marked as such.
- **I deliberately did not call `h2a-runtime`'s `main()`**: its first statement is
  `migrateConfigHomeIfNeeded()` (`packages/h2a-runtime/src/index.ts:2139`), which `cpSync`-copies
  the real config home (`config.ts:334`). Executing it to observe an exit code would mutate the
  user's environment.

Nothing below is reported as a verdict I did not obtain.

---

## Findings

### BLOCKING

#### B1 — The lockstep release set is four published packages, not two. CONFIRMED

**Location**: D1 (line 50-53); Appendix A "Consequence" (line 270-272).
**Claimed**: "ship in coordinated majors of `@sentropic/h2a` and `@sentropic/h2a-runtime`".
**Found**: the repo's release tooling cannot produce that pair. `scripts/release.mjs:46-53` bumps
**five manifests** to one version — root (private), `packages/h2a`, `packages/h2a-cli`,
`packages/h2a-runtime`, `packages/track` — and rewrites their inter-package `^X.Y.Z` ranges.
`.github/workflows/release.yml:84-97` **hard-fails the release** if
`packages/h2a-cli/package.json`'s version differs from the tag, and `:127-143` publishes four
packages: `@sentropic/track`, `@sentropic/h2a`, `@sentropic/h2a-cli`, `@sentropic/h2a-runtime`.
`.github/workflows/smoke.yml:59-76` packs and `npm i -g`s all four in one transaction.
So a successor major forces a major on **`@sentropic/track`** — a record-only system of record with
its own consumers and its own contract surface — and on **`@sentropic/h2a-cli`**, which
(`packages/h2a-cli/package.json:44-46`) still declares `"bin": {"h2a": "dist/bin.js"}` and
`"@sentropic/h2a": "^0.88.0"`, a caret range that does not admit the successor major.
**Smallest correction**: in D1 and Appendix A, name the lockstep set as it exists
(`scripts/release.mjs:46-53`), and state explicitly that `@sentropic/track` takes a collateral major
— or that the release tooling must be changed first, which is itself a gated realization.

#### B2 — The announced rollback lever does not cover the largest breakage the release ships. CONFIRMED

**Location**: D1 (line 50-53); D8 (line 85-88); G5 (line 213-215); §3 (line 143-151).
**Claimed**: bumping `H2A_RUNTIME_CLI_API_VERSION` makes "mixed package versions fail *before*
launch instead of disagreeing about argv", and `H2A_LEGACY_EMPTY_DISPATCH=1` "restores the previous
per-invocation result … for exactly one major", with G5 requiring "the rollback path … has a passing
fixture".
**Found**: three measured facts the document does not connect.
1. `packages/h2a/package.json:57-63` declares `"peerDependencies": {"@sentropic/h2a-runtime": "*"}`
   with `peerDependenciesMeta.optional: true`. A wildcard optional peer means **npm will never
   prevent, warn about, or repair a mismatched pair**. The version check is the only guard.
2. The guard is not scoped to the new native forms. `bin-routing.ts:80` is on the path of *every*
   heavy-runtime verb (measured: `ls`, `attach`, `stop`, `resume`, `delegate`, `jobs`, `workspace`,
   `install` all return `shouldDispatchRuntime === true`). Bumping the version from `1` therefore
   turns **every pre-existing runtime install** into exit 64 for the entire heavy surface — not only
   for `h2a run`.
3. `H2A_LEGACY_EMPTY_DISPATCH=1` acts on the two empty forms only. It cannot restore boundary
   compatibility. An operator who upgrades `@sentropic/h2a` alone loses `ls`/`attach`/`stop` and the
   documented lever fixes nothing; the only real rollback is `npm i -g` of the previous version of
   the whole set (B1).
**Failure the operator meets** (mixed install, old runtime + new core): a French diagnostic,
`h2a ls: runtime incompatible — runtime CLI API 1 is incompatible; expected 2. Mets à jour ensemble:
…` (`bin.ts:99-104`), exit 64. That failure *is* legible — the message names the fix. What is not
legible is that the advertised escape hatch is irrelevant to it.
**Smallest correction**: state in D1/D8 that the API bump breaks the whole heavy surface for mixed
installs, that npm gives no protection (wildcard optional peer), and that
`H2A_LEGACY_EMPTY_DISPATCH` is not a rollback for it. Add the downgrade path to G5.

#### B3 — The frozen public contract is never cited, and it already enacts the successor behaviour. CONFIRMED

**Location**: Intent (line 13-19); §Grounding; Appendix A "Breaking" (line 263-268); Acceptance
(line 236-238).
**Claimed**: the target "contradicts two published behaviors"; the supersession list is DEC-034's
no-argv rule plus the runtime's required-profile `run` contract.
**Found**: `docs/contracts/h2a-public-contract-v1.md` — headed *"CONTRAT GELÉ v1"*, and stating
"Toute évolution de ce contrat = **décision irréversible-produit** (réservée à Fabien). Tout diff sur
ces surfaces doit échouer la CI sans bump de version explicite" (`:3-4`) — declares at `:19`:
> Grammaire actée : … lancement `h2a run <cli> [--options]` ; **agent natif `h2a` (bare, interactif)** ; `h2a --resume`.

That frozen contract already promises bare `h2a` = native interactive agent. This cuts both ways and
the EVOL uses neither edge:
- It is the **strongest argument for** the change, which the document does not make: the code is what
  diverged from an enacted contract, so the flip is partly a reconciliation, not only a break.
- It is an **unmet obligation**: the contract's own change-control rule (irreversible-product
  decision, CI failure without an explicit bump) applies to this EVOL's subject, and the document
  neither cites it nor routes it. Its §3 also names *three* packages, reinforcing B1.
**Smallest correction**: cite `docs/contracts/h2a-public-contract-v1.md:19` in §Grounding; add to the
Acceptance list that the successor DEC reconciles the code with that frozen contract and satisfies
its change-control rule; state which contract documents must change in the same release
(`docs/cli-contract.md`, `docs/cli-help-grouping-vocabulary.md:231`, `README.md`).
*(Pre-existing rot noted in passing, not this EVOL's defect: that contract's `:16` points the machine
contract at `packages/h2a-cli/src/cli-contract.ts`, which does not exist — it is now
`packages/h2a/src/cli-contract.ts`.)*

#### B4 — `h2a --resume` is a frozen-contract invocation class with no row in §1 and no fixture in §4. CONFIRMED

**Location**: §1 table (line 102-113); Acceptance (line 239-240: "§1 covers every invocation class
reachable today").
**Claimed**: §1 covers every reachable invocation class, "including the retained vendor routes, the
`-h` aliases and the two empty forms".
**Found**: `h2a --resume` is named in the frozen public contract (`:19`, quoted in B3) and in the
2026-07-17 study's S3 (see M1). §1 has no row for it. Measured against the built module:
`shouldDispatchRuntime(["--resume"]) === true`, likewise `["--resume","abc"]`, `["-r"]`, `["--json"]`,
`["-"]`, `["--"]`. So today every leading option other than `--help`/`-h` crosses the lazy runtime
boundary and lands in Commander as an unknown option. Under §1 they fall in row 10, "Unknown
top-level verb" — which classifies a *contractual* spelling as unknown. The EVOL's own acceptance
criterion is therefore not met by §1 as written.
**Smallest correction**: add a row for leading-option argv (at minimum `--resume`/`-r`) that states
its successor outcome, and one §4 fixture. If resume is out of scope, say so explicitly and record
that the frozen contract's `h2a --resume` remains unimplemented — do not let it fall into "unknown
verb" silently.

### MAJOR

#### M1 — S3 of the 2026-07-17 study is an open cross-owner fork on exactly this question, and is neither cited nor superseded. CONFIRMED

**Location**: Intent (line 13, "The owner settled a breaking target on 2026-07-18"); §Backbone (line
7-8); G1 (line 195-202).
**Found**: `docs/specs/2026-07-17-STUDY_h2a-cli-coconception.md` — dated the day before the cited
settlement — carries under **"Decisions still open — sentropic co-validation required"**:
> **S3 | Native-agent spelling** … Recommendation: *Preserve the frozen bare interactive native path
> and `--resume`. `h2a run native` may be an additive, explicit runtime spelling **only after a matrix
> maps runtime × placement and all old argv/output behavior**.*

and in its own "Independent review reconciliation" (`:348`, bullet at `:352`):
> **CLI/public-contract review:** accepted the need to **preserve bare `h2a` and `h2a --resume`** …

Its ownership seam table (`:231`) further records `h2a run native` as "an additive proposed entry
point, subject to **co-validation** and **compatibility with bare `h2a`**" — i.e. a seam commitment
toward sentropic, not an h2a-internal choice. The EVOL's backbone cites only the 2026-07-18 STUDY and
the 2026-07-13 SPEC_STUDY; G1's open list is A1–A4 / Q1–Q5 and does not include S1–S6, of which S3 is
this EVOL's subject. The owner may of course overrule a study recommendation — but a document whose
Acceptance section enumerates what it supersedes must enumerate this one, and G1 must not report the
open cross-owner set as smaller than it is.
**Smallest correction**: cite the 2026-07-17 study; add S3 to what the successor DEC supersedes;
either add S3 to G1's open list or record that the owner closed it on 2026-07-18 and that the
"runtime × placement matrix" precondition is waived, with that waiver visible.

#### M2 — Today's bare `h2a` is strictly safer than the successor's, and the guards do not address the case that changes. CONFIRMED (behavioural claims from source)

**Location**: D5 (line 68-73); D6 (line 75-79); §1 row 7.
**Claimed**: two changes make the CLI safer — no unknown-token fallback, and refusal of implicit
native under `CI`/non-TTY.
**Found**: D5/D6 guard **automation**, and there they do genuinely convert a silent hang into a loud
exit 1 — a real gain, because an interactive agent started by a CI job would otherwise block and
burn budget. But the invocation whose risk actually changes is the **interactive human's**. Today
bare `h2a` is the most inert command in the product: core-only, `renderCliHelp()`, exit 0, no
optional-runtime import, no config migration, no filesystem write (`cli.ts:6722-6725`; measured
`shouldDispatchRuntime([]) === false`). The successor turns the most reflexive token a user can type
— and the thing a shell leaves behind after an interrupted command — into a session creation
carrying the authority of whatever `$PWD` happens to be. The document specifies **no** admission
check for that: no confirmation of the workspace, no allowlist, no "about to start an agent in
`<cwd>`" line. By contrast the explicit vendor path it replaces does check
(it refuses when a session for the derived slug already exists). So the implicit
form is specified with *less* admission checking than the explicit form it is modelled on.
(The refusal is at `index.ts:5372-5382`.)
Secondary, measured: `CI` has **no precedent anywhere** in this codebase (`grep` for
`process.env.CI` across `packages/*/src`, tests excluded: zero hits), and it is the weaker of the two
guards — cron and systemd set no `CI` at all, so the non-TTY half is load-bearing. Presenting `CI`
first overstates it.
**Smallest correction**: add a decision on workspace admission for the *implicit* forms (confirm,
or require an initialized root, or refuse outside a bound workspace), and reorder D5 so the TTY
requirement is stated as the primary guard and `CI` as the belt.

#### M3 — D7's removal reaches persisted state, not only argv — and its blast radius is unmeasurable under D8. CONFIRMED

**Location**: D7 (line 80-84); §Grounding citation 6; D8 (line 85-91).
**Claimed**: "`LOCAL_CLI[profile] ?? profile` today turns a typo into an arbitrary command
execution… The successor rejects an unknown selector as a usage error… a typo is never an adapter."
**Found**: the framing is argv-only, but `localCliCommand` has **two** call sites
(`index.ts:4981` and `:5430`), and the first is the **resume** path, where the profile comes from the
persisted session registry (`const profile = entry.tool`, `:4962`), not from argv. Removing the
fallback therefore also breaks resuming sessions **already recorded** by earlier versions whose
`tool` is not a `LOCAL_CLI` key. That is a data-migration question, not a usage-error question, and
D7 does not mention it.
Second: D8 forbids new telemetry, and there is no existing consented sink recorded here. So the
number of *working* (not typo) uses of the fallback — every PATH binary is a de-facto adapter today;
e.g. `bash` is not a `LOCAL_CLI` key (`:1804-1816`, only `shell: "/bin/bash"`), so `h2a run bash`
works today and becomes a usage error — is unmeasurable by the document's own constraint, while D8
claims migration is "measurable without new telemetry".
**Smallest correction**: extend D7 to state what happens to persisted registry entries whose `tool`
is not a known selector (migrate, or refuse with a named diagnostic), and drop the "measurable"
claim for D7 or name the measurement.

#### M4 — §1 row 9's fail-first baseline is wrong: an unknown selector today **succeeds**. CONFIRMED (from source)

**Location**: §1 row 9 (line 112); §4 line 189 ("Each fixture must fail against today's code for the
right reason").
**Claimed**: today an unknown token "is executed as an arbitrary command"; the successor makes it a
usage error, exit 1.
**Found**: the current outcome is larger than "executes a command", and a fixture written against the
document's description would assert the wrong baseline. Traced end to end for
`h2a run <unknown> <path>`: no profile validation exists on that path (`resolveProfile`, the one
function that rejects unknown names — `profiles.ts:61-69` — is not called there);
`localStartArgs` returns `[]` for any unknown profile (`index.ts:1850-1861`, `default: return []`);
`startLocalSession` then creates the tmux session (`tmux.ts:762-800`), registers the pane, sets
`@profile`, persists launch context and installs the status surface (`:806-817`). h2a itself
**exits 0**. And `LOCAL_WRAPPER` (`tmux.ts:95-99`) ends with
`if [ -t 0 ]; then exec /bin/bash -l; fi` — so when the bogus command fails, the pane **drops to an
interactive login shell**, leaving a *registered, live-looking h2a session that is a bare shell*.
(The structured path deliberately does not do this — `STRUCTURED_LOCAL_WRAPPER`, `:107-108`, with the
comment at `:102-106` saying why.) Precision the other way: execution is `"$cli" "$@"` with the token
as a positional parameter under `bash -lc`, so it is a **PATH-resolved executable, not shell
metacharacter injection** — "arbitrary command execution" is right in substance, not a shell-injection
claim.
**Smallest correction**: restate row 9's "today" as *exit 0, tmux session created and registered,
pane falls back to a login shell*, so the fail-first fixture asserts that; and qualify D7's wording
as PATH-resolved execution.

#### M5 — Fixture 9 and row 7's sub-precedence cannot both hold for the `h2a run` half. CONFIRMED

**Location**: §1 sub-precedence (line 120-122: legacy "before any import"); §4 negative fixture 9
(line 183-184: "reproduces the *current* per-invocation results byte-for-byte").
**Found**: for bare `h2a` the legacy result is core-produced, so "before any import" is satisfiable.
For exact `h2a run` it is not. The current result is produced **by the runtime**: `main()` runs
`migrateConfigHomeIfNeeded()` first (`index.ts:2138-2144`), which can `cpSync` the config home
recursively (`config.ts:328-334`) and write `[h2a] config home <reason>` to stderr; only then does
Commander reject the missing argument. Measured against the runtime's own Commander 15.0.0:
`error: missing required argument 'profile'` on stderr, exit 1. So the legacy path must either import
the runtime (violating "before any import") or not reproduce the current result byte-for-byte
(violating fixture 9). Separately, "byte-for-byte" pins an h2a fixture to a third-party library's
error string — a Commander bump rewords it and the fixture fails for no h2a reason.
**Smallest correction**: scope fixture 9 to *exit code + stdout emptiness + a stable stderr
substring*, and say which half of the legacy behaviour is reproduced in-core versus delegated.

#### M6 — D2's "single authority" omits the classifier that actually decides today. CONFIRMED

**Location**: D2 (line 55-57); §1 rows 3 and 4.
**Claimed**: "One pure ordered argv classifier is the single authority … callable from both `cli.ts`
and `bin-routing.ts`."
**Found**: neither of those files is today's dispatch authority. `packages/h2a/src/bin.ts` is a
top-level ordered `if`/`else if` chain — 17 `else if` branches between `:112` and `:298` — that
classifies on `argv[0]`, on `argv[1]` (`remote serve`, `drive serve`, `loop supervise`, …) **and on
flag presence** (`status` with `--bar|--human|--watch|--tmux-window`, `:256-264`), and it owns
`--version`/`-v`/`version` (`:112`) before `bin-routing` is ever consulted — measured:
`shouldDispatchRuntime(["--version"]) === true`, so §1 row 3's "including version" is true only
because `bin.ts` intercepts first. §1 rows 3 and 4 compress that chain into two lines. A classifier
that is genuinely the single authority has to absorb or subordinate it, which is a larger change
than D2 describes.
**Smallest correction**: name `bin.ts`'s ordered chain in D2 as the third existing site, and say
whether the new classifier replaces it or is called from it.

#### M7 — Citation 7 / D4: the picker is unreachable through the shipped binary. CONFIRMED (measured)

**Location**: §Grounding citation 7 (line 43-44); D4 (line 64-66); §4 line 163.
**Claimed**: `shouldShowProfileMenu(args, tty)` is "the historical direct-entry vendor picker", and
D4 retires it "as an implicit selector".
**Found**: the predicate is quoted correctly (`profile-menu.ts:20-25`), but it cannot fire through
`h2a`. `@sentropic/h2a-runtime` publishes **no `bin`**; the only `h2a` binaries are
`packages/h2a/package.json:44-46` and the `h2a-cli` shim, which side-imports the same file
(`packages/h2a-cli/src/bin.ts:3`). The runtime is reached only via `bin.ts:298`
`shouldDispatchRuntime(argv)` with `argv = process.argv.slice(2)` (`:32`), which requires
`argv[0] !== undefined`, i.e. `process.argv.length >= 3`; `main()` then passes the full
`process.argv` to `shouldShowProfileMenu`, which requires `length <= 2`. **Mutually exclusive.**
Measured on the built modules:

| argv | `shouldDispatchRuntime` | `shouldShowProfileMenu(["node","h2a",…], tty=true)` |
|---|---|---|
| `[]` | false | **true** |
| `["run"]` | true | false |
| `["run","native"]` | true | false |
| `["ls"]` | true | false |

The only argv that satisfies the picker is the only argv that never reaches it. So the picker is
dead code behind the `h2a` front (live only for a caller importing `main()` directly — in-tree, only
tests do). Framing it as a live implicit selector overstates a present risk, and D4's retirement is
dead-code removal, not the closing of an open door. That matters because D4 spends its safety weight
there.
**Smallest correction**: state in citation 7 that the predicate is unreachable through the published
`h2a` bin and name the mutual exclusivity; keep the retirement, describing it as removal of an
unreachable selector.

#### M8 — Two missing subjects: the identity of the session the implicit form creates, and resuming it. CONFIRMED (absence verified by search)

**Location**: whole document; nearest anchors §1 row 7, §2, §4 fixture 2.
**Found**: the EVOL specifies, precisely, *how dispatch reaches* a native launch, and then stops.
It never says what the created session **is**. Absent throughout (grepped): any mention of the
session's name or slug, of collision when the same implicit form is run twice in one directory, of
whether it appears in `h2a ls`, of `attach`/`stop`, of presence/heartbeat, of reaping. This is not
missing detail — the explicit path it replaces derives the slug from `slugify(label ?? cwd)`
(`index.ts:5461`, `tmux.ts:731`) and refuses a pre-existing one, and bare `h2a` carries no `--name`,
so two bare `h2a` in one workspace collide by construction under the same rule. A successor contract
that makes the *bare command* create sessions has to state the identity rule for them; §2 assigns
exit codes to a session whose registry status is unspecified. The second absence is its pair:
**resume/continuation** (B4) — the frozen contract names `h2a --resume` alongside bare native, and
the EVOL specifies starting without specifying continuing.
**Smallest correction**: add a short §on the implicit form's session identity — name derivation,
collision rule, `ls`/`attach`/`stop` visibility — or state explicitly that it is deferred to the
engine answers and add it to §5's gates.

### MINOR

#### m1 — Citation 2 derives its conclusion from two of three sources. CONFIRMED

**Location**: §Grounding citation 2 (line 30-33).
**Claimed**: "`run` is in neither `H2A_CLI_VERB_CONTRACTS` nor `BIN_HARD_NATIVE_FIRST_WORDS`
(`:15`), so `h2a run …` … crosses the lazy runtime boundary today."
**Found**: the conclusion is right — measured `H2A_NATIVE_VERBS.has("run") === false`,
`shouldDispatchRuntime(["run"]) === true` — but `H2A_NATIVE_VERBS` is built from **three** sources
plus the help aliases (`bin-routing.ts:31-40`): the two named ones **and `TRACK_FACADE_VERBS`**. The
stated derivation is narrower than the code, so a reader cannot re-verify it as written.
**Smallest correction**: add `TRACK_FACADE_VERBS` to the enumeration.

#### m2 — The mandated diagnostics are specified in English; the existing ones are French. CONFIRMED

**Location**: D5 (line 71-72), D6 (line 76-78), D8 (line 87-90).
**Found**: the loader diagnostics this contract extends are French — `bin.ts:89-90`
("ce verbe requiert le runtime h2a … Installe-le"), `:101-102` ("runtime incompatible — … Mets à
jour ensemble"). D8 requires the migration announcement to appear "in the exact-`run` missing-profile
diagnostic", i.e. inside that French surface, and D5/D6 require "one actionable diagnostic" without
saying in which language. Fixtures asserting diagnostic text need this settled.
**Smallest correction**: one sentence stating the diagnostic language for the new and amended
messages.

#### m3 — New environment surface is not recorded against the frozen contract. CONFIRMED

**Location**: D5 (`CI`), D8 (`H2A_LEGACY_EMPTY_DISPATCH`).
**Found**: `docs/contracts/h2a-public-contract-v1.md:8` records the environment surface as
`H2A_ROOT` (+ `--root`). This EVOL adds two env inputs that change dispatch outcome, one of them
(`CI`) not authored by this project and with zero existing use in `packages/*/src`. Neither is listed
as a contract-surface addition.
**Smallest correction**: list both in the Acceptance section as additions to the documented env
surface.

---

## What I checked and found sound

Recorded so the short finding list is accounted for, not assumed.

**Citations.** Re-read all seven independently, at `3b3fe85e`, without relying on the document.
Line numbers and quoted content are accurate for citations **1** (`cli.ts:6722` is the
`!command || --help || -h || help` branch returning 0; `:6728` does name DEC-034's no-argv-is-help
rule), **3** (`bin-routing.ts:56` `= 1`; `:80` the version-mismatch throw, with the legacy
`dispatch()`-only rejection at `:75-76`), **4** (`bin.ts:92` `return 127`, `:104` `return 64`),
**5** (`index.ts:5177` `.command("run <profile> [path]")`), **6** (`index.ts:1818-1820`
`LOCAL_CLI[profile] ?? profile`). Citation **2** is right in conclusion, narrow in derivation (m1).
Citation **7** quotes the code correctly but mischaracterizes its reachability (M7).

**Row 4 of §1.** Verified rather than assumed: all eight named verbs (`ls`, `attach`, `stop`,
`resume`, `delegate`, `jobs`, `workspace`, `install`) measure as heavy-runtime — absent from
`H2A_NATIVE_VERBS`, `shouldDispatchRuntime === true`. The row is correct.

**D3's defect claim is real and understated in the right direction.** `h2a run --help` does cross the
lazy boundary (measured `shouldDispatchRuntime(["run","--help"]) === true`), and what it reaches
first is `migrateConfigHomeIfNeeded()` (`index.ts:2139`) — a potential recursive `cpSync` of the
config home (`config.ts:334`) before any help text is printed. Calling that a defect is justified.

**In-repo blast radius of the two empty forms is genuinely small — smaller than I expected.**
Searched and found nothing that depends on bare `h2a` exiting 0 or on exact `h2a run` failing:
no `Makefile`; `Dockerfile:57-58` is `ENTRYPOINT ["h2a"]` with an explicit `CMD ["--help"]`, so
`docker run <image>` keeps hitting §1 row 1; `smoke.yml:78,87,95` calls `h2a --help` and then only
explicit verbs; both shipped systemd units use core-handled verbs
(`contrib/systemd/h2a-supervisor.service:14` `h2a loop supervise` → `bin.ts:237`;
`h2a-mirror-push.service:31` `h2a remote mirror` → `bin.ts:161`), so they survive both the flip and
the API bump; and every in-repo constructor of a `h2a run` argv passes a profile explicitly
(`runtime/mcp/agent-launch.ts:188-208`, `runtime/loop/engine/adapters.ts:489-503`), with the MCP
tool schemas constraining it to `enum ["claude","codex"]` (`runtime/mcp/tools.ts:588,618,679`).
The document's implicit premise that the empty forms have few callers holds inside this repo.
The blast radius that **is** larger than the document admits is not the empty forms — it is the
mechanism chosen to protect them (B2) and the release set required to ship it (B1).

## Verdict on the question the document does not ask

Is the change worth making? On the evidence: **yes, but not for the reason given, and not on the
migration plan as written.** The strongest case for it is B3 — a frozen public contract already
enacts bare-`h2a`-as-native, so the code is what diverged, and today's help-on-bare is the anomaly.
The document instead presents the change as a break against published behaviour and therefore
carries a justification burden it did not need, while leaving the burden it does have — B1's release
set, B2's uncovered rollback, B4's unclassified contractual spelling, M1's open cross-owner fork —
unaddressed. §1–§4 are a careful piece of work; §5's gates are honest about the engine. The gap is
between the classifier and the operator.

## Counts

| Severity | Count |
|---|---:|
| blocking | 4 |
| major | 8 |
| minor | 3 |

All 15 findings are **CONFIRMED**. None is SUSPECTED. The one thing I could not do is execute the
`h2a` binary end to end (hook-refused, and `main()` deliberately not called because it mutates the
real config home); statements about CLI behaviour are derived from the freshly built modules and the
source, and are marked so at each point.
