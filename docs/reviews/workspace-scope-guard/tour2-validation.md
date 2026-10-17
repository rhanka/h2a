# PR #364 — Tour 2

Functional target: `74c7030f9cbe7673864955b5808dd54d11719f44`.
All seven numbered findings in the independent `rev364.md` were read and addressed.
No main merge, version change, new dependency, installed h2a invocation or live
h2a state access. Only named test files were executed.

| Finding | Root correction | Regression evidence |
| --- | --- | --- |
| R1, hosts | agy named hooks at `~/.gemini/config/hooks.json`, flat startup handlers, native camelCase input; Muse project `.muse/hooks.json`; six-host own/foreign/grant/version matrix | Host baseline: 6 pass / 2 fail; Muse: 0/2; corrected agy schema: 0/2. Final targeted files: 196/196. Native Muse dispatcher: 1/1, six asserted dispatches. |
| R2, shell context/selectors | Scoped cwd/environment for subshells, pipelines and env wrappers; executable heredocs/substitutions at their actual cwd; git/gh value options and mutators; package script aliases | Initial guard: 42 pass / 65 fail. Supplemental context/wrapper cases reproduced red, then green. |
| R3, protected writes | Tokenized attached/append/clobber/combined redirections before builtin/wrapper returns; protected runtime/helper execution; static bracket/template/object Codex envelopes, dynamic/spread refusal | Initial guard failures include attached state/foreign writes, runtime helpers and bracket exec. Additional dynamic destination/alias cases red, then green. |
| R4, versions | Repository-root diff; first session baseline journal; owner-only update-ref; path commits and matching push refs; MultiEdit/agy chunks; foreign scope and release authorization checked separately | Child-cwd push, update-ref, path commit, matching refspec, MultiEdit and foreign-file grant all failed before correction. Pinned-baseline case additionally reproduced red. |
| R5, grants | Owner startup key fallback for packaged plugins, normalized repo/options, Vibe per-native-session profile journal, explicit key retention in convergence | Initial normalization/key/options cases red; Vibe binding red; agy/Muse key retention 0/2 before correction. Actual packaged Claude/Codex hooks authorize signed grants. |
| R6, legitimate work | Quote-aware substitution inspection, message data, command-specific --all, real Node test-runner position, current PR lookup, branch read options, static patch envelopes | Quoted commits, build environment, --all, targeted tests, ready, branch reads and literal patches reproduced red. Release-script --test argument remains refused. |
| R7, refusal details | Exact repo/action/ref/session in JSON and stderr | Selector assertion failed initially; final test green. |

Four initial subcases (`cd --`, branch `--move`/`--copy`, and `>|`) were already
refused at the baseline and remain explicit passing assertions. No red result
is claimed for those variants. The common parsing causes and the other reproduced
bypasses were corrected without removing any guard.

## Commands and observed output

Each test run used temporary HOME/XDG_RUNTIME_DIR/XDG_CONFIG_HOME/XDG_STATE_HOME/
CODEX_HOME/CLAUDE_CONFIG_DIR/VIBE_HOME. Fixtures create and delete their own repos,
keys and profiles. TAP files are retained in `.h2a/build/scopeguard/`.

```sh
node --test packages/h2a/test/workspace-scope-guard.test.js packages/h2a/test/workspace-scope-hosts.test.js packages/h2a/test/host-plugin.test.js packages/h2a/test/native-host-convergence.test.js packages/h2a/test/native-host-review-regressions.test.js packages/h2a/test/native-host-safety.test.js packages/h2a/test/native-host-shared-skills.test.js packages/h2a/test/vibe-mcp-direct.test.js packages/h2a/test/manual-cli-hook.test.js packages/h2a/test/vibe-native-hooks.test.js packages/h2a/test/package-plugin-manifest.test.js
```

```text
exit 0
# tests 196
# pass 196
# fail 0
# skipped 0
```

Native Muse targeted command (public downloaded artifact, SHA-256 checked by the
test; never the installed Muse CLI):

```sh
MUSE_SCOPE_PROBE_BINARY=<temporary-public-Meta-binary> node --test docs/reviews/workspace-scope-guard/muse-native-probe.mjs
```

