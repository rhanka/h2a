# Owner workflow qualification lab

The lab installs candidate **tarballs**, then replays the owner's workflows in a throwaway host. A run has seven PASS/FAIL rows and exits 1 if any row fails. A missing prerequisite, skipped test, TODO, cancellation or unexecuted workflow is a failure. This is qualification tooling; it does not change the product or install anything on the owner's host.

Run on Linux with Node 22+, npm, Git, GNU tar, tmux, g++, Node headers in `/usr/include/node`, and Bubblewrap with permission to create namespaces:

```sh
node scripts/owner-lab/run.mjs --ref origin/main --output tmp/owner-lab/main
node scripts/owner-lab/run.mjs --ref origin/my-candidate --output tmp/owner-lab/branch
node scripts/owner-lab/run.mjs --tarballs /absolute/path/to/candidate-tarballs --output tmp/owner-lab/tarballs
node scripts/owner-lab/run.mjs --rc 0.98.8-rc.1 --output tmp/owner-lab/rc
```

Local input must contain exactly one tarball for each of `@sentropic/h2a`, `h2a-runtime`, `h2a-cli`, `track`, and `focus`. The first four must have the same version; Focus keeps its independent version. The published RC mode fetches the four lockstep packages and the core's exact Focus dependency. The default source is `origin/main`; its resolved commit and every tarball's SHA-256 are recorded. Source mode archives that commit into the sandbox, runs a clean dependency install and the normal build, then packs with the real `prepack` checks enabled. It never builds in the working checkout.

`--previous VERSION` selects the published runtime used as the old host for the upgrade/restore scenario (default `0.98.6`). Use a fresh evidence directory for each run. The tarballs are retained as `artifacts/` in the evidence directory so the same bytes can be replayed without rebuilding.

## Isolation

The launcher creates a private `run-*` directory under `~/.cache-tmp/h2a-test` (or an explicit `--temp-parent`, never the real `/tmp`). Every command receives its private `TMPDIR`. A `finally` block copies evidence out, removes scratch even on failure, and writes `cleanup.json` with the exact removed path. SIGINT/SIGTERM terminate the owned sandbox first.

Bubblewrap mounts only system tools/libraries, read-only system configuration, the private scratch directory, and the lab scripts. The owner's HOME, installed h2a, CLI configuration, native sockets, real `/run`, real `/tmp`, and working checkout are absent. `/usr/local` is masked. A private PID namespace prevents process discovery or signalling outside the lab. The second phase also has its own network namespace: only fixture loopback services are reachable. No credentials or owner environment variables are inherited. Central MCP and llm-mesh are disabled in private configuration.

Setup may fetch packages from npm. A local registry proxy records dependency metadata/tarballs and serves the same cache offline during qualification. Missing offline data fails the run. The only code invoked as h2a is an absolute path under the installed private prefix.

All dependency lifecycle scripts are disabled. Linux node-pty's single C++ source is compiled directly with g++; no interpreter or node-gyp is invoked. This intentional installation adapter is recorded by `npm-commands.jsonl`. Candidate package `prepack` checks still run. On npm 9, clean workspace installation uses `--bin-links=false`, then links only the installed TypeScript build tools, because workspace CLI binaries do not exist before the first build.

## Scenarios and evidence

| # | Workflow | Required observation |
|---|---|---|
| 1 | Agent commit in `tmp/worktrees/lot` | Installed opt-in hooks allow the command; a real commit exists in the lot and the parent HEAD is unchanged. |
| 2 | PR touching `package.json` | A metadata-only change merges into a local bare remote. A published top-level version bump is refused, then succeeds through an exact owner-signed release grant. The local GitHub fixture exposes REST `pulls/42`, manifests and `pr diff`; unsupported `gh pr view` JSON fields fail. |
| 3 | Upstream published bump after session baseline | A release commit is pushed to bare/main, fetched and integrated into the agent's branch. Its ordinary push succeeds; a fresh unpublished bump remains refused. |
| 4 | Guard packaging and opt-in | The installed default plugin and default host installation contain no workspace guard. Explicit `host plugin --workspace-scope on` installs the guard, self-file edits are denied, and the targeted upstream guard suite passes with zero skips. |
| 5 | Native send with attached recipient | Two real native PTYs and two installed MCP sessions acquire identities. The recipient is attached by the installed `h2a attach` in another real terminal PTY. CLI `send` persists a signed envelope and delivers a signed wake both idle and with an unsent human draft. The draft and original human window remain usable. |
| 6 | Restore after a real upgrade | A published previous native host serves two human CLIs in the same project, a delegated job and a background worker. The candidate performs npm fetch/stage/probe/swap. Restore executes the commands it renders in real terminal PTYs; both humans keep their PID/incarnation, accept input, and a second restore creates no duplicate. Neither delegate gets a terminal. |
| 7 | Human upgrade output | The real upgrade includes host doctor convergence, names its version/action, has bounded lines, and contains no escaped nested JSON wall. |

