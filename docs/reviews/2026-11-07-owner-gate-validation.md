# Owner gates — validation of the specification and skills

Scope: documentation and skill instructions only. The signed marker, receive path,
question receipt, wake guard and due-check executor `OwnerGateDueCheck` are the next
implementation lot in the EVOL. None is claimed implemented or exercised by this PR.

## Local verification — round 1

All commands ran in the owner-gate worktree with:

```sh
export TMPDIR=/home/antoinefa/.cache-tmp/h2a-test/run-S5Oz4v
export XDG_RUNTIME_DIR="$TMPDIR/runtime"
```

| Command (each prefixed with rtk) | Observed result |
| --- | --- |
| npm ci --ignore-scripts --no-audit --no-fund | Failed: EACCES/EEXIST renaming an entry in the shared npm cache. No shared cache repair attempted. |
| npm ci --ignore-scripts --no-audit --no-fund --cache "$TMPDIR/npm-cache" | Exit 0; added 371 packages. Private cache removed after installation. |
| npm run build | Exit 0; vendor-engram-live mirror OK; generated MCP descriptor check passed. |
| npm exec -w @sentropic/track -- vitest run src/cli/present-decision-skill.test.ts src/cli/install-skills.test.ts | Initial 43 pass / 1 fail: main skill 1172 words exceeded the unchanged 850-word cap. After moving the mandatory gate procedure to assets/owner-gates.md and shortening the link: 44 pass, 2 files passed, exit 0. Intermediate reductions (857 and 851 words) still failed the same bound. |
| node --test packages/h2a/test/native-question-mode.test.js packages/h2a/test/install-skills-hosts.test.js | 84 tests, 84 pass, 0 fail/skip/todo, exit 0. Rerun with --test-reporter=dot after the new asset: 84 passing markers, exit 0. |

The reading-budget failure was fixed by changing documentation, not the test or its limit.

## Local verification — round 2

