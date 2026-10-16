# Native host equipment and registry transition

Vibe, Muse and agy share native artifact convergence through `install-skills`,
`doctor --repair` and explicit upgrade. Installation coherence, native
qualification and registry migration are separate results. A successful repair
does not mean that the target host is fully equipped.

All h2a MCP endpoints must ultimately use the cluster-mesh registry contract.
The bootstrap installer, native attachment and accepted R5/R7 receipt interface
belong to the registry integrator. No production receipt discovery API is
invented here. Vibe currently has no MCP installation path until that bootstrap
is delivered, with no established deadline. Doctor/status display:

> Skills installées, outils MCP absents — bootstrap registre attendu

Any observed direct endpoint, regardless of its creation date, is labelled
“voie directe — non migrée”. Vibe `host setup --write` refuses every target,
including JSON and `--force`; `config.toml` is read only. `host setup` and
`connect` retain a labelled historical rendering without instructions to paste,
translate or merge it. Existing explicit Muse/agy JSON writers remain available
until each host migrates. Claude/Codex retain their historical contracts;
absence of native/registry receipts does not downgrade their historic codes.

## First corrected installation

After the first corrected package is published, run:

```sh
h2a upgrade
h2a --version
h2a doctor --repair
```

The published 0.98.6 predates this correction; no future release number is
presumed here. The last two invocations must resolve the verified new installation. Otherwise
use its exact entrypoint. The old upgrade alone does not equip hosts.
`doctor --repair --host vibe|muse|agy` targets one host. `--skip-hosts` omits the
new-host extension; inspect-only and `--dry-run` do not mutate these profiles or
launch native hosts. Explicit successful/current/deferred upgrades use a child
of the verified entrypoint. Locked/failed upgrades do not converge hosts.
Package result codes remain separate from the host reports.

Background upgrades never converge hosts. The optional `operator_notices` field
in `h2a_session_open` and the text of `h2a_identity_status` says:

> Composants d’hôtes à actualiser : h2a doctor --repair

Agents must relay it to the operator. If those tools are not called, or the host
hides their output, immediate visible notification is not guaranteed. Run
`h2a doctor --repair` after every update; interactive CLI and doctor/status also
provide reminders. A tool result or hidden stderr does not prove visible relay.

## Ownership and native roots

Nonempty `VIBE_HOME` expands `~` and resolves absolutely; the default is
`~/.vibe`. User/project scopes remain distinct. Vibe/Muse receive complete
skill directories, including Track/Harness support resources. agy/Gemini share
one `~/.gemini/.h2a-install-agy/shared-owner.json` ownership manifest with paths relative to the native root; resources live outside command
discovery at `.h2a-install/skill-resources/<source>/<version>/<skill>/`.
Both writers refresh this same state; the earlier commands-manifest layout is adopted on repair. Gemini never qualifies agy.

An absent host does not cause profile creation during doctor/upgrade. A shared
`.gemini` directory alone does not detect agy. Explicit skill installation is
an operator request to prepare that root. agy import remains pending until its
own native commands are observed. The opt-in agy pilot records that observation
against the exact shared command manifest; a later change makes it pending again:

```sh
agy plugin import gemini
agy plugin enable h2a
```

Managed files update while their recorded bytes remain intact. Without `--force`,
local edits are conflicts; explicit user-scope `install-skills --force` restores managed skills/scripts with backups.
Unknown provenance and customized hook blocks remain protected even with `--force`.
Obsolete managed files are removed only at their recorded hash, with backup; customized residues remain conflicts.
An incomplete source inventory reports failure and never retires installed files.
Selected missing files are repairable. Project scope installs only project skills and uses the historical overwrite contract, without user hooks or installation state.
Recognized deselection/disabled skills are preserved. Vibe status reports
skill sources, filters, collisions and project hook masking; plugin resolution
still requires native observation. Missing required resources prohibit success.

The bundled historical catalog admits exact bytes from verified published
renderers/tuples, including harness renaming and Gemini TOML. Its coverage starts
at agy/Gemini's first available npm tarball 0.78.0 (tag 0.76.0 is unavailable),
Muse 0.97.5 and Vibe 0.98.3, through 0.98.6. Unknown dependency tuples remain
uncertain and are preserved. `node scripts/generate-native-host-catalog.mjs`
uses committed integrity pins; `--refresh-pins` deliberately refreshes them.
Only that maintenance job downloads history; catalog tests run offline.

## Vibe hooks

The Node scripts ship in the package and are copied under
`<VIBE_HOME>/.h2a-install/hooks`. Commands quote the absolute verified Node and
h2a entrypoints. `hooks.toml` is parsed fully as TOML 1.0 with pinned
`toml-eslint-parser@0.10.1`, before and after editing only owned blocks.
Invalid TOML and unsupported nonempty inline arrays are refused, including
with `--force`. Third-party blocks remain intact. New private directories/files
use 0700/0600; replacements use fsync, comparison, backup and rename.
Comparison then rename is not a CAS against a noncooperating Vibe writer.