```text
exit 0; tests 1; pass 1; fail 0; skipped 0
exec_command allow: should_block=false, terminal=completed
exec_command FOREIGN_WORKSPACE: should_block=true, terminal=blocked
exec_command signed grant: should_block=false, terminal=completed
Edit VERSION_BUMP: should_block=true, terminal=blocked
Edit release grant: should_block=false, terminal=completed
exec_command expired grant: should_block=true, terminal=blocked
```

| Static command | Observed output |
| --- | --- |
| `node node_modules/typescript/bin/tsc -b --pretty false` | exit 0 |
| `bash scripts/check-public-contract.sh` | 60 MCP tools; 100 CLI verbs; CONTRAT PUBLIC OK |
| `bash scripts/check-no-python.sh` | ZERO PYTHON OK (1 allowlisted hit, 0 unexcused) |
| `git diff --check` | exit 0 |

Red evidence: `tour2-red.tap`, `tour2-hosts-red.tap`,
`tour2-agy-convergence-red.tap`, `tour2-muse-red.tap`,
`tour2-agy-schema-red.tap`, `tour2-deep-red.tap`,
`tour2-wrappers-red.tap`, `tour2-native-key-red.tap`.
Final green evidence: `tour2-final.tap`, `tour2-muse-native-final.tap`.
Intermediate broad targeted run: 59 pass / 2 fail (obsolete agy refusal assertion
and inherited PATH host-detection assumption), then 182/182 after adapting the
assertion and isolating PATH. Scope snapshots also passed at 107/107 and 120/120.

## Host contract sources and limits

- agy: [official hook contract](https://antigravity.google/docs/hooks), read during
  Tour 2: global `~/.gemini/config/hooks.json`, workspace `.agents/hooks.json`,
  named definitions, flat SessionStart, matcher PreToolUse, native tool fields.
  Tests execute the generated hook commands and native payloads; no real agy
  session is claimed.
- Muse: [official bootstrap](https://dev.meta.ai/install.sh) references
  `https://api.meta.ai/muse-launcher.sh`, whose public `muse-stable` channel
  resolved to `1.4.10-R6427.1`. Linux x86 artifact: 376506584 bytes,
  SHA-256 `decefc0fb33c48ee43419c3e72ac2dbc781743868611074c7292807f5960dfcf`.
  Disposable echo startup actually ran SessionStart; native plugin validation,
  installation, review activation and hook dispatch ran in a fresh temporary
  profile. The probe never executes the proposed mutating tool command.
- Claude/Codex/Vibe/Gemini: generated configuration, direct hook execution and
  the six-host authorization/version matrix are covered. Full native agent
  sessions and real remote mutation are not qualified by these tests.
- Arbitrary opaque runtime programs fail closed. Hooks remain an application
  guard, not OS confinement; same-UID replacement of trusted configuration/code
  still needs external protection. No complete shell/JavaScript interpreter is
  claimed.
- Fresh author-complementary h2a consensus is unavailable: no h2a MCP is exposed,
  and the owner prohibits reaching real h2a state. No consensus verdict is claimed.

## Deviation

A pre-existing direct convergence test omitted its temporary cwd. After adding
Muse project equipment, two intermediate compatibility runs generated `.muse`
inside this worktree. Its manifest and temporary fixture paths were verified,
then that generated directory was removed. The fixture now supplies its temporary
project cwd; the final 196-test run left no `.muse` artifact. No owner profile or
real h2a state was touched. The functional repair is one commit larger than the
skill's preferred lot size, to keep the seven interdependent guard corrections
and their tests together.

Final update rebased the feature onto origin/main `fc6f4347ab6bdf7a5e47b5aadc19fad6cd983ca6` (focus-publication merge). The sole conflict was BRANCH.md; the feature's scope plan was retained. Guard and host source/test bytes are unchanged by that base update. An incorrectly grouped command continued to push after the rebase stopped, temporarily setting only this feature branch to the base. The previous remote feature head was restored with an explicit lease before completing the rebase. No main ref was written; PR recovery and final CI observations are recorded in the owner report.