Same worktree, rebased onto origin/main 65b65d6bf for these runs, with
`TMPDIR=/home/antoinefa/.cache-tmp/h2a-test/run-ZYYXWB` and
`XDG_RUNTIME_DIR="$TMPDIR/runtime"`. The pinning tests were written first and run
against the unfixed text. The branch was then rebased onto origin/main 427e7578b.
That merge (PR #420) touched only BRANCH.md and `packages/h2a-runtime`, with no
overlap with this diff beyond the appended BRANCH.md sections.

| Command | Observed result |
| --- | --- |
| RED: node --test packages/h2a/test/owner-gate-skill.test.js | 4 tests, 0 pass, 4 fail, exit 1 |
| RED: npm exec -w @sentropic/track -- vitest run src/cli/present-decision-skill.test.ts | 1 failed, 13 passed, exit 1 (the new owner-gate clause test) |
| GREEN: the same two commands after the fixes | 4 tests, 4 pass, exit 0. 14 passed, exit 0 (849 of 850 words) |
| npm run build | Exit 0; vendor-engram-live mirror OK |
| HOME="$TMPDIR/home" node --test packages/h2a/test/{owner-gate-skill,native-question-mode,install-skills-hosts,package-plugin-manifest,native-host-shared-skills,registry-plugin-declarations,native-host-package}.test.js | 115 tests, 115 pass, 0 fail, 0 skipped, exit 0 |
| npm exec -w @sentropic/track -- vitest run src/cli/present-decision-skill.test.ts src/cli/install-skills.test.ts src/report/skill-truncation-warning.test.ts src/report/validated-report-shape.test.ts | 4 files, 118 passed, exit 0 |

These tests pin instruction text: the single procedure, its links, the removed
wording and the track-report rule. They do not prove that a host displayed a
question or that an owner answered it. Runtime RED/GREEN acceptance, including the
wake guard and the due-check executor, is defined for the next lot and remains
unexecuted here. No full repository test suite ran locally.

## Review round 2 — reconciliation

Sources: `rv419o` (Claude Opus 5.5 max) and `rv419m` (mistral-large-4), head 8e73f5350.
Line numbers refer to this commit.

| Finding | Status | Where |
| --- | --- | --- |
| Opus P1-1 — EVOL contradicted the skills, L2 test encoded a reminder into the dialog | Fixed | EVOL D2 step 1 and 4 (:65-79), evidence (:85-91), executor row (:147), due checks (:152-165), rebind (:199-207), recovery and adapter evidence (:470-490), case 2 (:560), follow-up and wake-guard tests (:593, :597) |
| Opus P1-2 — present-decision asset re-introduced reminders into the dialog | Fixed | `packages/track/skills/present-decision/assets/owner-gates.md` (rewritten). Pinned by `present-decision-skill.test.ts` |
| Opus P1-3 — target may never raise the question | Fixed | h2a SKILL receiver checks (:54-59), cross-session sequence (:67-75), target never raises (:77-81), deadline (:99-104). EVOL D2 (:98-112) |
| Opus P1-4 — no executor for "visible until closed" | Fixed, executor scoped to the next lot | h2a SKILL due checks (:91-97): none qualifies in this lot, `reminders-unavailable`, unverified host-timer candidate. EVOL row B (:16), only scheduler (:404), seams `OwnerGateDueCheck` (:528), clock-injected test (:594), BRANCH next lot |
| Opus P2-1 / mistral P3-3 — decision tool | Fixed | Blocking-only definition: h2a SKILL (:32-34), using-harness, asset, EVOL D2 (:55-60). Reservations: EVOL "Reserved for the decision tool" (:209-231), `binding.kind` (:268), `blocking` (:289), validation (:350), no decision store (:404, :477) |
| Opus P2-2 / mistral P2-1 — session-bound gate offered as `D1 A` | Fixed | track-report (:269-273, :293-294), harness SKILL (:38-41), present-decision SKILL (:64), asset closure. Renderer side deferred: EVOL seams (:530), BRANCH next lot |
| Opus P2-3 — Track record not executable | Fixed | h2a SKILL (:40-52): `track decision new --kind commitment`, restart query `track decision ls --outcome pending --format json`, writer of a self-found gate. EVOL (:174-180) |
| Opus P2-4 — escalation not distinct from reminder | Fixed | `overdue`, overdue alert and `h2a_blockage_raise`: h2a SKILL (:99-104), EVOL (:167-172), test (:594) |
| Opus P2-5 — six divergent copies, no test | Fixed, without a generated block | Single full procedure: h2a SKILL (:28-126). Links: using-harness, harness, track-report, asset. Pinned by `packages/h2a/test/owner-gate-skill.test.js` and `present-decision-skill.test.ts`. A generated block would need product code, out of this lot |
| Opus P2-6 — vocabulary differs | Fixed | EVOL `reported` values (:316) and one-terms table (:336-345) |
| Opus P2-7 / mistral P3-1 — `contractDigest` and admission | Fixed | EVOL admission (:439-445), `contractDigest` (:457-468), GREEN tests in the recovery row (:592) |
| Opus P2-8 — reconciliation declared complete | Fixed | This table. BRANCH.md review round 2 line |
| mistral P3-2 — nothing pins the asset link | Fixed | `present-decision-skill.test.ts`: link, required-session outcome rule and asset clauses |
| Opus P3 — style, jargon, slash chains | Fixed in the rewritten text | Banned wording pinned in `owner-gate-skill.test.js` |
| Opus P3 — terminal states | Fixed | h2a SKILL loop paragraph (:336-340): `done`, `stopped` or `blocked`. EVOL D3 (:132-136) |
| Opus P3 — blocking `AskUserQuestion` in the conductor | Fixed | h2a SKILL owner alerts (:83-89), EVOL D4 (:248-256), D7 Claude row |
| Opus P3 — BRANCH base | Fixed | BRANCH.md: rebased onto origin/main 427e7578b |

Residual limit of this lot: until the wake guard ships, a signed reply from the target
can still type into a conductor's open blocking alert. Alerts only acknowledge, so that
input cannot become a GO. The method sends nothing to the target after the initial
request (h2a SKILL :61-65, EVOL D4 :248-256).