The `pre_tool` guard returns explicit allow/deny JSON with exit 0. Launch failure,
invalid output and timeout fail open and degrade the guard; an explicit deny
remains effective with `strict=false`. This is not universal shell isolation.
First activation needs a current native MCP component receipt, never a fixture
or configuration alone. `doctor --repair --host vibe --guard off|on` remembers
the choice. Ordinary code changes obsolete qualification without suspending the
guard. Observable MCP loss or binding drift suspends the intact managed guard; an inspection
error does not prove loss. Customized hooks survive with a conflict diagnostic.

Lifecycle is explicit and independent of MCP:

```sh
h2a host plugin --host vibe --instance <id> --print
h2a host plugin --host vibe --instance <id> --root <absolute-bus-root> --write <VIBE_HOME>/hooks.toml
h2a doctor --repair --host vibe --lifecycle off
h2a doctor --repair --host vibe --lifecycle on
```

Use one dedicated, non-forked parent session. Automatic instance isolation is
not demonstrated. `--instance auto` is unavailable until B supplies its contract.
The wrapper reads root `parent_session_id` before any effect: only explicit
`null` records once; nonempty string (child or fork), missing/invalid fields and
malformed payloads never change any record. It captures child output and passes
the explicit instance/status/root, command/resume command and tmux context.

`/branch` and ACP copies become inactive on resume; `session/fork` attaches its
copy by default immediately. The original remains active. `vibe -c` can resume
the most recent copy: use `vibe --resume <original-id>` or a fresh non-forked
session. After repairs, open a new session or resume cleanly while idle with an
empty journal. A resume after an interrupted turn retains the old bindings.

## Qualification and remaining gates

The shipped Node pilot is opt-in:

```sh
node <package>/scripts/qualify-host.mjs --host vibe
node <package>/scripts/qualify-host.mjs --host vibe --execute --home <isolated-home-copy> --output <private-evidence-dir> --root <private-bus-root> --phase 1 --record <wheel-RECORD> --metadata <wheel-METADATA>
```

The first command prints the plan without launching anything. Component
selection is `--components skills,MCP,context,guard,lifecycle`. Native credentials
remain in process environments; evidence retains bounded hashes/metadata.
No hooks, MCP definitions, instructions, filters or trust overrides are injected
into `agentConfig`, which contains only cwd/headless/maxTurns/maxPrice.

An execution is one app-server session, including a fork, or the CLI probe. An
iteration is one model call, including delegated calls. Phase 1 allocates two
sessions at $0.15 and a probe at $0.10; phase 2 allocates two sessions at $0.175.
Each allows at most 3 iterations/90 seconds: total 5 executions, 15 iterations,
450 active seconds and $0.75. Native accounting absence or a limit yields a
partial result, without retry. Immutable per-attempt evidence is hashed into
each exercised component receipt; unexercised components keep their own evidence.
The wheel RECORD and its relevant runtime files are both verified. Phase 2 requires the phase-1 attempt via
`--previous`, the same profile/bus and a dedicated explicitly owned lifecycle
instance with no preexisting record (`--owned-instance`).

Phase 2 forks with `session/fork attach:false` **before** delegation. The origin's
parent/delegated-child/final-answer calls total three and establish the one parent
record after the fork. The copy's benign-call/denied-call/final-answer calls total
three and must leave that record unchanged. No additional origin turn is needed.
The CLI probe uses only an observed minimal read-only tool selection, native
limits and streaming output; absence of a usable native journal remains partial. The probe must also satisfy
requested resource/MCP/context oracles and native accounting. The probe uses
`--max-turns`, `--max-price`, `--output streaming` and the explicit private `VIBE_HOME`;
the Node watchdog enforces wall time without unsupported `--time-limit`/`--output-dir` flags.
The identity handler reports its canonical bus root and workspace; the oracle checks actual identity/session and Track status results.
The report qualifies only requested observed components after successful cleanup; fixtures remain fixture-only.
Its real CLI contract still needs native
qualification, not a substitute unbounded invocation.

Muse/agy adapters observe their verified discovery/import commands, but do not
invent an unverified bounded model/session API or hook surface. Skills/MCP/context
qualification remains partial without usable genuine-host traces; M-B remains
the closing criterion until the owner accepts M-A. Polling is not a guard.

Cleanup stops producers, clears only declared newly owned drumbeat instances on
their exact bus root, checks their absence and preservation of the other records,
then deletes only qualification sessions and workspaces. Incomplete cleanup
retains an explicit private resume list. No native recipe runs automatically in
doctor, upgrade, CI or delegated jobs. Fixture receipts never qualify the target
post, and no current receipt claims “Équipé — registre” without B/R7.

Backups and pending manifests live outside discovered skill sources. After an
uncatchable interruption, stop the writers and inspect the exact writer lock and
pending file before resuming; do not blindly remove a live lock. Restoration must
compare current bytes, back up intervening edits, and restore only owned files
from a compatible admitted tuple. Never restore over customization blindly. A
restored direct endpoint remains non migrated. Windows qualification is outside
this lot; other platforms require their own receipts.
