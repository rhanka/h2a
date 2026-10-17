# Review #364 — Tour 4 (fail-closed)

The conductor's decision targets an honest agent making a workspace/release
mistake. Protected intent with unresolved workspace authority refuses and asks
for a plain explicit command or exact owner grant. This replaces attempts to
interpret increasingly complex shell programs.

| Finding from rev364-r3.md | Result |
| --- | --- |
| Heredoc erasure, `sh -c/-s`, stdin/eval runtimes | Remove heredoc preprocessing and recursive script/substitution interpretation; refuse opaque forms with `UNVERIFIABLE`. |
| Variables/substitutions in verbs, flags, paths and executable directories | Refuse before selecting the protected action, preserving the full executable path. |
| Copy/install/link destination flags, `clean -- … -n`, Git selectors and mutations | Parse destination option operands; honor the Git option boundary; refuse independent Git directory authority; scope restore/worktree and refuse remote/config/send-pack uncertainty. |
| JS object comments and valid string escapes | Reuse the JS lexer for object boundaries, reject duplicate members, decode all three literal delimiters with the same escape decoder. |
| Version detection | Reconstruct all proposed manifest sections, compare full JSON with the pinned baseline, retain baseline publication across private toggles, inspect explicit pushed refs together with tags and full PR manifests. |
| Own-repo false positives | Allow own copy/move/mkdir destinations, conditional own cwd alternatives and explicit protected actions; retain separate source-removal protection for moves. |
| Session authority | Validate the native session binding before recording a version baseline. |

Regression command (all commands use the `rtk` prefix):

```sh
node --test --test-name-pattern=T4 packages/h2a/test/workspace-scope-guard.test.js
```

| Reproduction | Exact summary |
| --- | --- |
| Initial new cases against original hooks | tests 58; pass 1; fail 57; skipped 0; exit 1 |
| Final 76 T4 cases against hooks copied by `git show 3f20d73868ac541b4609e92b67be3b54469eb2c3:<path>` into a disposable directory | tests 76; pass 7; fail 69; skipped 0; exit 1 |
| Same final 76 cases against corrected hooks | tests 76; pass 76; fail 0; skipped 0; exit 0 |
| Extra symlink/cwd reproductions before correction | tests 6; pass 2; fail 4; skipped 0; exit 1 |
| Extra multiline PR reproduction before correction | tests 1; pass 0; fail 1; skipped 0; exit 1 |
| Extra own protected/native symlink cases before correction | tests 9; pass 6; fail 3; skipped 0; exit 1 |
| Destination resolution (`env -C`, npm prefix, dangling copy destination) | tests 3; pass 0; fail 3; skipped 0; exit 1, then tests 3; pass 3; fail 0; skipped 0; exit 0 |
| Final 11 targeted files before rebase | tests 367; pass 367; fail 0; skipped 0; duration_ms 87705.692686; exit 0 |
| Same 11 files after rebase, before the last three destination regressions | tests 367; pass 367; fail 0; skipped 0; duration_ms 90333.593617; exit 0 |
| Final 11 targeted files after all corrections and rebase | tests 370; pass 370; fail 0; skipped 0; duration_ms 85443.333809; exit 0 |
| `node --check` for both changed hook modules | exit 0 |
| `bash scripts/check-no-python.sh` | ZERO PYTHON OK (1 allowlisted hit, 0 unexcused); exit 0 |
| `git diff --check` | exit 0 |

The seven already-passing final cases are six explicit own protected actions and
the `\u0066` JS escape. They are retained coverage, with no invented red proof.
The earlier expectations for permitted executable substitutions/data heredocs
now assert `UNVERIFIABLE`, following the conductor's decision. Private-package
tests use a package private at baseline, preserving the exemption without
laundering a published package. The monorepo patch test now uses applicable full
manifest hunks instead of non-matching fragments.
The final three destination regressions extend T4 to 79 cases. Symlink checks
walk the original path's ancestors before canonicalization, retaining uncertainty
through env/npm options and dangling effective destination links.

Final targeted command, with temporary HOME/XDG_RUNTIME_DIR/XDG_CONFIG_HOME/
XDG_STATE_HOME/CODEX_HOME/CLAUDE_CONFIG_DIR/VIBE_HOME, cleaned in `finally`:

```sh
node --test packages/h2a/test/workspace-scope-guard.test.js packages/h2a/test/workspace-scope-hosts.test.js packages/h2a/test/host-plugin.test.js packages/h2a/test/native-host-convergence.test.js packages/h2a/test/native-host-review-regressions.test.js packages/h2a/test/native-host-safety.test.js packages/h2a/test/native-host-shared-skills.test.js packages/h2a/test/vibe-mcp-direct.test.js packages/h2a/test/manual-cli-hook.test.js packages/h2a/test/vibe-native-hooks.test.js packages/h2a/test/package-plugin-manifest.test.js
```

Raw TAP evidence is retained next to the conductor's external scopeguard report
as `tour4-*.tap`. The original-hook snapshot and test profiles were disposable.
Rebase onto `origin/main` at `cf7c3c03fddb7fa621813b1470bd5ff2662c8d13` completed
without conflicts; post-rebase verification is recorded in the conductor report.

Remaining limits: full native sessions, real remote mutations, arbitrary opaque
program semantics, an adversarial actor sharing the UID, and an OS sandbox are
unqualified. Full local suite intentionally not run. Independent h2a consensus
is unavailable; see [tour4-review.md](tour4-review.md). Conservative refusal of
data heredocs and harmless substitutions is intentional and documented.
