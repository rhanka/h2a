# Owner gates — validation of the specification and skills

Scope: documentation and skill instructions only. The signed marker, receiving hook,
question receipt and per-gate runtime due-check execution are the next implementation lot
in the EVOL; no scheduler is planned in that lot. None is claimed implemented or exercised by this PR.

## Local verification

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
No new tests mirror the new prose. Existing tests cover native question names, packaging,
resource installation, preserved customizations and documented Track commands. They do
not prove a host displayed a question or that an owner answered it. Runtime RED/GREEN
acceptance is defined for the next lot and remains unexecuted here.

No full repository test suite ran locally. Fixtures used the private temporary root;
no installed h2a or owner runtime state was used. Terminal PR checks and temporary-root
cleanup are recorded in the final owner report.