The shell hook commands come from an actual private `host plugin` installation. When the packaged plugin defines SessionStart, that command is replayed too. The lab does not claim to automate a provider CLI's own plugin trust UI.

The internal guard suite runs against copied **installed candidate hook bytes**. Its two packaged-plugin cases receive an explicitly enabled portable hook manifest; the untouched candidate default is checked separately. This makes the opt-in tests meaningful when the default guard is removed. Only this selected test file is run; never the repository-wide suite.

The terminal adapter replaces the GUI window manager, not h2a attach or the native host. It launches real PTYs and executes exactly the attach commands emitted by restore. A small readline CLI supplies observable draft/line state, so no paid model or provider credentials are needed. It covers the terminal input contract; provider-specific editor behavior requires its own later qualification.

A private tmux server contains one unrelated sentinel session. This makes the legacy inventory positively known for the native resolver; no owner tmux server is reached. It is stopped using its private socket before sandbox teardown.

For upgrade, the lab creates a future-release fixture `9999.0.0` from the candidate core tarball, changing **only its package version**. The unmodified candidate upgrade command must fetch, stage, verify and swap that fixture. Runtime and dependency versions remain pinned to the candidate tarballs. This forces the actual upgrade path for any RC without publishing a synthetic version. The previous native host remains alive throughout, proving adoption and restore across the prefix replacement.

## Reading a result

`verdicts.md` is the single human table. `verdicts.json` contains errors, timings and stack traces. `candidate.json` records source provenance and tarball digests; command JSON files contain exact argv, cwd, exit status and stdout/stderr; `.log` files preserve raw output. `s1.json` through `s6.json`, the two `s5-*.json`, `s6-upgrade.log`, registry request logs, native host logs and `cleanup.json` are the principal receipts. A failed native startup is a FAIL, never a skip. A prerequisite failure still produces all seven FAIL rows.

To check the lab's rejection oracles without a build or provider:

```sh
TMPDIR=/home/antoinefa/.cache-tmp/h2a-test/<private-run> node --test --test-reporter=tap scripts/owner-lab/oracles.test.mjs
```

These selected tests prove that skipped/missing evidence and escaped upgrade output are refused, the GitHub adapter rejects invalid selectors/fields, and a failed launch still emits seven failures and cleans scratch.

During lab development, `--only 5,6,7` runs just those scenarios. Every unselected row is **FAIL**, so a diagnostic subset can never authorize a release.

## Release use

The release conductor must run the lab against the exact proposed RC tarballs and require exit 0 before authorizing installation on the owner host. Keep `candidate.json`, all seven verdicts and cleanup receipts with the release evidence. A result for another commit/package digest is not acceptance for a new RC. The intended next run contains #384, `fix/scope-guard-opt-in`, and #382 once integrated. This PR provides the qualification command and baseline; it does not modify publishing workflows or automatically upgrade the owner.

The brief fixes the design: candidate installation, local fixtures, real native PTYs, strict seven-row verdict, and no owner state. Two independent read-only reviews examined guard fidelity and native/restore fidelity; their actionable findings were incorporated. The installed-h2a consensus review workflow was not used because the owner explicitly forbids reaching the installed h2a or real host. No h2a consensus is claimed.

## Baseline on origin/main

Baseline: `origin/main` at `05bcd23ccf79fcd865ac4085e6d681bfc0103bec`, 2026-10-20, candidate `0.98.7`. The [checked-in receipts](../scripts/owner-lab/baseline/origin-main-05bcd23/README.md) include the exact command, raw output, digests and cleanup. The complete run exited **1**, with **2 PASS / 5 FAIL**:

| # | Verdict | Observation |
|---|---|---|
| 1 | PASS | Real lot commit; parent HEAD unchanged. |
| 2 | FAIL | Metadata-only PR refused with `UNVERIFIABLE`. |
| 3 | FAIL | Already-published upstream bump makes an ordinary push fail with `VERSION_BUMP`. |
| 4 | FAIL | Two guard hooks active by default; default host installer also enables it. Explicit opt-in internals: 294 passed, zero skipped. |
| 5 | FAIL | Signed inbox envelopes arrive, but neither attached wake is delivered; the human draft remains intact. |
| 6 | PASS | Real upgrade; two human CLIs resumed in place, delegated/background sessions excluded, no duplicate. |
| 7 | FAIL | Upgrade/doctor output contains escaped nested JSON. |

The same scenario 2 **passes** on `origin/fix/guard-prbump-gh-field` at `04f0b7d083acd8f6cba47775823b383e08bcb14c`: non-bump merge, bump refusal, then signed release grant and successful merge. That targeted control still exits 1 because its six unselected rows count as FAIL. It is evidence for the PR scenario, not whole-release acceptance.
